import { describe, expect, it, vi } from 'vitest';
import { SessionNavigator } from '../../miniprogram/services/session-navigator';

function deferred() {
  let finish: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

describe('会话导航队列', () => {
  it('两个守卫并发返回同页时，只发出一次原生跳转', async () => {
    const entering = deferred();
    const navigation = deferred();
    let current = 'package-admin/pages/home/index';
    const change = vi.fn(async (route: string) => {
      await navigation.promise;
      current = route;
    });
    const navigator = new SessionNavigator({
      currentRoute: () => current,
      waitUntilIdle: () => entering.promise,
      changeRoute: change,
    });
    const first = navigator.navigate('launch');
    const second = navigator.navigate('launch');
    await Promise.resolve();
    expect(change).not.toHaveBeenCalled();
    entering.finish();
    await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    // The second call must still be queued until the native success callback.
    expect(current).toBe('package-admin/pages/home/index');
    navigation.finish();
    await Promise.all([first, second]);
    expect(change).toHaveBeenCalledTimes(1);
    expect(current).toBe('pages/launch/index');
  });

  it('不同目的地按顺序执行，Tab与引导页使用不同原生路由类型', async () => {
    const navigation = deferred();
    let current = 'pages/launch/index';
    const change = vi.fn(async (route: string) => {
      if (route === 'pages/onboarding/identity') await navigation.promise;
      current = route;
    });
    const navigator = new SessionNavigator({
      currentRoute: () => current,
      waitUntilIdle: async () => undefined,
      changeRoute: change,
    });
    const identity = navigator.navigate('identity');
    const ready = navigator.navigate('ready');
    await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    expect(change).toHaveBeenNthCalledWith(1, 'pages/onboarding/identity', false);
    navigation.finish();
    await Promise.all([identity, ready]);
    expect(change).toHaveBeenNthCalledWith(2, 'pages/night-talk/index', true);
  });

  it('失败不阻断后续重试；重复请求当前页面不发原生调用', async () => {
    let current = 'pages/launch/index';
    const change = vi
      .fn()
      .mockRejectedValueOnce(new Error('native failure'))
      .mockImplementation(async (route: string) => {
        current = route;
      });
    const navigator = new SessionNavigator({
      currentRoute: () => current,
      waitUntilIdle: async () => undefined,
      changeRoute: change,
    });
    await navigator.navigate('launch');
    expect(change).not.toHaveBeenCalled();
    await expect(navigator.navigate('class')).rejects.toThrow('native failure');
    await navigator.navigate('class');
    expect(current).toBe('pages/class-select/index');
    expect(change).toHaveBeenCalledTimes(2);
  });
});
