import { reaction } from 'mobx-miniprogram';
import { bindUserStore, unbindUserStore } from '../components/session-page/bindings';
import { userStore } from '../stores/user.store';
import { audioService } from './audio.service';
import { AudioListController, audioScopeKey } from './audio-list-controller';
import type { AudioScope, AudioCard, AudioListState } from './audio-list-controller';
import type { UserProfile } from '../generated/shared';
import { requireSession } from './session.service';
import { refreshCurrentClass } from './class-summary.service';
import { playerService } from './player.service';

export function currentAudioScope(): AudioScope | null {
  const user = userStore.user;
  return user && user.status === 'active' && user.currentSchoolId && user.currentClassId
    ? {
        userId: user._id,
        schoolId: user.currentSchoolId,
        classId: user.currentClassId,
        revision: userStore.scopeRevision,
      }
    : null;
}
interface AudioLibraryData {
  loading: boolean;
  user: UserProfile | null;
  isOnboarded: boolean;
  isAdmin: boolean;
  previewMode: boolean;
  audioList: AudioListState;
  featured: AudioCard | null;
  programs: AudioCard[];
  failedCovers: Record<string, boolean>;
}
interface AudioLibraryMethods {
  controller: AudioListController | null;
  stopScope: (() => void) | null;
  visible: boolean;
  onRetry(): void;
  onLoadMore(): void;
  onCoverError(event: WechatMiniprogram.BaseEvent): void;
  onOpenAudio(event: WechatMiniprogram.BaseEvent): Promise<void>;
  onOpenHistory(): void;
  onGoNightTalk(): void;
}
export function createAudioLibraryPage(
  kind: 'all' | 'history' | 'favorites',
): WechatMiniprogram.Page.Options<AudioLibraryData, AudioLibraryMethods> {
  return {
    data: {
      loading: true,
      user: null,
      isOnboarded: false,
      isAdmin: false,
      previewMode: false,
      audioList: {
        items: [],
        loading: false,
        loadingMore: false,
        errorMessage: '',
        moreError: '',
        hasMore: false,
        previewMode: false,
      },
      featured: null,
      programs: [],
      failedCovers: {} as Record<string, boolean>,
    },
    controller: null as AudioListController | null,
    stopScope: null as (() => void) | null,
    visible: false,
    onLoad() {
      bindUserStore(this);
      this.controller = new AudioListController({
        scope: currentAudioScope,
        previewMode: () => userStore.previewMode,
        ensureSession: requireSession,
        list:
          kind === 'history'
            ? audioService.history
            : kind === 'favorites'
              ? audioService.listFavorites
              : audioService.list,
      });
      this.controller.subscribe((state) =>
        this.setData({
          audioList: state,
          featured: kind === 'all' ? (state.items[0] ?? null) : null,
          programs: kind === 'all' ? state.items.slice(1) : state.items,
        }),
      );
      this.stopScope = reaction(
        () => audioScopeKey(currentAudioScope()),
        () => this.controller?.invalidateScope(),
      );
    },
    async onShow() {
      this.visible = true;
      const controller = this.controller;
      if (
        !(await requireSession()) ||
        !this.visible ||
        !controller ||
        controller !== this.controller
      )
        return;
      if (userStore.user) void refreshCurrentClass(true);
      await controller.refresh();
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
    },
    onPullDownRefresh() {
      void this.controller?.refresh().finally(() => wx.stopPullDownRefresh());
    },
    onReachBottom() {
      void this.controller?.loadMore();
    },
    onRetry() {
      void this.controller?.refresh();
    },
    onLoadMore() {
      void this.controller?.loadMore();
    },
    onCoverError(event: WechatMiniprogram.BaseEvent) {
      const id: unknown = event.currentTarget.dataset.id;
      if (typeof id === 'string')
        this.setData({ failedCovers: { ...this.data.failedCovers, [id]: true } });
    },
    async onOpenAudio(event: WechatMiniprogram.BaseEvent) {
      const id: unknown = event.currentTarget.dataset.id;
      const current = this.data.audioList.items;
      if (typeof id !== 'string' || !current.some((item) => item._id === id)) return;
      const scope = audioScopeKey(currentAudioScope());
      if (
        !(await requireSession()) ||
        !this.visible ||
        !scope ||
        scope !== audioScopeKey(currentAudioScope())
      )
        return;
      playerService.setQueue(current.map((item) => item._id));
      void wx.navigateTo({ url: `/pages/audio-detail/index?audioId=${encodeURIComponent(id)}` });
    },
    onOpenHistory() {
      void wx.navigateTo({ url: '/pages/audio-history/index' });
    },
    onGoNightTalk() {
      void wx.switchTab({ url: '/pages/night-talk/index' });
    },
  };
}
