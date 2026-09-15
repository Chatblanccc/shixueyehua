import { describe, expect, it, vi } from 'vitest';
import { dataPortFromDatabase, type SdkDatabase } from '../../scripts/database/cloudbase';

function adapter() {
  const get = vi.fn(async (): Promise<unknown> => ({ data: null }));
  const set = vi.fn(async (): Promise<unknown> => ({
    updated: 0,
    upserted: [{ _id: 'test_record' }],
  }));
  const update = vi.fn(async (): Promise<unknown> => ({ updated: 1 }));
  const doc = vi.fn(() => ({ get, set, update }));
  const queryGet = vi.fn(async (): Promise<unknown> => ({ data: [] }));
  const limit = vi.fn(() => ({ get: queryGet }));
  const where = vi.fn(() => ({ limit }));
  const collection = vi.fn(() => ({ doc, where }));
  const database: SdkDatabase = {
    collection,
    runTransaction: (work) => work({ collection }),
    serverDate: () => new Date('2026-09-15T00:00:00.000Z'),
  };
  return {
    port: dataPortFromDatabase(database),
    get,
    set,
    update,
    queryGet,
    collection,
    doc,
    where,
    limit,
  };
}

describe('TASK-102 SDK adapter write evidence', () => {
  it('preserves transaction results and uses only document operations inside transactions', async () => {
    const { port, collection, doc, where, set } = adapter();
    const result = await port.transaction(async (transaction) => {
      expect(await transaction.get('admin_logs', 'test_record')).toBeNull();
      await transaction.set('admin_logs', 'test_record', { action: 'test_bootstrap' });
      return 'granted';
    });
    expect(result).toBe('granted');
    expect(collection).toHaveBeenCalledWith('admin_logs');
    expect(doc).toHaveBeenCalledWith('test_record');
    expect(set).toHaveBeenCalledWith({ action: 'test_bootstrap' });
    expect(where).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { updated: 0 },
    { updated: 0, upserted: [{ _id: 'test_wrong_record' }] },
    { updated: 0, upserted: [] },
    { updated: 2 },
  ])('does not treat an unconfirmed receipt/seed write as applied: %j', async (response) => {
    const { port, set } = adapter();
    set.mockResolvedValue(response);
    await expect(
      port.transaction((transaction) => transaction.set('admin_logs', 'test_record', {})),
    ).rejects.toThrow('DOCUMENT_WRITE_NOT_APPLIED');
  });

  it('accepts a confirmed document replacement and rejects failed role updates', async () => {
    const { port, set, update } = adapter();
    set.mockResolvedValue({ updated: 1, upserted: [{ _id: undefined }] });
    await expect(
      port.transaction((transaction) =>
        transaction.set('system_configs', 'test_record', { key: 'app' }),
      ),
    ).resolves.toBeUndefined();
    update.mockResolvedValue({ updated: 0 });
    await expect(
      port.transaction((transaction) =>
        transaction.update('users', 'test_record', { role: 'super_admin' }),
      ),
    ).rejects.toThrow('USER_UPDATE_NOT_APPLIED');
  });

  it('rejects SDK error results even when they resemble successful writes', async () => {
    const { port, set } = adapter();
    set.mockResolvedValue({ code: 'PERMISSION_DENIED', updated: 1 });
    await expect(
      port.transaction((transaction) => transaction.set('admin_logs', 'test_record', {})),
    ).rejects.toThrow('CLOUDBASE_REQUEST_FAILED');
  });

  it('uses bounded user queries and validates records before bootstrap sees them', async () => {
    const { port, queryGet, where, limit } = adapter();
    queryGet.mockResolvedValue({ data: [{ _id: 'test_record', openid: 'fictional_test_openid' }] });
    expect(await port.findUsers({ openid: 'fictional_test_openid' })).toHaveLength(1);
    expect(where).toHaveBeenCalledWith({ openid: 'fictional_test_openid' });
    expect(limit).toHaveBeenCalledWith(2);
    queryGet.mockResolvedValue({ data: ['malformed'] });
    await expect(port.findUsers({ role: 'super_admin' })).rejects.toThrow('INVALID_USERS_RESPONSE');
  });
});
