import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteTransition } from '../../miniprogram/services/route-transition';

function route(routeEventId: string, path = 'pages/profile/index', webviewId = 1) {
  return { routeEventId, path, webviewId, openType: 'navigateTo' };
}

afterEach(() => vi.useRealTimers());

describe('原生路由与会话重定向', () => {
  it('reLaunch完成事件缺少id时，只按同一路径/类型/原生页唯一匹配', async () => {
    const transition = new RouteTransition();
    const event = { ...route('native-relaunch', 'pages/launch/index', 6), openType: 'reLaunch' };
    transition.begin(event);
    const redirect = vi.fn();
    const pending = transition.waitUntilIdle().then(redirect);
    transition.complete({ ...event, routeEventId: '', webviewId: 7 });
    await Promise.resolve();
    expect(redirect).not.toHaveBeenCalled();
    transition.complete({ ...event, routeEventId: '' });
    await pending;
    expect(redirect).toHaveBeenCalledOnce();
  });

  it('缺id的完成事件有歧义时不放行，带未知id时不擅自回退匹配', async () => {
    const transition = new RouteTransition();
    transition.begin(route('first'));
    transition.begin(route('second'));
    const redirect = vi.fn();
    const pending = transition.waitUntilIdle().then(redirect);
    transition.complete(route(''));
    transition.complete(route('unknown'));
    await Promise.resolve();
    expect(redirect).not.toHaveBeenCalled();
    transition.complete(route('first'));
    transition.complete(route('second'));
    await pending;
    expect(redirect).toHaveBeenCalledOnce();
  });

  it('进入页面的动画未完成时不重定向，完成后释放等待者', async () => {
    const transition = new RouteTransition();
    const redirect = vi.fn();
    transition.begin(route('enter-admin'));
    const pending = transition.waitUntilIdle().then(redirect);
    await Promise.resolve();
    expect(redirect).not.toHaveBeenCalled();
    transition.complete(route('enter-admin'));
    await pending;
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it('乱序或重复完成事件不能提前放行仍在进行的路由', async () => {
    const transition = new RouteTransition();
    const redirect = vi.fn();
    transition.begin(route('first'));
    transition.begin(route('second'));
    const pending = transition.waitUntilIdle().then(redirect);
    transition.complete(route('unknown'));
    transition.complete(route('first'));
    transition.complete(route('first'));
    await Promise.resolve();
    expect(redirect).not.toHaveBeenCalled();
    transition.complete(route('second'));
    await pending;
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it('切换失败超时不能直接启动另一次重定向，完成事件到达后可恢复', async () => {
    vi.useFakeTimers();
    const transition = new RouteTransition();
    transition.begin(route('pending'));
    const failed = expect(transition.waitUntilIdle(100)).rejects.toThrow('页面切换未完成');
    await vi.advanceTimersByTimeAsync(100);
    await failed;
    const redirect = vi.fn();
    const pending = transition.waitUntilIdle(100).then(redirect);
    await Promise.resolve();
    expect(redirect).not.toHaveBeenCalled();
    transition.complete(route('pending'));
    await pending;
    expect(redirect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('无切换时直接放行，多等待者完成后不残留计时器', async () => {
    vi.useFakeTimers();
    const transition = new RouteTransition();
    await transition.waitUntilIdle();
    transition.begin(route('enter'));
    const pending = [transition.waitUntilIdle(), transition.waitUntilIdle()];
    transition.complete(route('enter'));
    await Promise.all(pending);
    expect(vi.getTimerCount()).toBe(0);
  });
});
