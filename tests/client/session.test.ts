import { describe, expect, it, vi } from 'vitest';
import { createUserStore } from '../../miniprogram/stores/user.store';
import { SessionController } from '../../miniprogram/services/session-controller';
import type { LoginResult } from '../../shared';

function session(role: 'user' | 'admin' | 'super_admin' = 'user'): LoginResult {
  return {
    user: {
      _id: 'test-user',
      nickname: '测试用户',
      role,
      status: 'active',
      identity: 'teacher',
      currentSchoolId: 'school-a',
      currentGradeId: 'grade-a',
      currentClassId: 'class-a',
      ...(role === 'admin' ? { adminSchoolId: 'school-a' } : {}),
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
    },
    onboardingStep: 'ready',
  };
}

describe('用户会话与页面守卫', () => {
  it('重复开始合并为一次登录，首次用户进入身份占位', async () => {
    const store = createUserStore();
    const response = session();
    delete response.user.identity;
    response.onboardingStep = 'identity';
    const login = vi.fn().mockResolvedValue(response);
    const navigate = vi.fn().mockResolvedValue(undefined);
    const controller = new SessionController(store, login, navigate);
    await Promise.all([controller.start(), controller.start()]);
    expect(login).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenLastCalledWith('identity');
    expect(store.isOnboarded).toBe(false);
    expect(store.loading).toBe(false);
  });

  it('登录失败结束loading并清除旧账号，不用缓存冒充成功', async () => {
    const store = createUserStore();
    const login = vi
      .fn()
      .mockResolvedValueOnce(session())
      .mockRejectedValueOnce(new Error('private'));
    const controller = new SessionController(store, login, vi.fn().mockResolvedValue(undefined));
    await controller.start();
    await controller.start(true);
    expect(store.user).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.errorCode).toBe('NETWORK_ERROR');
  });

  it('管理员进入时刷新授权，撤权后立即拒绝', async () => {
    const store = createUserStore();
    const login = vi
      .fn()
      .mockResolvedValueOnce(session('admin'))
      .mockResolvedValueOnce(session('user'));
    const navigate = vi.fn().mockResolvedValue(undefined);
    const controller = new SessionController(store, login, navigate);
    expect(await controller.requireAdminSession()).toBe(true);
    expect(navigate).not.toHaveBeenCalled(); // A valid admin page must not bounce to the home tab.
    expect(await controller.requireAdminSession()).toBe(false);
    expect(store.isAdmin).toBe(false);
    expect(navigate).toHaveBeenCalledWith('ready');
  });

  it('本地预览只允许空壳页面，不能成为管理员或创建假user', async () => {
    const store = createUserStore(true);
    const controller = new SessionController(
      store,
      async () => {
        throw new Error('no cloud');
      },
      vi.fn().mockResolvedValue(undefined),
    );
    expect(await controller.requireSession()).toBe(true);
    expect(await controller.requireAdminSession()).toBe(false);
    expect(store.user).toBeNull();
    expect(store.isAdmin).toBe(false);
  });

  it('已注销用户不能恢复，disabled管理员不能进入管理页', async () => {
    for (const status of ['disabled', 'deleted'] as const) {
      const store = createUserStore();
      const response = session('super_admin');
      response.user.status = status;
      const controller = new SessionController(
        store,
        async () => response,
        vi.fn().mockResolvedValue(undefined),
      );
      expect(await controller.requireAdminSession()).toBe(false);
      expect(store.isAdmin).toBe(false);
    }
  });

  it('清空会话后，迟到的登录结果不能恢复旧账号', async () => {
    const store = createUserStore();
    let finish: (result: LoginResult) => void = () => undefined;
    const controller = new SessionController(
      store,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      vi.fn().mockResolvedValue(undefined),
    );
    const pending = controller.start();
    controller.clear();
    finish(session());
    await pending;
    expect(store.user).toBeNull();
    expect(store.loading).toBe(false);
  });

  it('清空后可立即开始新登录，旧请求不能清除或覆盖新会话', async () => {
    const store = createUserStore();
    const completions: Array<(result: LoginResult) => void> = [];
    const login = vi.fn(
      () =>
        new Promise<LoginResult>((resolve) => {
          completions.push(resolve);
        }),
    );
    const controller = new SessionController(store, login, vi.fn().mockResolvedValue(undefined));
    const old = controller.start();
    controller.clear();
    const fresh = controller.start(true);
    expect(login).toHaveBeenCalledTimes(2);
    completions[0]?.(session('admin'));
    await old;
    expect(store.user).toBeNull();
    expect(store.loading).toBe(true);
    completions[1]?.(session('user'));
    await fresh;
    expect(store.user?.role).toBe('user');
    expect(store.loading).toBe(false);
  });
});
