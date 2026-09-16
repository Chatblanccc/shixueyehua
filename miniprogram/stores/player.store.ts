import { observable } from 'mobx-miniprogram';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export function createPlayerStore() {
  return observable({
    audioId: '',
    title: '',
    speaker: '',
    coverUrl: '',
    status: 'idle' as PlayerStatus,
    currentTime: 0,
    duration: 0,
    errorMessage: '',
    syncError: '',
    favorited: false,
    favoriteLoading: false,
    hasPrevious: false,
    hasNext: false,
    get visible(): boolean {
      return this.audioId.length > 0;
    },
    get progressPercent(): number {
      return this.duration > 0 ? Math.min(100, (this.currentTime / this.duration) * 100) : 0;
    },
    get currentTimeLabel(): string {
      return formatTime(this.currentTime);
    },
    get durationLabel(): string {
      return formatTime(this.duration);
    },
  });
}

export type PlayerStore = ReturnType<typeof createPlayerStore>;
export const playerStore = createPlayerStore();

function formatTime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
