import { describe, expect, it, vi } from 'vitest';
import type { AudioDetail, AudioSummary, CursorPage, FavoriteResult } from '../../shared';
import {
  AudioListController,
  audioCard,
  audioTime,
} from '../../miniprogram/services/audio-list-controller';
import type {
  AudioListPort,
  AudioListState,
  AudioScope,
} from '../../miniprogram/services/audio-list-controller';
import { AudioDetailController } from '../../miniprogram/services/audio-detail-controller';
import type {
  AudioDetailPort,
  AudioDetailState,
} from '../../miniprogram/services/audio-detail-controller';
import { CloudClientError } from '../../miniprogram/services/cloud-client';

const initialScope: AudioScope = {
  userId: 'user-a',
  schoolId: 'school-a',
  classId: 'class-a',
  revision: 0,
};
const audio = (id = 'audio-a', schoolId = 'school-a'): AudioSummary => ({
  _id: id,
  schoolId,
  title: '夜话测试标题',
  speakerName: '测试主讲人',
  speakerTitle: '',
  duration: 120,
  publishedAt: '2026-09-15T12:00:00.000Z',
  progress: null,
  favorite: false,
});
const detail = (id = 'audio-a'): AudioDetail => ({ ...audio(id), description: '' });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const listPort = (overrides: Partial<AudioListPort> = {}): AudioListPort => ({
  scope: () => initialScope,
  previewMode: () => false,
  ensureSession: async () => true,
  list: async () => ({ items: [audio()] }),
  ...overrides,
});
const detailPort = (overrides: Partial<AudioDetailPort> = {}): AudioDetailPort => ({
  scope: () => initialScope,
  previewMode: () => false,
  ensureSession: async () => true,
  detail: async () => detail(),
  favorite: async (audioId, favorite) => ({ audioId, favorite }),
  ...overrides,
});

describe('夜话、历史和收藏共用分页控制器', () => {
  it('无云预览保持空列表，不发请求或虚构音频', async () => {
    const read = vi.fn();
    const controller = new AudioListController(
      listPort({ scope: () => null, previewMode: () => true, list: read }),
    );
    let state!: AudioListState;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.refresh();
    await controller.loadMore();
    expect(read).not.toHaveBeenCalled();
    expect(state).toMatchObject({ items: [], loading: false, previewMode: true, hasMore: false });
  });
  it('第一页失败可重试，更多页失败保留原列表并按原游标重试', async () => {
    const read = vi
      .fn<(cursor?: string) => Promise<CursorPage<AudioSummary>>>()
      .mockRejectedValueOnce(new CloudClientError('NETWORK_ERROR', 'test'))
      .mockResolvedValueOnce({ items: [audio()], nextCursor: 'page2' })
      .mockRejectedValueOnce(new CloudClientError('TIMEOUT', 'test'))
      .mockResolvedValueOnce({ items: [audio(), audio('audio-b')] });
    const controller = new AudioListController(listPort({ list: read }));
    let state!: AudioListState;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.refresh();
    expect(state.errorMessage).toContain('连接失败');
    await controller.refresh();
    expect(state.items).toHaveLength(1);
    await controller.loadMore();
    expect(state.moreError).toContain('超时');
    expect(state.items).toHaveLength(1);
    await controller.loadMore();
    expect(read.mock.calls.slice(-2)).toEqual([['page2'], ['page2']]);
    expect(state.items.map((item) => item._id)).toEqual(['audio-a', 'audio-b']);
    expect(state.hasMore).toBe(false);
  });
  it('一次只加载一页，拒绝重复游标并保留已知数据', async () => {
    const pending = deferred<CursorPage<AudioSummary>>();
    const read = vi
      .fn<(cursor?: string) => Promise<CursorPage<AudioSummary>>>()
      .mockResolvedValueOnce({ items: [audio()], nextCursor: 'page2' })
      .mockImplementationOnce(() => pending.promise);
    const controller = new AudioListController(listPort({ list: read }));
    let state!: AudioListState;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.refresh();
    const more = controller.loadMore();
    await controller.loadMore();
    expect(read).toHaveBeenCalledTimes(2);
    pending.resolve({ items: [audio('audio-b')], nextCursor: 'page2' });
    await more;
    expect(state.moreError).toContain('返回异常');
    expect(state.items.map((item) => item._id)).toEqual(['audio-a']);
    expect(state.loadingMore).toBe(false);
  });
  it('切班马上清空，上一班的慢响应不能覆盖新班列表', async () => {
    let scope = initialScope;
    const pending = deferred<CursorPage<AudioSummary>>();
    const read = vi
      .fn<(cursor?: string) => Promise<CursorPage<AudioSummary>>>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce({ items: [audio('audio-b', 'school-b')] });
    const controller = new AudioListController(listPort({ scope: () => scope, list: read }));
    let state!: AudioListState;
    controller.subscribe((value) => {
      state = value;
    });
    const old = controller.refresh();
    await Promise.resolve();
    scope = { ...initialScope, schoolId: 'school-b', classId: 'class-b', revision: 1 };
    controller.invalidateScope();
    expect(state.items).toEqual([]);
    expect(state.loading).toBe(false);
    await controller.refresh();
    pending.resolve({ items: [audio()] });
    await old;
    expect(state.items.map((item) => item._id)).toEqual(['audio-b']);
  });
  it('换账号、刷新和卸载均使旧请求失效', async () => {
    let scope = initialScope;
    const first = deferred<CursorPage<AudioSummary>>();
    const second = deferred<CursorPage<AudioSummary>>();
    const read = vi
      .fn<(cursor?: string) => Promise<CursorPage<AudioSummary>>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const controller = new AudioListController(listPort({ scope: () => scope, list: read }));
    const listener = vi.fn();
    controller.subscribe(listener);
    const old = controller.refresh();
    await Promise.resolve();
    scope = { ...initialScope, userId: 'user-b' };
    controller.invalidateScope();
    const fresh = controller.refresh();
    await Promise.resolve();
    controller.dispose();
    const count = listener.mock.calls.length;
    first.resolve({ items: [audio()] });
    second.resolve({ items: [audio('audio-b')] });
    await Promise.all([old, fresh]);
    expect(listener).toHaveBeenCalledTimes(count);
  });
  it('服务返回其他学校的音频时拒绝展示', async () => {
    const controller = new AudioListController(
      listPort({ list: async () => ({ items: [audio('audio-b', 'school-b')] }) }),
    );
    let state!: AudioListState;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.refresh();
    expect(state.items).toEqual([]);
    expect(state.errorMessage).toContain('返回异常');
  });
  it('刷新覆盖相同范围尚未完成的加载更多响应', async () => {
    const pending = deferred<CursorPage<AudioSummary>>();
    const read = vi
      .fn<(cursor?: string) => Promise<CursorPage<AudioSummary>>>()
      .mockResolvedValueOnce({ items: [audio()], nextCursor: 'next' })
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce({ items: [audio('new-audio')] });
    const controller = new AudioListController(listPort({ list: read }));
    let state!: AudioListState;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.refresh();
    const old = controller.loadMore();
    await controller.refresh();
    pending.resolve({ items: [audio('older-audio')] });
    await old;
    expect(state.items.map((item) => item._id)).toEqual(['new-audio']);
  });
});

describe('音频详情和收藏', () => {
  it('下架内容清空并展示不可用，重试会重新验证', async () => {
    const read = vi
      .fn<() => Promise<AudioDetail>>()
      .mockRejectedValueOnce(new CloudClientError('AUDIO_NOT_FOUND', 'test'))
      .mockResolvedValueOnce(detail());
    const controller = new AudioDetailController(detailPort({ detail: read }), 'audio-a');
    let state!: AudioDetailState;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.load();
    expect(state.audio).toBeNull();
    expect(state.unavailable).toBe(true);
    await controller.load();
    expect(state.audio?._id).toBe('audio-a');
    expect(state.unavailable).toBe(false);
  });
  it('收藏只按服务端成功回执生效，快速点击不重复写，失败可重试', async () => {
    const pending = deferred<FavoriteResult>();
    const write = vi
      .fn<(id: string, desired: boolean) => Promise<FavoriteResult>>()
      .mockImplementationOnce(() => pending.promise)
      .mockRejectedValueOnce(new CloudClientError('TIMEOUT', 'test'))
      .mockResolvedValueOnce({ audioId: 'audio-a', favorite: false });
    const apply = vi.fn();
    const controller = new AudioDetailController(
      detailPort({ favorite: write, favoriteChanged: apply }),
      'audio-a',
    );
    let state!: AudioDetailState;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.load();
    const first = controller.toggleFavorite();
    await controller.toggleFavorite();
    expect(write).toHaveBeenCalledTimes(1);
    expect(state.audio?.favorite).toBe(false);
    pending.resolve({ audioId: 'audio-a', favorite: true });
    await first;
    expect(state.audio?.favorite).toBe(true);
    expect(apply).toHaveBeenCalledWith('audio-a', true);
    await controller.toggleFavorite();
    expect(state.audio?.favorite).toBe(true);
    expect(state.favoriteError).toContain('超时');
    await controller.toggleFavorite();
    expect(state.audio?.favorite).toBe(false);
    expect(write.mock.calls).toEqual([
      ['audio-a', true],
      ['audio-a', false],
      ['audio-a', false],
    ]);
  });
  it('切班后的详情与收藏慢响应不能回填或改变播放器收藏', async () => {
    let scope = initialScope;
    const pending = deferred<FavoriteResult>();
    const apply = vi.fn();
    const controller = new AudioDetailController(
      detailPort({ scope: () => scope, favorite: () => pending.promise, favoriteChanged: apply }),
      'audio-a',
    );
    let state!: AudioDetailState;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.load();
    const save = controller.toggleFavorite();
    scope = { ...scope, classId: 'class-b', revision: 1 };
    controller.invalidateScope();
    pending.resolve({ audioId: 'audio-a', favorite: true });
    await save;
    expect(state.audio).toBeNull();
    expect(state.favoriteLoading).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
  it('收藏写入时已下架，立即清空音频并停止提供播放入口', async () => {
    const controller = new AudioDetailController(
      detailPort({
        favorite: async () => {
          throw new CloudClientError('AUDIO_NOT_FOUND', 'test');
        },
      }),
      'audio-a',
    );
    let state!: AudioDetailState;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.load();
    await controller.toggleFavorite();
    expect(state.audio).toBeNull();
    expect(state.unavailable).toBe(true);
  });
  it('拒绝错集详情和不匹配收藏回执', async () => {
    const controller = new AudioDetailController(
      detailPort({ detail: async () => detail('audio-b') }),
      'audio-a',
    );
    let state!: AudioDetailState;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.load();
    expect(state.audio).toBeNull();
    expect(state.errorMessage).toContain('返回异常');
    const other = new AudioDetailController(
      detailPort({ favorite: async () => ({ audioId: 'audio-b', favorite: true }) }),
      'audio-a',
    );
    other.subscribe((value) => {
      state = value;
    });
    await other.load();
    await other.toggleFavorite();
    expect(state.audio?.favorite).toBe(false);
    expect(state.favoriteError).toContain('返回异常');
  });
  it('预览不读详情不收藏；卸载后异步详情不写页面', async () => {
    const read = vi.fn();
    const favorite = vi.fn();
    const preview = new AudioDetailController(
      detailPort({ scope: () => null, previewMode: () => true, detail: read, favorite }),
      'audio-a',
    );
    await preview.load();
    await preview.toggleFavorite();
    expect(read).not.toHaveBeenCalled();
    expect(favorite).not.toHaveBeenCalled();
    const pending = deferred<AudioDetail>();
    const controller = new AudioDetailController(
      detailPort({ detail: () => pending.promise }),
      'audio-a',
    );
    const listener = vi.fn();
    controller.subscribe(listener);
    const request = controller.load();
    await Promise.resolve();
    controller.dispose();
    const count = listener.mock.calls.length;
    pending.resolve(detail());
    await request;
    expect(listener).toHaveBeenCalledTimes(count);
  });
});

describe('音频卡片展示数据', () => {
  it('保留长标题和缺省封面，按服务端进度展示继续收听或完成', () => {
    const source = {
      ...audio(),
      title: '长标题'.repeat(30),
      progress: {
        audioId: 'audio-a',
        currentTime: 60,
        duration: 120,
        completed: false,
        updatedAt: '2026-09-15T12:00:00.000Z',
      },
    };
    expect(audioCard(source)).toMatchObject({
      title: source.title,
      progressPercent: 50,
      currentTimeLabel: '1:00',
      progressLabel: '继续收听 · 50%',
      dateLabel: '2026.09.15',
      durationLabel: '2:00',
    });
    expect(
      audioCard({ ...source, progress: { ...source.progress, completed: true } }).progressLabel,
    ).toContain('已听完');
    expect(audioCard(source).coverUrl).toBeUndefined();
    expect(audioTime(-10)).toBe('0:00');
    expect(audioTime(3659)).toBe('60:59');
  });
});
