import type { AudioSummary, CursorPage } from '../generated/shared';
import { CloudClientError } from './cloud-client';

export interface AudioScope {
  userId: string;
  schoolId: string;
  classId: string;
  revision: number;
}
export const audioScopeKey = (scope: AudioScope | null): string =>
  scope ? [scope.userId, scope.schoolId, scope.classId, scope.revision].join('|') : '';
export interface AudioCard extends AudioSummary {
  durationLabel: string;
  dateLabel: string;
  progressPercent: number;
  progressLabel: string;
  currentTimeLabel: string;
}
export function audioTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
export function audioCard(audio: AudioSummary): AudioCard {
  const percent =
    audio.progress && audio.duration > 0
      ? Math.min(100, Math.max(0, Math.floor((audio.progress.currentTime / audio.duration) * 100)))
      : 0;
  return {
    ...audio,
    currentTimeLabel: audioTime(audio.progress?.currentTime ?? 0),
    durationLabel: audioTime(audio.duration),
    dateLabel: audio.publishedAt.slice(0, 10).replace(/-/g, '.'),
    progressPercent: percent,
    progressLabel: audio.progress?.completed
      ? '已听完 · 再听一次'
      : percent > 0
        ? `继续收听 · ${percent}%`
        : '开始收听',
  };
}
export interface AudioListState {
  items: AudioCard[];
  loading: boolean;
  loadingMore: boolean;
  errorMessage: string;
  moreError: string;
  hasMore: boolean;
  previewMode: boolean;
}
export interface AudioListPort {
  scope(): AudioScope | null;
  previewMode(): boolean;
  ensureSession(): Promise<boolean>;
  list(cursor?: string): Promise<CursorPage<AudioSummary>>;
}
/** A page owns its list. Account/class changes and unload invalidate every pending response. */
export class AudioListController {
  private state: AudioListState = {
    items: [],
    loading: false,
    loadingMore: false,
    errorMessage: '',
    moreError: '',
    hasMore: false,
    previewMode: false,
  };
  private listeners = new Set<(state: AudioListState) => void>();
  private alive = true;
  private generation = 0;
  private owner = '';
  private cursor: string | undefined;
  private seenCursors = new Set<string>();
  constructor(private port: AudioListPort) {}
  subscribe(listener: (state: AudioListState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }
  private snapshot(): AudioListState {
    return { ...this.state, items: [...this.state.items] };
  }
  private emit(): void {
    if (this.alive) for (const listener of this.listeners) listener(this.snapshot());
  }
  invalidateScope(): void {
    const key = audioScopeKey(this.port.scope());
    if (key === this.owner) return;
    this.generation++;
    this.owner = key;
    this.cursor = undefined;
    this.seenCursors.clear();
    this.state = {
      items: [],
      loading: false,
      loadingMore: false,
      errorMessage: '',
      moreError: '',
      hasMore: false,
      previewMode: this.port.previewMode(),
    };
    this.emit();
  }
  async refresh(): Promise<void> {
    if (!this.alive) return;
    this.invalidateScope();
    const generation = ++this.generation;
    this.cursor = undefined;
    this.seenCursors.clear();
    this.state = {
      ...this.state,
      items: [],
      loading: true,
      loadingMore: false,
      errorMessage: '',
      moreError: '',
      hasMore: false,
      previewMode: this.port.previewMode(),
    };
    this.emit();
    try {
      if (!(await this.port.ensureSession()) || !this.valid(generation)) return;
      this.owner = audioScopeKey(this.port.scope());
      if (!this.owner) return;
      const page = await this.port.list();
      if (!this.valid(generation)) return;
      this.apply(page, false);
    } catch (error: unknown) {
      if (this.valid(generation)) this.state.errorMessage = this.message(error);
    } finally {
      if (this.valid(generation)) {
        this.state.loading = false;
        this.emit();
      }
    }
  }
  async loadMore(): Promise<void> {
    this.invalidateScope();
    if (
      !this.alive ||
      !this.owner ||
      this.state.loading ||
      this.state.loadingMore ||
      !this.state.hasMore ||
      !this.cursor
    )
      return;
    const generation = this.generation;
    this.state.loadingMore = true;
    this.state.moreError = '';
    this.emit();
    try {
      const page = await this.port.list(this.cursor);
      if (this.valid(generation)) this.apply(page, true);
    } catch (error: unknown) {
      if (this.valid(generation)) this.state.moreError = this.message(error);
    } finally {
      if (this.valid(generation)) {
        this.state.loadingMore = false;
        this.emit();
      }
    }
  }
  private valid(generation: number): boolean {
    return (
      this.alive &&
      generation === this.generation &&
      this.owner === audioScopeKey(this.port.scope())
    );
  }
  private apply(page: CursorPage<AudioSummary>, append: boolean): void {
    const schoolId = this.port.scope()?.schoolId;
    if (
      page.items.some((item) => item.schoolId !== schoolId) ||
      (page.nextCursor && this.seenCursors.has(page.nextCursor))
    )
      throw new CloudClientError('INVALID_RESPONSE', 'audio-list');
    const items = append ? [...this.state.items] : [];
    const known = new Set(items.map((item) => item._id));
    for (const item of page.items)
      if (!known.has(item._id)) {
        items.push(audioCard(item));
        known.add(item._id);
      }
    this.state.items = items;
    this.cursor = page.nextCursor;
    this.state.hasMore = Boolean(page.nextCursor);
    if (page.nextCursor) this.seenCursors.add(page.nextCursor);
  }
  private message(error: unknown): string {
    return error instanceof CloudClientError ? error.message : '夜话暂时无法加载，请重试';
  }
  dispose(): void {
    this.alive = false;
    this.generation++;
    this.listeners.clear();
  }
}
