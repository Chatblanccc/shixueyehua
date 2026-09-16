import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioProgress } from '../../shared';
import { PlayerProgressQueue } from '../../miniprogram/services/player-progress';

const receipt = (audioId: string, currentTime: number): AudioProgress => ({
  audioId,
  currentTime,
  duration: 100,
  completed: currentTime >= 95,
  updatedAt: '2026-09-16T00:00:00.000Z',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const queues: PlayerProgressQueue[] = [];
afterEach(() => {
  queues.forEach((queue) => queue.dispose());
  queues.length = 0;
  vi.useRealTimers();
});
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture() {
  const cache = new Map<string, unknown>();
  const save = vi.fn(async (id: string, position: number) => receipt(id, position));
  const error = vi.fn();
  const unavailable = vi.fn();
  const queue = new PlayerProgressQueue({
    now: () => 100000,
    read: (key) => cache.get(key),
    write: (key, value) => cache.set(key, structuredClone(value)),
    save,
    onError: error,
    onUnavailable: unavailable,
  });
  queues.push(queue);
  queue.setScope('account-school-class');
  return { queue, save, error, unavailable, cache };
}

describe('持久化音频进度队列', () => {
  it('小数总时长的末尾不会被毫秒四舍五入变为越界进度', async () => {
    const f = fixture();
    f.queue.record('fractional', 24.252744, 24.252744);
    await f.queue.flush();
    expect(f.save).toHaveBeenCalledWith('fractional', 24.252744);
  });
  it('同集在慢请求期间合并，只有一个云请求并发且最后位置不会丢失', async () => {
    const f = fixture();
    const first = deferred<AudioProgress>();
    f.save.mockImplementationOnce(() => first.promise);
    f.queue.record('a', 10, 100);
    const saving = f.queue.flush();
    await tick();
    f.queue.record('a', 20, 100);
    f.queue.record('a', 30, 100);
    expect(f.queue.flush()).toBe(saving);
    expect(f.save).toHaveBeenCalledTimes(1);
    first.resolve(receipt('a', 10));
    await saving;
    expect(f.save.mock.calls).toEqual([
      ['a', 10],
      ['a', 30],
    ]);
    expect(f.queue.restored('a')).toBeUndefined();
  });

  it('网络失败留下本机位置，显式重试收到匹配回执才删除', async () => {
    const f = fixture();
    f.save.mockRejectedValueOnce({ code: 'NETWORK_ERROR' });
    f.queue.record('a', 37, 100);
    await f.queue.flush();
    expect(f.queue.restored('a')?.currentTime).toBe(37);
    expect(f.error).toHaveBeenLastCalledWith(expect.stringContaining('联网'));
    expect(JSON.stringify(Array.from(f.cache.values()))).not.toContain('https');
    await f.queue.flush();
    expect(f.queue.restored('a')).toBeUndefined();
  });

  it('服务器限流后保留最近位置，六秒后合并重试而非每秒提交', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.save.mockRejectedValueOnce({ code: 'RATE_LIMITED' });
    f.queue.record('a', 10, 100);
    await f.queue.flush();
    f.queue.record('a', 18, 100);
    await vi.advanceTimersByTimeAsync(5999);
    expect(f.save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.save.mock.calls).toEqual([
      ['a', 10],
      ['a', 18],
    ]);
  });

  it('切账号或学校不会把旧账号待同步内容发给新范围', async () => {
    const f = fixture();
    const first = deferred<AudioProgress>();
    f.save.mockImplementationOnce(() => first.promise);
    f.queue.record('a', 10, 100);
    f.queue.record('old-b', 20, 100);
    const saving = f.queue.flush();
    await tick();
    f.queue.setScope('different-account-school-class');
    f.queue.record('c', 5, 100);
    first.resolve(receipt('a', 10));
    await saving;
    await tick();
    expect(f.save.mock.calls).toEqual([
      ['a', 10],
      ['c', 5],
    ]);
    expect(f.queue.restored('old-b')).toBeUndefined();
    f.queue.setScope('account-school-class');
    expect(f.queue.restored('old-b')?.currentTime).toBe(20);
  });

  it('重建队列可恢复相同账号班级草稿，拒绝损坏/越界/过期缓存', () => {
    const f = fixture();
    f.queue.record('a', 120, 100);
    f.queue.setScope('other');
    f.cache.set('shixue-progress-v1:other', [
      { audioId: 'bad', currentTime: -1, duration: 100, updatedAt: 100000 },
      { audioId: 'late', currentTime: 1, duration: 100, updatedAt: -4000000000 },
      { audioId: 'nan', currentTime: NaN, duration: 100, updatedAt: 100000 },
    ]);
    f.queue.setScope('account-school-class');
    expect(f.queue.restored('a')?.currentTime).toBe(100);
    f.queue.setScope('other');
    expect(f.queue.restored('bad')).toBeUndefined();
    expect(f.queue.restored('late')).toBeUndefined();
    expect(f.queue.restored('nan')).toBeUndefined();
  });

  it('下架回执丢弃不可见音频并通知停播，错误回执不伪装同步成功', async () => {
    const f = fixture();
    f.save.mockRejectedValueOnce({ code: 'AUDIO_NOT_FOUND' });
    f.queue.record('a', 10, 100);
    await f.queue.flush();
    expect(f.unavailable).toHaveBeenCalledWith('a');
    expect(f.queue.restored('a')).toBeUndefined();
    f.save.mockResolvedValueOnce(receipt('wrong-id', 10));
    f.queue.record('b', 10, 100);
    await f.queue.flush();
    expect(f.queue.restored('b')).toBeDefined();
    expect(f.error).toHaveBeenLastCalledWith(expect.stringContaining('本机'));
  });

  it('销毁后清理限流定时器且不继续写云；本地失败有明确提示', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.save.mockRejectedValueOnce({ code: 'RATE_LIMITED' });
    f.queue.record('a', 10, 100);
    await f.queue.flush();
    f.queue.dispose();
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.save).toHaveBeenCalledTimes(1);
    f.queue.record('b', 20, 100);
    await f.queue.flush();
    expect(f.save).toHaveBeenCalledTimes(1);
    const errors = vi.fn();
    const broken = new PlayerProgressQueue({
      now: () => 1,
      read: () => {
        throw new Error();
      },
      write: () => {
        throw new Error();
      },
      save: async () => receipt('a', 0),
      onError: errors,
      onUnavailable: vi.fn(),
    });
    queues.push(broken);
    broken.setScope('scope');
    expect(errors).toHaveBeenLastCalledWith(expect.stringContaining('读取'));
    broken.record('a', 10, 100);
    expect(errors).toHaveBeenLastCalledWith(expect.stringContaining('空间不足'));
  });
});
