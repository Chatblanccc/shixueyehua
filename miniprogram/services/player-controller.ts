import { runInAction } from 'mobx-miniprogram';
import type { AudioDetail } from '../generated/shared';
import type { PlayerStore } from '../stores/player.store';
import { PlayerProgressQueue } from './player-progress';
import type { ProgressPort } from './player-progress';

export type AudioManagerPort = Pick<
  WechatMiniprogram.BackgroundAudioManager,
  | 'src'
  | 'title'
  | 'epname'
  | 'singer'
  | 'coverImgUrl'
  | 'startTime'
  | 'duration'
  | 'currentTime'
  | 'paused'
  | 'play'
  | 'pause'
  | 'stop'
  | 'seek'
  | 'onPlay'
  | 'onPause'
  | 'onStop'
  | 'onEnded'
  | 'onError'
  | 'onCanplay'
  | 'onWaiting'
  | 'onTimeUpdate'
  | 'onSeeked'
  | 'onNext'
  | 'onPrev'
>;

export interface PlayerPort {
  manager(): AudioManagerPort;
  detail(audioId: string): Promise<AudioDetail>;
  favorite(audioId: string, favorite: boolean): Promise<{ audioId: string; favorite: boolean }>;
  progress: Omit<ProgressPort, 'onError' | 'onUnavailable'>;
}

const SAVE_INTERVAL_MS = 15000;

/** One manager, one active source, and generation guards for every asynchronous response. */
export class PlayerController {
  private manager: AudioManagerPort | null = null;
  private source = '';
  private generation = 0;
  private scope = '';
  private scopeRevision = -1;
  private started = false;
  private desiredPlaying = false;
  private previousId = '';
  private nextId = '';
  private queue: string[] = [];
  private disposed = false;
  private savedAt = 0;
  private mediaExpiresAt = 0;
  private pendingSeek: number | null = null;
  private readonly progress: PlayerProgressQueue;

  constructor(
    readonly store: PlayerStore,
    private port: PlayerPort,
  ) {
    this.progress = new PlayerProgressQueue({
      ...port.progress,
      onError: (message) =>
        runInAction(() => {
          this.store.syncError = message;
        }),
      onUnavailable: (audioId) => {
        if (this.store.audioId === audioId) this.unavailable();
      },
    });
  }

  /** Called synchronously by the session reaction, before another scope can render old audio. */
  setScope(scope: string, revision: number): void {
    if (this.disposed || (this.scope === scope && this.scopeRevision === revision)) return;
    this.captureProgress();
    this.generation++;
    this.source = '';
    this.desiredPlaying = false;
    this.started = false;
    this.manager?.stop();
    this.scope = scope;
    this.scopeRevision = revision;
    this.queue = [];
    this.previousId = '';
    this.nextId = '';
    this.mediaExpiresAt = 0;
    this.pendingSeek = null;
    runInAction(() => {
      this.store.audioId = '';
      this.store.title = '';
      this.store.speaker = '';
      this.store.coverUrl = '';
      this.store.status = 'idle';
      this.store.currentTime = 0;
      this.store.duration = 0;
      this.store.favorited = false;
      this.store.favoriteLoading = false;
      this.store.hasPrevious = false;
      this.store.hasNext = false;
      this.store.errorMessage = '';
      this.store.syncError = '';
    });
    this.progress.setScope(scope);
  }

  setQueue(ids: string[]): void {
    if (this.disposed) return;
    this.queue = Array.from(new Set(ids.filter((id) => /^[\w-]{1,128}$/.test(id)))).slice(0, 500);
  }

  async play(audioId: string, queueIds?: string[], resumeAt?: number): Promise<void> {
    if (this.disposed) return;
    if (!this.scope) {
      runInAction(() => {
        this.store.errorMessage = '完成身份与班级选择后即可收听';
      });
      return;
    }
    if (!/^[\w-]{1,128}$/.test(audioId)) return;
    void this.flushProgress();
    const generation = ++this.generation;
    const scope = this.scope;
    this.source = '';
    this.started = false;
    this.desiredPlaying = true;
    this.manager?.stop();
    if (queueIds) this.setQueue(queueIds);
    if (!this.queue.includes(audioId)) this.queue = [audioId];
    this.previousId = '';
    this.nextId = '';
    this.mediaExpiresAt = 0;
    this.pendingSeek = null;
    runInAction(() => {
      this.store.audioId = audioId;
      this.store.title = '';
      this.store.speaker = '';
      this.store.coverUrl = '';
      this.store.currentTime = 0;
      this.store.duration = 0;
      this.store.status = 'loading';
      this.store.errorMessage = '';
      this.store.favorited = false;
      this.store.favoriteLoading = false;
      this.store.hasPrevious = false;
      this.store.hasNext = false;
    });
    const valid = () => !this.disposed && generation === this.generation && scope === this.scope;
    try {
      const detail = await this.port.detail(audioId);
      if (!valid()) return;
      if (detail._id !== audioId || !detail.mediaUrl || !/^https:\/\//.test(detail.mediaUrl))
        throw new Error('invalid media');
      const now = this.port.progress.now();
      const expiration = detail.mediaExpiresAt ? Date.parse(detail.mediaExpiresAt) : 0;
      if (!Number.isFinite(expiration) || expiration <= now) throw new Error('expired media');
      this.mediaExpiresAt = expiration;
      const restored = this.progress.restored(audioId);
      let position =
        (detail.progress?.currentTime ?? 0) >= detail.duration * 0.95
          ? 0
          : (detail.progress?.currentTime ?? 0);
      if (restored && restored.updatedAt > Date.parse(detail.progress?.updatedAt ?? '1970-01-01'))
        position = restored.currentTime >= detail.duration * 0.95 ? 0 : restored.currentTime;
      if (resumeAt !== undefined) position = resumeAt;
      position = clamp(position, detail.duration);
      this.previousId = detail.previousAudioId ?? '';
      this.nextId = detail.nextAudioId ?? '';
      runInAction(() => {
        this.store.title = detail.title;
        this.store.speaker = detail.speakerName;
        this.store.coverUrl = detail.coverUrl ?? '';
        this.store.duration = detail.duration;
        this.store.currentTime = position;
        this.store.favorited = detail.favorite;
        this.store.hasPrevious = Boolean(this.previousId);
        this.store.hasNext = Boolean(this.nextId);
      });
      if (!this.desiredPlaying) {
        runInAction(() => {
          this.store.status = 'paused';
        });
        return;
      }
      const manager = this.getManager();
      manager.title = detail.title;
      manager.epname = '实学夜话';
      manager.singer = detail.speakerName;
      manager.coverImgUrl = detail.coverUrl ?? '';
      manager.startTime = position;
      this.savedAt = now;
      this.source = detail.mediaUrl;
      // The official API automatically starts when src changes. Do not call play twice.
      manager.src = detail.mediaUrl;
      if (!this.desiredPlaying) {
        manager.pause();
        runInAction(() => {
          this.store.status = 'paused';
        });
      }
    } catch (error: unknown) {
      if (!valid()) return;
      if (isUnavailable(error)) this.unavailable();
      else this.fail('暂时无法加载音频，请检查网络后重试');
    }
  }

  pause(): void {
    if (this.disposed || !this.store.audioId) return;
    this.desiredPlaying = false;
    this.manager?.pause();
    if (this.store.status !== 'error')
      runInAction(() => {
        this.store.status = 'paused';
      });
    void this.flushProgress();
  }

  resume(): Promise<void> {
    if (!this.store.audioId || this.disposed) return Promise.resolve();
    // Resume revalidates visibility and signs a fresh URL, including after a long pause.
    return this.play(
      this.store.audioId,
      undefined,
      this.store.status === 'ended' ? 0 : this.store.currentTime,
    );
  }

  retry(): Promise<void> {
    return this.resume();
  }

  seek(seconds: number): void {
    if (!this.current() || !Number.isFinite(seconds) || !this.started) return;
    const target = clamp(seconds, this.store.duration);
    this.pendingSeek = target;
    this.manager?.seek(target);
    runInAction(() => {
      this.store.currentTime = target;
    });
    this.progress.record(this.store.audioId, target, this.store.duration);
  }

  skip(delta: number): void {
    this.seek(this.store.currentTime + delta);
  }

  prev(): Promise<void> {
    return this.previousId ? this.play(this.previousId) : Promise.resolve();
  }

  next(): Promise<void> {
    return this.nextId ? this.play(this.nextId) : Promise.resolve();
  }

  async favorite(desired: boolean): Promise<void> {
    const audioId = this.store.audioId;
    if (!audioId || !this.scope || this.disposed || this.store.favoriteLoading) return;
    const generation = this.generation;
    runInAction(() => {
      this.store.favoriteLoading = true;
    });
    try {
      const result = await this.port.favorite(audioId, desired);
      if (generation !== this.generation || this.disposed) return;
      if (result.audioId !== audioId || result.favorite !== desired)
        throw new Error('invalid favorite');
      runInAction(() => {
        this.store.favorited = result.favorite;
      });
    } catch (error: unknown) {
      if (generation !== this.generation || this.disposed) return;
      if (isUnavailable(error)) this.unavailable();
      else
        runInAction(() => {
          this.store.errorMessage = '收藏未更新，请稍后重试';
        });
    } finally {
      if (generation === this.generation && !this.disposed)
        runInAction(() => {
          this.store.favoriteLoading = false;
        });
    }
  }

  setFavoriteFromServer(audioId: string, favorite: boolean): void {
    if (!this.disposed && this.store.audioId === audioId)
      runInAction(() => {
        this.store.favorited = favorite;
      });
  }

  markUnavailable(audioId: string): void {
    if (!this.disposed && this.store.audioId === audioId) this.unavailable();
  }

  flushProgress(): Promise<void> {
    this.captureProgress();
    return this.progress.flush();
  }

  onAppShow(): void {
    if (this.disposed) return;
    this.updateTime();
    void this.flushProgress();
    if (this.store.status === 'playing' && this.mediaExpiresAt <= this.port.progress.now())
      void this.resume();
  }

  onNetworkChange(connected: boolean): void {
    if (this.disposed) return;
    if (connected) void this.progress.flush();
    else if (this.store.audioId) {
      runInAction(() => {
        this.store.syncError = '网络已断开，已缓冲内容可继续收听；恢复网络后可重试';
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.captureProgress();
    this.generation++;
    this.source = '';
    this.disposed = true;
    this.manager?.stop();
    this.progress.dispose();
  }

  private getManager(): AudioManagerPort {
    if (this.manager) return this.manager;
    const manager = this.port.manager();
    this.manager = manager;
    // Native callbacks carry no track id. Check current src and native state, never a
    // previous callback's cached position. Generation also guards all cloud responses.
    manager.onPlay(() => {
      if (!this.current() || manager.paused) return;
      if (!this.desiredPlaying) {
        // A lock-screen resume is also a new authorization boundary.
        manager.pause();
        void this.resume();
        return;
      }
      this.started = true;
      runInAction(() => {
        this.store.status = 'playing';
        this.store.errorMessage = '';
      });
    });
    manager.onCanplay(() => {
      if (!this.current()) return;
      if (!this.desiredPlaying) manager.pause();
    });
    manager.onPause(() => {
      if (!this.current() || !this.started || !manager.paused) return;
      this.desiredPlaying = false;
      runInAction(() => {
        this.store.status = 'paused';
      });
      void this.flushProgress();
    });
    manager.onStop(() => {
      if (!this.current() || !this.started || !manager.paused) return;
      this.progress.record(this.store.audioId, this.store.currentTime, this.store.duration);
      this.source = '';
      this.started = false;
      this.desiredPlaying = false;
      runInAction(() => {
        this.store.status = 'paused';
      });
      void this.progress.flush();
    });
    manager.onWaiting(() => {
      if (this.current() && this.desiredPlaying)
        runInAction(() => {
          this.store.status = 'loading';
        });
    });
    manager.onTimeUpdate(() => this.updateTime());
    manager.onSeeked(() => this.updateTime());
    manager.onEnded(() => {
      if (!this.current() || !this.started) return;
      // Ignore late ended events when the *current native source* has just started.
      if (manager.currentTime < this.store.duration * 0.95) return;
      runInAction(() => {
        this.store.currentTime = this.store.duration;
        this.store.status = 'ended';
      });
      this.desiredPlaying = false;
      this.started = false;
      this.progress.record(this.store.audioId, this.store.duration, this.store.duration);
      void this.progress.flush();
    });
    manager.onError(() => {
      if (this.current()) this.fail('音频加载中断或链接已失效，请重试获取新的播放链接');
    });
    manager.onNext(() => {
      if (this.current()) void this.next();
    });
    manager.onPrev(() => {
      if (this.current()) void this.prev();
    });
    return manager;
  }

  private current(): boolean {
    return (
      !this.disposed && Boolean(this.scope && this.source && this.manager?.src === this.source)
    );
  }

  private updateTime(): void {
    if (!this.current() || !this.started || !this.manager) return;
    const position = clamp(this.manager.currentTime, this.store.duration);
    if (this.pendingSeek !== null) {
      if (Math.abs(position - this.pendingSeek) > 2) return;
      this.pendingSeek = null;
    }
    runInAction(() => {
      this.store.currentTime = position;
    });
    if (this.port.progress.now() - this.savedAt >= SAVE_INTERVAL_MS) {
      this.savedAt = this.port.progress.now();
      this.progress.record(this.store.audioId, position, this.store.duration);
      void this.progress.flush();
    }
  }

  private captureProgress(): void {
    if (!this.scope || !this.store.audioId || this.store.duration <= 0 || !this.started) return;
    if (this.current() && this.manager && this.pendingSeek === null)
      runInAction(() => {
        this.store.currentTime = clamp(this.manager?.currentTime ?? 0, this.store.duration);
      });
    this.progress.record(this.store.audioId, this.store.currentTime, this.store.duration);
  }

  private fail(message: string, preserveProgress = true): void {
    if (preserveProgress) this.captureProgress();
    this.source = '';
    this.started = false;
    this.desiredPlaying = false;
    this.manager?.stop();
    runInAction(() => {
      this.store.status = 'error';
      this.store.errorMessage = message;
    });
  }

  private unavailable(): void {
    this.generation++;
    this.fail('这期夜话已下架或不在当前班级范围内，请选择其他内容', false);
    runInAction(() => {
      this.store.favoriteLoading = false;
    });
  }
}

function clamp(value: number, duration: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(duration, value)) : 0;
}

function isUnavailable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['AUDIO_NOT_FOUND', 'FORBIDDEN', 'USER_DISABLED', 'UNAUTHORIZED', 'USER_DELETED'].includes(
      String(error.code),
    )
  );
}
