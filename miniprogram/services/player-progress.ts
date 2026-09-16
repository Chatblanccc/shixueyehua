import type { AudioProgress } from '../generated/shared';

/** The cache contains positions only: never temporary media URLs or server credentials. */
export interface PendingProgress {
  audioId: string;
  currentTime: number;
  duration: number;
  updatedAt: number;
}

export interface ProgressPort {
  now(): number;
  read(key: string): unknown;
  write(key: string, value: PendingProgress[]): void;
  save(audioId: string, currentTime: number): Promise<AudioProgress>;
  onError(message: string): void;
  onUnavailable(audioId: string): void;
}

const MAX_PENDING = 50;
const CACHE_VERSION = 'shixue-progress-v1:';
const RETRY_MS = 6000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function codeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  return typeof error.code === 'string' ? error.code : '';
}

/** Serial writes and per-audio coalescing prevent a slow older save from winning. */
export class PlayerProgressQueue {
  private scope = '';
  private revision = 0;
  private pending = new Map<string, PendingProgress>();
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private port: ProgressPort) {}

  setScope(scope: string): void {
    if (scope === this.scope || this.disposed) return;
    this.persist();
    this.cancelRetry();
    this.scope = scope;
    this.revision++;
    this.pending.clear();
    this.port.onError('');
    if (!scope) return;
    try {
      const cached = this.port.read(CACHE_VERSION + scope);
      if (!Array.isArray(cached)) return;
      for (const value of cached.slice(-MAX_PENDING)) {
        if (!isPendingProgress(value, this.port.now())) continue;
        this.pending.set(value.audioId, value);
      }
    } catch {
      this.port.onError('本机进度暂时无法读取，可继续收听');
    }
  }

  restored(audioId: string): PendingProgress | undefined {
    return this.pending.get(audioId);
  }

  record(audioId: string, currentTime: number, duration: number): void {
    if (this.disposed || !this.scope || !audioId || !Number.isFinite(duration) || duration <= 0)
      return;
    if (!Number.isFinite(currentTime)) return;
    this.pending.set(audioId, {
      audioId,
      currentTime: Math.min(duration, Math.round(Math.max(0, currentTime) * 1000) / 1000),
      duration,
      updatedAt: this.port.now(),
    });
    while (this.pending.size > MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    this.persist();
  }

  flush(): Promise<void> {
    if (this.disposed || !this.scope || !this.pending.size) return Promise.resolve();
    if (this.running) return this.running;
    if (this.timer !== undefined) return Promise.resolve();
    this.cancelRetry();
    const revision = this.revision;
    const scope = this.scope;
    const valid = () => !this.disposed && revision === this.revision && scope === this.scope;
    const running = Promise.resolve().then(async () => {
      while (valid() && this.pending.size) {
        const record = this.pending.values().next().value;
        if (!record) break;
        try {
          const receipt = await this.port.save(record.audioId, record.currentTime);
          if (!valid()) return;
          if (receipt.audioId !== record.audioId || receipt.currentTime !== record.currentTime)
            throw new Error('Progress receipt does not match the submitted position');
          if (this.pending.get(record.audioId) === record) this.pending.delete(record.audioId);
          this.persist();
          this.port.onError('');
        } catch (error: unknown) {
          if (!valid()) return;
          const code = codeOf(error);
          if (
            [
              'AUDIO_NOT_FOUND',
              'FORBIDDEN',
              'USER_DISABLED',
              'UNAUTHORIZED',
              'USER_DELETED',
            ].includes(code)
          ) {
            this.pending.delete(record.audioId);
            this.persist();
            this.port.onUnavailable(record.audioId);
            continue;
          }
          this.port.onError(
            code === 'RATE_LIMITED'
              ? '进度已保存在本机，稍后自动同步'
              : '进度已保存在本机，联网后重试同步',
          );
          if (code === 'RATE_LIMITED') {
            this.timer = setTimeout(() => {
              this.timer = undefined;
              if (valid()) void this.flush();
            }, RETRY_MS);
          }
          return;
        }
      }
    });
    this.running = running;
    void running.finally(() => {
      if (this.running === running) this.running = null;
      // A scope switch can restore another account's own queue while an old write drains.
      if (!this.disposed && revision !== this.revision && this.pending.size) void this.flush();
    });
    return running;
  }

  dispose(): void {
    this.persist();
    this.disposed = true;
    this.revision++;
    this.cancelRetry();
    this.pending.clear();
  }

  private persist(): void {
    if (!this.scope || this.disposed) return;
    try {
      this.port.write(CACHE_VERSION + this.scope, Array.from(this.pending.values()));
    } catch {
      this.port.onError('本机空间不足，进度只能在联网时同步');
    }
  }

  private cancelRetry(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function isPendingProgress(value: unknown, now: number): value is PendingProgress {
  if (typeof value !== 'object' || value === null) return false;
  if (
    !('audioId' in value) ||
    typeof value.audioId !== 'string' ||
    !/^[\w-]{1,128}$/.test(value.audioId)
  )
    return false;
  if (
    !('duration' in value) ||
    typeof value.duration !== 'number' ||
    !Number.isFinite(value.duration)
  )
    return false;
  if (value.duration <= 0 || value.duration > 86400) return false;
  if (
    !('currentTime' in value) ||
    typeof value.currentTime !== 'number' ||
    !Number.isFinite(value.currentTime)
  )
    return false;
  if (value.currentTime < 0 || value.currentTime > value.duration) return false;
  return (
    'updatedAt' in value &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    value.updatedAt <= now + 60000 &&
    value.updatedAt >= now - MAX_AGE_MS
  );
}
