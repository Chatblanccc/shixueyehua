import { bindUserStore, unbindUserStore } from '../../components/session-page/bindings';
import { refreshCurrentClass } from '../../services/class-summary.service';
import { requireAdminSession, requireSession } from '../../services/session.service';
import { userStore } from '../../stores/user.store';

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
  async onShow() {
    if ((await requireSession()) && userStore.user) await refreshCurrentClass(true);
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
