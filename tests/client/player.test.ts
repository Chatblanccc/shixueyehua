import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioDetail, AudioProgress } from '../../shared';
import { createPlayerStore } from '../../miniprogram/stores/player.store';
import { PlayerController } from '../../miniprogram/services/player-controller';
import type { AudioManagerPort } from '../../miniprogram/services/player-controller';

class AudioManager implements AudioManagerPort {
  title = '';
  epname = '';
  singer = '';
  coverImgUrl = '';
  startTime = 0;
  duration = 100;
  currentTime = 0;
  paused = true;
  source = '';
  stopCount = 0;
  seekAsync = false;
  handlers = new Map<string, () => void>();
  get src() {
    return this.source;
  }
  set src(value: string) {
    this.source = value;
    this.currentTime = this.startTime;
    this.paused = false;
    this.emit('play');
  }
  play() {
    this.paused = false;
    this.emit('play');
  }
  pause() {
    this.paused = true;
    this.emit('pause');
  }
  stop() {
    this.stopCount++;
    this.paused = true;
    this.currentTime = 0;
    this.emit('stop');
  }
  seek(position: number) {
    if (!this.seekAsync) {
      this.currentTime = position;
      this.emit('seeked');
    }
  }
  emit(event: string) {
    this.handlers.get(event)?.();
  }
  onPlay(callback: Parameters<AudioManagerPort['onPlay']>[0]) {
    this.handlers.set('play', () => callback({ errMsg: 'ok' }));
  }
  onPause(callback: Parameters<AudioManagerPort['onPause']>[0]) {
    this.handlers.set('pause', () => callback({ errMsg: 'ok' }));
  }
  onStop(callback: Parameters<AudioManagerPort['onStop']>[0]) {
    this.handlers.set('stop', () => callback({ errMsg: 'ok' }));
  }
  onEnded(callback: Parameters<AudioManagerPort['onEnded']>[0]) {
    this.handlers.set('ended', () => callback({ errMsg: 'ok' }));
  }
  onError(callback: WechatMiniprogram.BackgroundAudioManagerOnErrorCallback) {
    this.handlers.set('error', () => callback({ errMsg: 'test network failure' }));
  }
  onCanplay(callback: Parameters<AudioManagerPort['onCanplay']>[0]) {
    this.handlers.set('canplay', () => callback({ errMsg: 'ok' }));
  }
  onWaiting(callback: Parameters<AudioManagerPort['onWaiting']>[0]) {
    this.handlers.set('waiting', () => callback({ errMsg: 'ok' }));
  }
  onTimeUpdate(callback: Parameters<AudioManagerPort['onTimeUpdate']>[0]) {
    this.handlers.set('time', () => callback({ errMsg: 'ok' }));
  }
  onSeeked(callback: Parameters<AudioManagerPort['onSeeked']>[0]) {
    this.handlers.set('seeked', () => callback({ errMsg: 'ok' }));
  }
  onNext(callback: Parameters<AudioManagerPort['onNext']>[0]) {
    this.handlers.set('next', () => callback({ errMsg: 'ok' }));
  }
  onPrev(callback: Parameters<AudioManagerPort['onPrev']>[0]) {
    this.handlers.set('prev', () => callback({ errMsg: 'ok' }));
  }
}
const NOW = Date.parse('2026-09-16T00:00:00.000Z');
function detail(id: string): AudioDetail {
  return {
    _id: id,
    schoolId: 'school',
    title: `夜话${id}`,
    speakerName: '测试主讲人',
    speakerTitle: '校长',
    duration: 100,
    publishedAt: '2026-09-15T00:00:00.000Z',
    description: '',
    favorite: false,
    progress: null,
    mediaUrl: `https://example.test/${id}.mp3`,
    mediaExpiresAt: '2026-09-16T01:00:00.000Z',
  };
}
function receipt(id: string, time: number): AudioProgress {
  return {
    audioId: id,
    currentTime: time,
    duration: 100,
    completed: time >= 95,
    updatedAt: new Date(NOW).toISOString(),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const controllers: PlayerController[] = [];
afterEach(() => {
  controllers.forEach((controller) => controller.dispose());
  controllers.length = 0;
});
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function fixture() {
  const store = createPlayerStore();
  const manager = new AudioManager();
  const createManager = vi.fn(() => manager);
  const read = vi.fn(async (id: string) => detail(id));
  const save = vi.fn(async (id: string, position: number) => receipt(id, position));
  const favorite = vi.fn(async (audioId: string, selected: boolean) => ({
    audioId,
    favorite: selected,
  }));
  let now = NOW;
  const cache = new Map<string, unknown>();
  const controller = new PlayerController(store, {
    manager: createManager,
    detail: read,
    favorite,
    progress: {
      now: () => now,
      read: (key) => cache.get(key),
      write: (key, value) => cache.set(key, structuredClone(value)),
      save,
    },
  });
  controllers.push(controller);
  controller.setScope('user-school-grade-class', 1);
  return {
    store,
    manager,
    createManager,
    read,
    save,
    favorite,
    controller,
    cache,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('全局后台音频播放器', () => {
  it('懒创建单例并填锁屏元数据，续播取服务端位置，不因切集重新创建', async () => {
    const f = fixture();
    expect(f.createManager).not.toHaveBeenCalled();
    f.read.mockResolvedValueOnce({
      ...detail('a'),
      coverUrl: 'https://example.test/cover.jpg',
      progress: receipt('a', 35),
    });
    await f.controller.play('a');
    expect(f.store.status).toBe('playing');
    expect(f.manager).toMatchObject({
      title: '夜话a',
      singer: '测试主讲人',
      epname: '实学夜话',
      currentTime: 35,
      coverImgUrl: 'https://example.test/cover.jpg',
    });
    await f.controller.play('b');
    expect(f.createManager).toHaveBeenCalledTimes(1);
    expect(f.manager.coverImgUrl).toBe('');
    expect(f.store.currentTimeLabel).toBe('0:00');
    expect(f.store.durationLabel).toBe('1:40');
  });

  it('快速切集的迟到URL不能覆盖新集或自动播放旧内容', async () => {
    const f = fixture();
    const a = deferred<AudioDetail>();
    const b = deferred<AudioDetail>();
    f.read.mockImplementation((id) => (id === 'a' ? a.promise : b.promise));
    const first = f.controller.play('a');
    const second = f.controller.play('b');
    b.resolve(detail('b'));
    await second;
    a.resolve(detail('a'));
    await first;
    expect(f.manager.src).toBe(detail('b').mediaUrl);
    expect(f.store.audioId).toBe('b');
    expect(f.createManager).toHaveBeenCalledTimes(1);
  });

  it('旧原生事件在切集加载期间无效，新集刚开始时迟到结束/暂停不改变当前状态', async () => {
    const f = fixture();
    await f.controller.play('a');
    f.manager.currentTime = 90;
    f.manager.emit('time');
    const b = deferred<AudioDetail>();
    f.read.mockReturnValueOnce(b.promise);
    const loading = f.controller.play('b');
    f.manager.emit('error');
    f.manager.emit('ended');
    f.manager.emit('pause');
    f.manager.emit('time');
    expect(f.store).toMatchObject({ audioId: 'b', status: 'loading', currentTime: 0 });
    b.resolve(detail('b'));
    await loading;
    f.manager.emit('ended');
    f.manager.emit('pause');
    expect(f.store).toMatchObject({ status: 'playing', currentTime: 0 });
  });

  it('加载时暂停不会在URL返回后发出声音，再继续才重新取授权和URL', async () => {
    const f = fixture();
    const pending = deferred<AudioDetail>();
    f.read.mockReturnValueOnce(pending.promise);
    const playing = f.controller.play('a');
    f.controller.pause();
    pending.resolve(detail('a'));
    await playing;
    expect(f.createManager).not.toHaveBeenCalled();
    expect(f.store.status).toBe('paused');
    await f.controller.resume();
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.store.status).toBe('playing');
  });

  it('暂停保留位置，恢复和锁屏恢复都重新确认可见性', async () => {
    const f = fixture();
    await f.controller.play('a');
    f.manager.currentTime = 32;
    f.controller.pause();
    await tick();
    expect(f.store.currentTime).toBe(32);
    expect(f.save).toHaveBeenCalledWith('a', 32);
    await f.controller.resume();
    expect(f.manager.currentTime).toBe(32);
    expect(f.read).toHaveBeenCalledTimes(2);
    f.controller.pause();
    f.manager.play();
    await tick();
    expect(f.read).toHaveBeenCalledTimes(3);
    expect(f.store.status).toBe('playing');
  });

  it('拖动和前后15秒限定边界，异步seek不让旧timeUpdate把新位置倒退', async () => {
    const f = fixture();
    await f.controller.play('a');
    f.controller.skip(-15);
    expect(f.store.currentTime).toBe(0);
    f.controller.seek(90);
    f.controller.skip(15);
    expect(f.store.currentTime).toBe(100);
    f.manager.seekAsync = true;
    f.controller.seek(45);
    f.manager.currentTime = 100;
    f.manager.emit('time');
    expect(f.store.currentTime).toBe(45);
    f.controller.pause();
    await tick();
    expect(f.save).toHaveBeenLastCalledWith('a', 45);
    f.manager.currentTime = 45;
    f.manager.emit('seeked');
    expect(f.store.currentTime).toBe(45);
  });

  it('时间事件每15秒保存一次，暂停/页面隐藏可立即合并flush，非每秒写库', async () => {
    const f = fixture();
    await f.controller.play('a');
    for (let second = 1; second <= 31; second++) {
      f.advance(1000);
      f.manager.currentTime = second;
      f.manager.emit('time');
      await tick();
    }
    expect(f.save.mock.calls).toEqual([
      ['a', 15],
      ['a', 30],
    ]);
    await f.controller.flushProgress();
    expect(f.save).toHaveBeenLastCalledWith('a', 31);
  });

  it('自然结束保存完整进度并可从头重听，已完成后的中途位置仍能续播', async () => {
    const f = fixture();
    await f.controller.play('a');
    f.manager.currentTime = 100;
    f.manager.emit('ended');
    await tick();
    expect(f.store.status).toBe('ended');
    expect(f.save).toHaveBeenCalledWith('a', 100);
    await f.controller.resume();
    expect(f.manager.startTime).toBe(0);
    f.read.mockResolvedValueOnce({
      ...detail('b'),
      progress: { ...receipt('b', 25), completed: true },
    });
    await f.controller.play('b');
    expect(f.manager.startTime).toBe(25);
  });

  it('前后集使用服务端可见邻居，每次切换重新调用详情', async () => {
    const f = fixture();
    f.read.mockImplementation(async (id) => ({
      ...detail(id),
      ...(id === 'a' ? { nextAudioId: 'b' } : { previousAudioId: 'a' }),
    }));
    await f.controller.play('a', ['untrusted', 'a']);
    expect(f.store.hasPrevious).toBe(false);
    expect(f.store.hasNext).toBe(true);
    f.manager.emit('next');
    await tick();
    expect(f.store.audioId).toBe('b');
    await f.controller.prev();
    expect(f.store.audioId).toBe('a');
    expect(f.read.mock.calls).toEqual([['a'], ['b'], ['a']]);
  });

  it('文件失效和网络错误提供重试，旧URL不能在重试期间继续使用', async () => {
    const f = fixture();
    await f.controller.play('a');
    f.manager.currentTime = 25;
    f.manager.emit('error');
    expect(f.store.status).toBe('error');
    expect(f.store.errorMessage).toContain('重试');
    f.read.mockResolvedValueOnce({
      ...detail('a'),
      mediaUrl: 'https://example.test/refreshed.mp3',
    });
    await f.controller.retry();
    expect(f.manager.src).toContain('refreshed');
    expect(f.manager.startTime).toBe(25);
    f.controller.onNetworkChange(false);
    expect(f.store.syncError).toContain('网络');
  });

  it('不播放过期、缺失或非HTTPS媒体URL', async () => {
    const f = fixture();
    for (const media of [
      { mediaUrl: undefined },
      { mediaUrl: 'http://example.test/a.mp3' },
      { mediaExpiresAt: '2020-01-01T00:00:00.000Z' },
    ]) {
      f.read.mockResolvedValueOnce({ ...detail('a'), ...media });
      await f.controller.play('a');
      expect(f.store.status).toBe('error');
      expect(f.createManager).not.toHaveBeenCalled();
    }
  });

  it('切班或清会话立即停播清标题/收藏/进度，旧云回执与原生事件不恢复内容', async () => {
    const f = fixture();
    await f.controller.play('a');
    f.manager.currentTime = 20;
    const favorite = deferred<{ audioId: string; favorite: boolean }>();
    f.favorite.mockReturnValueOnce(favorite.promise);
    const favoriting = f.controller.favorite(true);
    f.controller.setScope('another-scope', 2);
    favorite.resolve({ audioId: 'a', favorite: true });
    await favoriting;
    f.manager.emit('play');
    f.manager.emit('time');
    f.manager.emit('ended');
    expect(f.store).toMatchObject({
      audioId: '',
      title: '',
      status: 'idle',
      duration: 0,
      currentTime: 0,
      favorited: false,
    });
    expect(f.manager.paused).toBe(true);
    f.controller.setScope('', 3);
    await f.controller.play('b');
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.store.errorMessage).toContain('班级');
  });

  it('加载期间的scopeRevision更新即使同账号同班也使旧响应失效', async () => {
    const f = fixture();
    const pending = deferred<AudioDetail>();
    f.read.mockReturnValueOnce(pending.promise);
    const playing = f.controller.play('a');
    f.controller.setScope('user-school-grade-class', 2);
    pending.resolve(detail('a'));
    await playing;
    expect(f.createManager).not.toHaveBeenCalled();
    expect(f.store.audioId).toBe('');
  });

  it('下架在进度或详情下一次接口检验时停播，不能继续播放旧链接', async () => {
    const f = fixture();
    await f.controller.play('a');
    f.save.mockRejectedValueOnce({ code: 'AUDIO_NOT_FOUND' });
    f.manager.currentTime = 20;
    await f.controller.flushProgress();
    expect(f.store.status).toBe('error');
    expect(f.manager.paused).toBe(true);
    expect(f.store.errorMessage).toContain('下架');
    f.read.mockRejectedValueOnce({ code: 'AUDIO_NOT_FOUND' });
    await f.controller.retry();
    expect(f.store.status).toBe('error');
  });

  it('进度上传失败可从本机恢复并在网络恢复时同步，不把失败标成云成功', async () => {
    const f = fixture();
    await f.controller.play('a');
    f.save.mockRejectedValueOnce({ code: 'NETWORK_ERROR' });
    f.manager.currentTime = 38;
    await f.controller.flushProgress();
    expect(f.store.syncError).toContain('本机');
    f.controller.onNetworkChange(true);
    await tick();
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(f.store.syncError).toBe('');
    f.controller.setScope('other', 2);
    f.controller.setScope('user-school-grade-class', 3);
  });

  it('收到错误收藏回执不更新，成功更新且重复点击只发一次', async () => {
    const f = fixture();
    await f.controller.play('a');
    const pending = deferred<{ audioId: string; favorite: boolean }>();
    f.favorite.mockReturnValueOnce(pending.promise);
    const saving = f.controller.favorite(true);
    await f.controller.favorite(true);
    expect(f.favorite).toHaveBeenCalledTimes(1);
    pending.resolve({ audioId: 'wrong', favorite: true });
    await saving;
    expect(f.store.favorited).toBe(false);
    expect(f.store.errorMessage).toContain('收藏');
    await f.controller.favorite(true);
    expect(f.store.favorited).toBe(true);
    f.controller.setFavoriteFromServer('a', false);
    expect(f.store.favorited).toBe(false);
  });

  it('销毁阻止迟到云响应和所有原生事件，也持久化已有位置', async () => {
    const f = fixture();
    await f.controller.play('a');
    f.manager.currentTime = 25;
    f.controller.dispose();
    f.manager.emit('play');
    f.manager.emit('time');
    f.manager.emit('error');
    await f.controller.play('b');
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.manager.paused).toBe(true);
    expect(JSON.stringify(Array.from(f.cache.values()))).toContain('25');
    const pendingFixture = fixture();
    const pending = deferred<AudioDetail>();
    pendingFixture.read.mockReturnValueOnce(pending.promise);
    const playing = pendingFixture.controller.play('a');
    pendingFixture.controller.dispose();
    pending.resolve(detail('a'));
    await playing;
    expect(pendingFixture.createManager).not.toHaveBeenCalled();
  });
});
