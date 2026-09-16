import type { AudioDetail, FavoriteResult } from '../generated/shared';
import { CloudClientError } from './cloud-client';
import { audioCard, audioScopeKey } from './audio-list-controller';
import type { AudioCard, AudioScope } from './audio-list-controller';

export type AudioDetailView = AudioDetail & AudioCard;
export interface AudioDetailState {
  audio: AudioDetailView | null;
  loading: boolean;
  errorMessage: string;
  unavailable: boolean;
  favoriteLoading: boolean;
  favoriteError: string;
  previewMode: boolean;
}
export interface AudioDetailPort {
  scope(): AudioScope | null;
  previewMode(): boolean;
  ensureSession(): Promise<boolean>;
  detail(audioId: string): Promise<AudioDetail>;
  favorite(audioId: string, desired: boolean): Promise<FavoriteResult>;
  favoriteChanged?(audioId: string, desired: boolean): void;
}
export class AudioDetailController {
  private state: AudioDetailState = {
    audio: null,
    loading: false,
    errorMessage: '',
    unavailable: false,
    favoriteLoading: false,
    favoriteError: '',
    previewMode: false,
  };
  private listeners = new Set<(state: AudioDetailState) => void>();
  private alive = true;
  private generation = 0;
  private owner = '';
  constructor(
    private port: AudioDetailPort,
    private audioId: string,
  ) {}
  subscribe(listener: (state: AudioDetailState) => void): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    if (this.alive) for (const listener of this.listeners) listener({ ...this.state });
  }
  invalidateScope(): void {
    const key = audioScopeKey(this.port.scope());
    if (key === this.owner) return;
    this.owner = key;
    this.generation++;
    this.state = {
      audio: null,
      loading: false,
      errorMessage: '',
      unavailable: false,
      favoriteLoading: false,
      favoriteError: '',
      previewMode: this.port.previewMode(),
    };
    this.emit();
  }
  async load(): Promise<void> {
    if (!this.alive) return;
    this.invalidateScope();
    const generation = ++this.generation;
    this.state = {
      ...this.state,
      audio: null,
      loading: true,
      errorMessage: '',
      unavailable: false,
      favoriteError: '',
      favoriteLoading: false,
      previewMode: this.port.previewMode(),
    };
    this.emit();
    try {
      if (!(await this.port.ensureSession()) || !this.valid(generation)) return;
      if (!this.owner) return;
      if (!/^[\w-]{1,128}$/.test(this.audioId))
        throw new CloudClientError('AUDIO_NOT_FOUND', 'audio-detail');
      const audio = await this.port.detail(this.audioId);
      if (!this.valid(generation)) return;
      if (audio._id !== this.audioId || audio.schoolId !== this.port.scope()?.schoolId)
        throw new CloudClientError('INVALID_RESPONSE', 'audio-detail');
      this.state.audio = { ...audio, ...audioCard(audio) };
    } catch (error: unknown) {
      if (this.valid(generation)) this.fail(error);
    } finally {
      if (this.valid(generation)) {
        this.state.loading = false;
        this.emit();
      }
    }
  }
  async toggleFavorite(): Promise<void> {
    this.invalidateScope();
    const audio = this.state.audio;
    if (!this.alive || !audio || this.state.favoriteLoading || !this.owner) return;
    const generation = this.generation;
    this.state.favoriteLoading = true;
    this.state.favoriteError = '';
    this.emit();
    try {
      const result = await this.port.favorite(audio._id, !audio.favorite);
      if (!this.valid(generation)) return;
      if (result.audioId !== audio._id || result.favorite !== !audio.favorite)
        throw new CloudClientError('INVALID_RESPONSE', 'audio-favorite');
      this.state.audio = { ...audio, favorite: result.favorite };
      this.port.favoriteChanged?.(audio._id, result.favorite);
    } catch (error: unknown) {
      if (!this.valid(generation)) return;
      if (
        error instanceof CloudClientError &&
        [
          'AUDIO_NOT_FOUND',
          'FORBIDDEN',
          'SCHOOL_SCOPE_DENIED',
          'USER_DISABLED',
          'UNAUTHORIZED',
          'USER_DELETED',
        ].includes(error.code)
      )
        this.fail(error);
      else this.state.favoriteError = this.message(error);
    } finally {
      if (this.valid(generation)) {
        this.state.favoriteLoading = false;
        this.emit();
      }
    }
  }
  private fail(error: unknown): void {
    this.state.audio = null;
    this.state.unavailable =
      error instanceof CloudClientError &&
      ['AUDIO_NOT_FOUND', 'FORBIDDEN', 'SCHOOL_SCOPE_DENIED'].includes(error.code);
    this.state.errorMessage = this.state.unavailable
      ? '这期夜话已下架，或不在当前班级的可见范围内。'
      : this.message(error);
  }
  private message(error: unknown): string {
    return error instanceof CloudClientError ? error.message : '夜话暂时无法加载，请重试';
  }
  private valid(generation: number): boolean {
    return (
      this.alive &&
      generation === this.generation &&
      this.owner === audioScopeKey(this.port.scope())
    );
  }
  dispose(): void {
    this.alive = false;
    this.generation++;
    this.listeners.clear();
  }
}
