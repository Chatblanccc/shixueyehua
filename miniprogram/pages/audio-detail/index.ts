import { reaction } from 'mobx-miniprogram';
import { bindUserStore, unbindUserStore } from '../../components/session-page/bindings';
import { userStore } from '../../stores/user.store';
import { audioService } from '../../services/audio.service';
import type { AudioDetailState } from '../../services/audio-detail-controller';
import { AudioDetailController } from '../../services/audio-detail-controller';
import { audioScopeKey } from '../../services/audio-list-controller';
import { currentAudioScope } from '../../services/audio-library-controller';
import { requireSession } from '../../services/session.service';
import { bindPlayerStore, unbindPlayerStore, playerService } from '../../services/player.service';

Page({
  data: {
    loading: true,
    user: null,
    isOnboarded: false,
    previewMode: false,
    detail: {
      audio: null,
      loading: false,
      errorMessage: '',
      unavailable: false,
      favoriteLoading: false,
      favoriteError: '',
      previewMode: false,
    } as AudioDetailState,
    failedCover: false,
    playerState: { audioId: '', status: 'idle' as string },
  },
  controller: null as AudioDetailController | null,
  stopScope: null as (() => void) | null,
  visible: false,
  onLoad(options: { audioId?: string }) {
    bindUserStore(this);
    bindPlayerStore(this);
    this.controller = new AudioDetailController(
      {
        scope: currentAudioScope,
        previewMode: () => userStore.previewMode,
        ensureSession: requireSession,
        detail: audioService.detail,
        favorite: audioService.toggleFavorite,
        favoriteChanged: playerService.setFavoriteFromServer,
      },
      options.audioId ?? '',
    );
    this.controller.subscribe((detail) => this.setData({ detail }));
    this.stopScope = reaction(
      () => audioScopeKey(currentAudioScope()),
      () => this.controller?.invalidateScope(),
    );
  },
  async onShow() {
    this.visible = true;
    const controller = this.controller;
    if ((await requireSession()) && this.visible && controller === this.controller)
      await controller?.load();
  },
  onHide() {
    this.visible = false;
    void playerService.flushProgress();
  },
  onUnload() {
    this.visible = false;
    this.stopScope?.();
    this.controller?.dispose();
    this.controller = null;
    unbindUserStore(this);
    unbindPlayerStore(this);
  },
  onRetry() {
    void this.controller?.load();
  },
  onCoverError() {
    this.setData({ failedCover: true });
  },
  onFavorite() {
    void this.controller?.toggleFavorite();
  },
  async onPlay() {
    const audio = this.data.detail.audio as { _id: string } | null;
    if (!audio || !currentAudioScope()) return;
    const player = this.data.playerState;
    if (player.audioId === audio._id && player.status === 'playing') playerService.pause();
    else if (player.audioId === audio._id && player.status === 'paused')
      await playerService.resume();
    else await playerService.play(audio._id);
  },
  onSeek(event: WechatMiniprogram.CustomEvent<{ value: number }>) {
    const audio = this.data.detail.audio as { _id: string } | null;
    if (
      audio &&
      this.data.playerState.audioId === audio._id &&
      typeof event.detail.value === 'number'
    )
      playerService.seek(event.detail.value);
  },
  onBack15() {
    playerService.skip(-15);
  },
  onForward15() {
    playerService.skip(15);
  },
  onPrevious() {
    const audio = this.data.detail.audio as { previousAudioId?: string } | null;
    if (audio?.previousAudioId) this.openRelated(audio.previousAudioId);
  },
  onNext() {
    const audio = this.data.detail.audio as { nextAudioId?: string } | null;
    if (audio?.nextAudioId) this.openRelated(audio.nextAudioId);
  },
  openRelated(id: string) {
    if (!currentAudioScope()) return;
    void playerService.play(id);
    void wx.redirectTo({ url: `/pages/audio-detail/index?audioId=${encodeURIComponent(id)}` });
  },
  onRetryPlayer() {
    void playerService.retry();
  },
  onRetryProgress() {
    void playerService.flushProgress();
  },
  onGoNightTalk() {
    void wx.switchTab({ url: '/pages/night-talk/index' });
  },
});
