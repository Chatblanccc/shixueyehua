import { autorun, reaction } from 'mobx-miniprogram';
import { playerStore } from '../stores/player.store';
import { userStore } from '../stores/user.store';
import { audioService } from './audio.service';
import { PlayerController } from './player-controller';
import { createLocalAudioManager } from './local-audio-manager';
import { localModeEnabled } from './local-mode';

const controller = new PlayerController(playerStore, {
  manager: () => (localModeEnabled() ? createLocalAudioManager() : wx.getBackgroundAudioManager()),
  detail: (audioId) => audioService.detail(audioId, true),
  favorite: (audioId, favorite) => audioService.toggleFavorite(audioId, favorite),
  progress: {
    now: Date.now,
    read: (key): unknown => wx.getStorageSync<unknown>(key),
    write: (key, records) => wx.setStorageSync(key, records),
    save: (audioId, currentTime) => audioService.saveProgress(audioId, currentTime),
  },
});

let initialized = false;
function initialize(): void {
  if (initialized) return;
  initialized = true;
  reaction(
    () => {
      const user = userStore.user;
      const scope =
        user &&
        user.status === 'active' &&
        !userStore.previewMode &&
        user.currentSchoolId &&
        user.currentGradeId &&
        user.currentClassId
          ? JSON.stringify([
              user._id,
              user.currentSchoolId,
              user.currentGradeId,
              user.currentClassId,
            ])
          : '';
      return JSON.stringify([scope, userStore.scopeRevision]);
    },
    () => {
      const user = userStore.user;
      const scope =
        user &&
        user.status === 'active' &&
        !userStore.previewMode &&
        user.currentSchoolId &&
        user.currentGradeId &&
        user.currentClassId
          ? JSON.stringify([
              user._id,
              user.currentSchoolId,
              user.currentGradeId,
              user.currentClassId,
            ])
          : '';
      controller.setScope(scope, userStore.scopeRevision);
    },
    { fireImmediately: true },
  );
  wx.onNetworkStatusChange(({ isConnected }) => controller.onNetworkChange(isConnected));
}

export const playerService = {
  initialize,
  play(audioId: string, queueIds?: string[]): Promise<void> {
    initialize();
    return controller.play(audioId, queueIds);
  },
  setQueue: (ids: string[]): void => controller.setQueue(ids),
  pause: (): void => controller.pause(),
  resume: (): Promise<void> => controller.resume(),
  seek: (seconds: number): void => controller.seek(seconds),
  skip: (delta: number): void => controller.skip(delta),
  prev: (): Promise<void> => controller.prev(),
  next: (): Promise<void> => controller.next(),
  retry: (): Promise<void> => controller.retry(),
  favorite: (desired: boolean): Promise<void> => controller.favorite(desired),
  setFavoriteFromServer: (audioId: string, favorite: boolean): void =>
    controller.setFavoriteFromServer(audioId, favorite),
  markUnavailable: (audioId: string): void => controller.markUnavailable(audioId),
  flushProgress: (): Promise<void> => controller.flushProgress(),
  clearScope: (): void => controller.setScope('', -1),
  onAppHide: (): void => {
    void controller.flushProgress();
  },
  onAppShow: (): void => controller.onAppShow(),
};

export function playerSnapshot() {
  return {
    audioId: playerStore.audioId,
    title: playerStore.title,
    speaker: playerStore.speaker,
    coverUrl: playerStore.coverUrl,
    status: playerStore.status,
    currentTime: playerStore.currentTime,
    duration: playerStore.duration,
    currentTimeLabel: playerStore.currentTimeLabel,
    durationLabel: playerStore.durationLabel,
    errorMessage: playerStore.errorMessage,
    syncError: playerStore.syncError,
    favorited: playerStore.favorited,
    favoriteLoading: playerStore.favoriteLoading,
    hasPrevious: playerStore.hasPrevious,
    hasNext: playerStore.hasNext,
    visible: playerStore.visible,
    progressPercent: playerStore.progressPercent,
  };
}

export type PlayerSnapshot = ReturnType<typeof playerSnapshot>;
interface BindingTarget {
  setData(data: Record<string, unknown>): void;
}
const bindings = new WeakMap<BindingTarget, () => void>();

export function bindPlayerStore(target: BindingTarget): void {
  unbindPlayerStore(target);
  bindings.set(
    target,
    autorun(() => target.setData({ playerState: playerSnapshot() })),
  );
}

export function unbindPlayerStore(target: BindingTarget): void {
  bindings.get(target)?.();
  bindings.delete(target);
}
