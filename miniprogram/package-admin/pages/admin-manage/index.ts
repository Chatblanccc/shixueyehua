import { bindUserStore, unbindUserStore } from '../../../components/session-page/bindings';
import { requireAdminSession } from '../../../services/session.service';
import { userStore } from '../../../stores/user.store';

Page({
  data: { allowed: false },
  onLoad() {
    bindUserStore(this);
  },
  async onShow() {
    const authorized = await requireAdminSession();
    this.setData({ allowed: authorized && userStore.user?.role === 'super_admin' });
  },
  onUnload() {
    unbindUserStore(this);
  },
  onReturn() {
    void wx.switchTab({ url: '/pages/profile/index' });
  },
});
