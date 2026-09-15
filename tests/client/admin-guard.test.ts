import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AdminPageGuard,
  requireAdminPage,
  wrapAdminAction,
} from '../../miniprogram/services/admin-guard';
import { CloudClientError } from '../../miniprogram/services/cloud-client';
import type { ErrorCode, LoginResult } from '../../shared';
import { createAdminPage } from '../../miniprogram/package-admin/admin-page';
import { authService } from '../../miniprogram/services/auth.service';
import {
  recoverAdminSession,
  requireAdminSession,
} from '../../miniprogram/services/session.service';
import { userStore } from '../../miniprogram/stores/user.store';

vi.mock('../../miniprogram/services/session.service', () => ({
  requireAdminSession: vi.fn(),
  recoverAdminSession: vi.fn(),
}));
vi.mock('../../miniprogram/services/auth.service', () => ({
  authService: { getProfile: vi.fn() },
}));
vi.mock('../../miniprogram/stores/user.store', () => ({
  userStore: { user: null, onboardingStep: 'ready' },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const state = { allowed: false, checking: false, sensitive: '', error: '' };
  const requireSession = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  const recover = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const clear = vi.fn((checking: boolean) => {
    state.allowed = false;
    state.checking = checking;
    state.sensitive = '';
    state.error = '';
  });
  const allow = vi.fn(() => {
    state.allowed = true;
    state.checking = false;
    state.sensitive = 'authorized-only';
  });
  const showError = vi.fn((error?: unknown) => {
    state.checking = false;
    state.error = error instanceof CloudClientError ? error.code : 'DENIED';
  });
  const guard = new AdminPageGuard({
    requireAdminSession: requireSession,
    clearPage: clear,
    allowPage: allow,
    showError,
    recoverAdminSession: recover,
  });
  return { guard, state, requireSession, recover, clear, allow, showError };
}

describe('管理员页面权限与操作守卫', () => {
  it('每次校验前清除敏感页状态，不复用上一次授权', async () => {
    const { guard, state, requireSession } = fixture();
    expect(await requireAdminPage(guard)).toBe(true);
    const next = deferred<boolean>();
    requireSession.mockReturnValueOnce(next.promise);
    const pending = requireAdminPage(guard);
    expect(state).toEqual({ allowed: false, checking: true, sensitive: '', error: '' });
    next.resolve(false);
    expect(await pending).toBe(false);
    expect(state.allowed).toBe(false);
    expect(state.sensitive).toBe('');
    expect(requireSession).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('onLoad 旧结果为 %s 时不能覆盖较新的 onShow', async (oldAllowed) => {
    const { guard, requireSession, state, allow } = fixture();
    const older = deferred<boolean>();
    const newer = deferred<boolean>();
    requireSession.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const old = requireAdminPage(guard);
    const current = requireAdminPage(guard);
    newer.resolve(!oldAllowed);
    expect(await current).toBe(!oldAllowed);
    older.resolve(oldAllowed);
    expect(await old).toBe(false);
    expect(state.allowed).toBe(!oldAllowed);
    expect(allow).toHaveBeenCalledTimes(oldAllowed ? 0 : 1);
  });

  it('隐藏即清空，回到前台强制发起新校验并忽略隐藏前结果', async () => {
    const { guard, requireSession, state } = fixture();
    const old = deferred<boolean>();
    requireSession.mockReturnValueOnce(old.promise).mockResolvedValueOnce(false);
    const pending = requireAdminPage(guard);
    guard.hide();
    expect(state.allowed).toBe(false);
    expect(await requireAdminPage(guard)).toBe(false);
    old.resolve(true);
    await pending;
    expect(state.allowed).toBe(false);
    expect(requireSession).toHaveBeenCalledTimes(2);
  });

  it('卸载后旧校验不能写页面、重新校验或执行操作', async () => {
    const { guard, requireSession, clear, allow, recover, showError } = fixture();
    const pending = deferred<boolean>();
    requireSession.mockReturnValueOnce(pending.promise);
    const check = requireAdminPage(guard);
    guard.dispose();
    pending.reject(new CloudClientError('FORBIDDEN', 'test-unloaded'));
    expect(await check).toBe(false);
    expect(await requireAdminPage(guard)).toBe(false);
    const action = vi.fn().mockResolvedValue('value');
    expect(await wrapAdminAction(guard, action, vi.fn())).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(allow).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it('未通过权限校验时调试器直接触发操作也不执行', async () => {
    const { guard } = fixture();
    const action = vi.fn().mockResolvedValue('value');
    expect(await wrapAdminAction(guard, action, vi.fn())).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it('下一操作先刷新权限，已撤权时不发送业务动作', async () => {
    const { guard, requireSession, state } = fixture();
    await requireAdminPage(guard);
    requireSession.mockResolvedValueOnce(false);
    const action = vi.fn().mockResolvedValue('value');
    expect(await wrapAdminAction(guard, action, vi.fn())).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(state.allowed).toBe(false);
    expect(state.sensitive).toBe('');
  });

  it.each<ErrorCode>([
    'FORBIDDEN',
    'SCHOOL_SCOPE_DENIED',
    'USER_DISABLED',
    'USER_DELETED',
    'UNAUTHORIZED',
  ])('服务端操作拒绝 %s 时先锁页再恢复会话并退出', async (code) => {
    const { guard, state, recover } = fixture();
    await requireAdminPage(guard);
    const recovery = deferred<void>();
    recover.mockImplementationOnce(() => {
      expect(state.allowed).toBe(false);
      expect(state.sensitive).toBe('');
      return recovery.promise;
    });
    const commit = vi.fn();
    const pending = wrapAdminAction(
      guard,
      async () => {
        throw new CloudClientError(code, 'test-revoked');
      },
      commit,
    );
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
    expect(state.allowed).toBe(false);
    recovery.resolve();
    expect(await pending).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(state.allowed).toBe(false);
  });

  it.each<ErrorCode>(['NETWORK_ERROR', 'TIMEOUT', 'NOT_IMPLEMENTED', 'INVALID_ARGUMENT'])(
    '普通操作错误 %s 只报错，不清会话或强制退出',
    async (code) => {
      const { guard, state, recover } = fixture();
      await requireAdminPage(guard);
      expect(
        await wrapAdminAction(
          guard,
          async () => {
            throw new CloudClientError(code, 'test-business-error');
          },
          vi.fn(),
        ),
      ).toBe(false);
      expect(state.allowed).toBe(true);
      expect(state.error).toBe(code);
      expect(recover).not.toHaveBeenCalled();
    },
  );

  it('校验时发生拒绝也立即锁页，恢复失败仍保持锁定', async () => {
    const { guard, requireSession, recover, state } = fixture();
    requireSession.mockRejectedValueOnce(new CloudClientError('FORBIDDEN', 'test-guard'));
    recover.mockRejectedValueOnce(new Error('navigation failed'));
    expect(await requireAdminPage(guard)).toBe(false);
    expect(state.allowed).toBe(false);
    expect(state.checking).toBe(false);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('操作成功结果不能在卸载后回写', async () => {
    const { guard } = fixture();
    await requireAdminPage(guard);
    const result = deferred<string>();
    const action = vi.fn(() => result.promise);
    const commit = vi.fn();
    const pending = wrapAdminAction(guard, action, commit);
    await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
    guard.dispose();
    result.resolve('old-page-data');
    expect(await pending).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it('新 onShow 已开始时，旧操作拒绝不能清除新页面授权', async () => {
    const { guard, recover, state } = fixture();
    await requireAdminPage(guard);
    const result = deferred<string>();
    const action = vi.fn(() => result.promise);
    const pending = wrapAdminAction(guard, action, vi.fn());
    await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
    guard.hide();
    expect(await requireAdminPage(guard)).toBe(true);
    result.reject(new CloudClientError('FORBIDDEN', 'test-old-action'));
    expect(await pending).toBe(false);
    expect(state.allowed).toBe(true);
    expect(recover).not.toHaveBeenCalled();
  });

  it('阻止重复提交，成功只提交一次结果且后续可重试', async () => {
    const { guard } = fixture();
    await requireAdminPage(guard);
    const result = deferred<string>();
    const action = vi.fn(() => result.promise);
    const commit = vi.fn();
    const pending = wrapAdminAction(guard, action, commit);
    expect(await wrapAdminAction(guard, action, commit)).toBe(false);
    result.resolve('fresh');
    expect(await pending).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledExactlyOnceWith('fresh');
    expect(await wrapAdminAction(guard, async () => 'next', commit)).toBe(true);
  });
});

function profile(role: 'user' | 'admin' | 'super_admin' = 'admin'): LoginResult {
  return {
    user: {
      _id: 'test-admin',
      nickname: '测试管理员',
      role,
      status: 'active',
      identity: 'teacher',
      adminSchoolId: 'test-school',
      currentSchoolId: 'test-school',
      currentGradeId: 'test-grade',
      currentClassId: 'test-class',
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
    },
    onboardingStep: 'ready',
  };
}
function pageFixture(superAdminOnly = false) {
  const options = createAdminPage({ superAdminOnly, destinations: ['audio-create'] });
  type Instance = ThisParameterType<NonNullable<typeof options.onLoad>>;
  const data = { ...options.data };
  const setData = vi.fn((patch: object) => Object.assign(data, patch));
  const page = { data, setData } as unknown as Instance;
  return { options, data, setData, page };
}

afterEach(() => {
  vi.clearAllMocks();
  userStore.user = null;
});

describe('管理分包共用生命周期接线', () => {
  it('onLoad / onShow 都检查，onHide 清 user，onUnload 后无迟到回写', async () => {
    userStore.user = profile().user;
    vi.mocked(requireAdminSession).mockResolvedValue(true);
    const { options, data, setData, page } = pageFixture();
    options.onLoad?.call(page, {});
    options.onShow?.call(page);
    await vi.waitFor(() => expect(data.allowed).toBe(true));
    expect(requireAdminSession).toHaveBeenCalledTimes(2);
    options.onHide?.call(page);
    expect(data.allowed).toBe(false);
    expect(data.user).toBeNull();
    const pending = deferred<boolean>();
    vi.mocked(requireAdminSession).mockReturnValueOnce(pending.promise);
    options.onShow?.call(page);
    options.onUnload?.call(page);
    setData.mockClear();
    pending.resolve(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setData).not.toHaveBeenCalled();
  });

  it('学校管理员直达超管页被锁定并退出', async () => {
    userStore.user = profile().user;
    vi.mocked(requireAdminSession).mockResolvedValue(true);
    vi.mocked(recoverAdminSession).mockResolvedValue(undefined);
    const { options, data, page } = pageFixture(true);
    options.onLoad?.call(page, {});
    await vi.waitFor(() => expect(recoverAdminSession).toHaveBeenCalledOnce());
    expect(data.allowed).toBe(false);
    expect(data.user).toBeNull();
  });

  it('会话检查后账号已被清空时不能用旧的 true 授权页面', async () => {
    userStore.user = null;
    vi.mocked(requireAdminSession).mockResolvedValue(true);
    vi.mocked(recoverAdminSession).mockResolvedValue(undefined);
    const { options, data, page } = pageFixture();
    options.onLoad?.call(page, {});
    await vi.waitFor(() => expect(recoverAdminSession).toHaveBeenCalledOnce());
    expect(data.allowed).toBe(false);
    expect(data.user).toBeNull();
  });

  it('权限刷新操作用真实服务接口，返回已撤权档案后立即锁页', async () => {
    userStore.user = profile().user;
    vi.mocked(requireAdminSession).mockResolvedValue(true);
    vi.mocked(authService.getProfile).mockResolvedValue(profile('user'));
    vi.mocked(recoverAdminSession).mockResolvedValue(undefined);
    const { options, data, page } = pageFixture();
    options.onLoad?.call(page, {});
    await vi.waitFor(() => expect(data.allowed).toBe(true));
    await options.onRefreshPermission.call(page);
    expect(authService.getProfile).toHaveBeenCalledOnce();
    expect(recoverAdminSession).toHaveBeenCalledOnce();
    expect(data.allowed).toBe(false);
    expect(data.user).toBeNull();
  });
});
