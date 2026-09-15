import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLoginResult } from '../../shared';
import type { User } from '../../shared';

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  getWXContext: vi.fn(),
  database: vi.fn(),
}));

vi.mock('wx-server-sdk', () => ({ default: sdk }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('SDK-backed runtime wiring (isolated SDK test double)', () => {
  it('initializes with trusted ENV and persists login through the wx-server-sdk adapter', async () => {
    const records: User[] = [];
    const add = vi.fn(async ({ data }: { data: User }) => {
      records.push(data);
      return { _id: data._id };
    });
    const collection = vi.fn(() => ({
      where: (query: Record<string, unknown>) => ({
        limit: () => ({
          get: async () => ({ data: records.filter((entry) => entry.openid === query.openid) }),
        }),
      }),
      add,
    }));
    sdk.getWXContext.mockReturnValue({
      OPENID: 'test_runtime_trusted',
      ENV: 'test_runtime_environment',
    });
    sdk.database.mockReturnValue({ collection });
    const { main } = await import('../../cloudfunctions/authApi');
    expect(sdk.init).not.toHaveBeenCalled();
    const first = await main({
      action: 'login',
      payload: { OPENID: 'test_runtime_forged', ENV: 'test_forged_environment' },
    });
    const second = await main({ action: 'getProfile' });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (!first.success || !second.success) throw new Error('Expected valid runtime response');
    expect(parseLoginResult(first.data)).toEqual(parseLoginResult(second.data));
    expect(sdk.init).toHaveBeenCalledExactlyOnceWith({ env: 'test_runtime_environment' });
    expect(add).toHaveBeenCalledOnce();
    expect(records[0]?.openid).toBe('test_runtime_trusted');
  });

  it('returns a safe failure and performs no database access without runtime ENV', async () => {
    sdk.getWXContext.mockReturnValue({ OPENID: 'test_runtime_trusted' });
    const { main } = await import('../../cloudfunctions/authApi');
    expect(
      await main({ action: 'login', payload: { ENV: 'test_forged_environment' } }),
    ).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.database).not.toHaveBeenCalled();
  });
});
