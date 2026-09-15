import { bindUserStore, unbindUserStore } from '../../components/session-page/bindings';
import { requireAdminSession, requireSession } from '../../services/session.service';

Page({
  data: { loading: true, user: null, isOnboarded: false, isAdmin: false, previewMode: false },
  onLoad() {
    bindUserStore(this);
  },
  onShow() {
    void requireSession();
  },
  onUnload() {
    unbindUserStore(this);
  },
  async onOpenAdmin() {
    if (await requireAdminSession()) {
      void wx.navigateTo({ url: '/package-admin/pages/home/index' });
    }
  },
  onConnect() {
    void wx.reLaunch({ url: '/pages/launch/index' });
  },
});
