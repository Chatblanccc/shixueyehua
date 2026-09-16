import { describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES, parseLoginResult } from '../../shared';
import { createHandler } from '../../cloudfunctions/_shared/handler';
import type { Domain } from '../../cloudfunctions/_shared/handler';
import { MemoryRepository, NOW, user } from './fixtures';

function setup(domain: Domain = 'authApi', repository = new MemoryRepository()) {
  const logger = { write: vi.fn() };
  const getContext = vi.fn((): unknown => ({
    OPENID: 'test_context_openid',
    ENV: 'test_fake_environment',
  }));
  const getEnvironment = vi.fn((): string | undefined => 'test');
  const handler = createHandler(domain, {
    repository,
    logger,
    getContext,
    getEnvironment,
    now: () => NOW,
  });
  return { handler, repository, logger, getContext, getEnvironment };
}

describe('cloud boundary', () => {
  it('ignores forged payload OpenID, role, school, and client requestId', async () => {
    const { handler, repository } = setup();
    const result = await handler({
      action: 'login',
      OPENID: 'test_forged_top_level',
      requestId: 'test_forged\nrequest',
      payload: {
        openid: 'test_forged_openid',
        role: 'super_admin',
        adminSchoolId: 'test_other_school',
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected success');
    const data = parseLoginResult(result.data);
    expect(data.user.role).toBe('user');
    expect(data.user.adminSchoolId).toBeUndefined();
    expect([...repository.users.values()][0]?.openid).toBe('test_context_openid');
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses login without SDK identity even when event supplies OPENID', async () => {
    const { handler, getContext, repository } = setup();
    getContext.mockReturnValue({ ENV: 'test_fake_environment' });
    const result = await handler({
      action: 'login',
      OPENID: 'test_fake',
      payload: { OPENID: 'test_fake' },
    });
    expect(result).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
    expect(repository.users.size).toBe(0);
  });

  it('does not leak SDK exceptions, payloads or stack traces into responses or logs', async () => {
    const { handler, getContext, logger } = setup();
    getContext.mockImplementation(() => {
      throw new Error('secret_token_and_private_content');
    });
    const result = await handler({
      action: 'login',
      payload: { content: 'private_family_letter' },
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: ERROR_MESSAGES.INTERNAL_ERROR },
    });
    const serialized = JSON.stringify({ result, logs: logger.write.mock.calls });
    expect(serialized).not.toContain('secret_token');
    expect(serialized).not.toContain('private_family');
    expect(serialized).not.toContain('stack');
    expect(serialized).toContain(result.requestId);
  });

  it.each([
    null,
    [],
    {},
    { action: '../danger' },
    { action: 'login', payload: [] },
    { action: 'bootstrap' },
  ])('rejects invalid action requests: %j', async (event) => {
    expect(await setup().handler(event)).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
  });

  it('requires a valid class for audio and guards privileged actions', async () => {
    const repository = new MemoryRepository([user({ openid: 'test_context_openid' })]);
    expect(await setup('audioApi', repository).handler({ action: 'list' })).toMatchObject({
      success: false,
      error: { code: 'CLASS_NOT_AVAILABLE' },
    });
    expect(
      await setup('adminAudioApi', repository).handler({
        action: 'publish',
        payload: { role: 'admin', schoolId: 'test_school_a' },
      }),
    ).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });

  it('guards both admin entry points and super-admin-only actions', async () => {
    const repository = new MemoryRepository([
      user({ openid: 'test_context_openid', role: 'admin', adminSchoolId: 'test_school_a' }),
    ]);
    for (const domain of ['adminApi', 'adminAudioApi'] as const) {
      const action = domain === 'adminApi' ? 'listLogs' : 'publish';
      expect(
        await setup(domain, repository).handler({ action, payload: { schoolId: 'test_school_b' } }),
      ).toMatchObject({ success: false, error: { code: 'SCHOOL_SCOPE_DENIED' } });
    }
    expect(
      await setup('adminApi', repository).handler({
        action: 'grantAdmin',
        payload: { schoolId: 'test_school_a' },
      }),
    ).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });

  it('refuses disabled write actions while profile refresh remains available', async () => {
    const repository = new MemoryRepository([
      user({ openid: 'test_context_openid', status: 'disabled' }),
    ]);
    expect(await setup('letterApi', repository).handler({ action: 'submit' })).toMatchObject({
      success: false,
      error: { code: 'USER_DISABLED' },
    });
    expect(await setup('authApi', repository).handler({ action: 'getProfile' })).toMatchObject({
      success: true,
    });
  });
});

describe('real health probe contract', () => {
  it('calls database probe and reports SDK environment without exposing documents', async () => {
    const { handler, repository } = setup();
    const result = await handler({ action: 'health' });
    expect(result).toMatchObject({
      success: true,
      data: {
        environment: 'test',
        cloudEnvId: 'test_fake_environment',
        database: 'reachable',
        checkedAt: NOW.toISOString(),
      },
    });
    expect(repository.healthCount).toBe(1);
  });

  it.each(['prod', undefined, 'production', ''])(
    'denies diagnostics when APP_ENV=%s',
    async (environment) => {
      const { handler, getEnvironment, getContext, repository } = setup();
      getEnvironment.mockReturnValue(environment);
      expect(await handler({ action: 'health' })).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN' },
      });
      expect(repository.healthCount).toBe(0);
      expect(getContext).not.toHaveBeenCalled();
    },
  );

  it('does not report success when the environment or database is unavailable', async () => {
    const { handler, getContext, repository } = setup();
    getContext.mockReturnValue({ OPENID: 'test_context_openid' });
    expect(await handler({ action: 'health' })).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    getContext.mockReturnValue({ ENV: 'test_fake_environment' });
    vi.spyOn(repository, 'checkDatabase').mockRejectedValue(new Error('database not initialized'));
    expect(await handler({ action: 'health' })).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });
});
