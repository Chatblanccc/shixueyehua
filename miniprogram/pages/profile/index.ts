import { bindUserStore, unbindUserStore } from '../../components/session-page/bindings';
import { refreshCurrentClass } from '../../services/class-summary.service';
import { requireAdminSession, requireSession } from '../../services/session.service';
import { playerService } from '../../services/player.service';
import { userStore } from '../../stores/user.store';
import { localRepository } from '../../services/local.service';
import { localModeEnabled } from '../../services/local-mode';
import { startSession } from '../../services/session.service';
import { runInAction } from 'mobx-miniprogram';

Page({
  data: {
    loading: true,
    user: null,
    isOnboarded: false,
    isAdmin: false,
    previewMode: false,
    currentClass: null,
    classLoading: false,
    classError: '',
  },
  onLoad() {
    bindUserStore(this);
  },
  async onSwitchExperienceRole() {
    if (!localModeEnabled()) return;
    playerService.pause();
    await playerService.flushProgress();
    localRepository().setRole(userStore.user?.role === 'admin' ? 'user' : 'admin');
    runInAction(() => {
      userStore.scopeRevision++;
    });
    await startSession(true);
  },
  async onResetExperience() {
    if (!localModeEnabled()) return;
    const result = await wx.showModal({
      title: '重置本地体验？',
      content: '仅清除本机示例资料、节目、收藏与进度，并恢复初始示例。不会影响云端数据。',
      confirmText: '重置',
    });
    if (!result.confirm) return;
    playerService.pause();
    await playerService.flushProgress();
    localRepository().reset();
    playerService.clearScope();
    const storage = wx.getStorageInfoSync();
    for (const key of storage.keys)
      if (key.startsWith('shixue-progress-v1:') && key.includes('demo-listener'))
        wx.removeStorageSync(key);
    runInAction(() => {
      userStore.scopeRevision++;
    });
    await startSession(true);
  },
  async onShow() {
    if ((await requireSession()) && userStore.user) await refreshCurrentClass(true);
  },
  onHide() {
    void playerService.flushProgress();
  },
  onOpenFavorites() {
    void wx.navigateTo({ url: '/pages/audio-favorites/index' });
  },
  onOpenHistory() {
    void wx.navigateTo({ url: '/pages/audio-history/index' });
  },
  onUnload() {
    unbindUserStore(this);
  },
  async onOpenAdmin() {
    if (await requireAdminSession()) {
      void wx.navigateTo({ url: '/package-admin/pages/home/index' });
    }
  },
  async onEditProfile() {
    if (userStore.previewMode || (await requireSession())) {
      void wx.navigateTo({
        url: userStore.user ? '/pages/onboarding/identity?mode=edit' : '/pages/onboarding/identity',
      });
    }
  },
  async onSelectClass() {
    if (userStore.previewMode || (await requireSession())) {
      void wx.navigateTo({
        url: userStore.user ? '/pages/class-select/index?mode=switch' : '/pages/class-select/index',
      });
    }
  },
  async onRetryClass() {
    if (userStore.user && (await requireSession())) await refreshCurrentClass(true);
  },
});
