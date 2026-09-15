import { bindUserStore, unbindUserStore } from '../../../components/session-page/bindings';
import { requireAdminSession } from '../../../services/session.service';

Page({
  data: { allowed: false },
  onLoad() {
    bindUserStore(this);
  },
  async onShow() {
    const authorized = await requireAdminSession();
    this.setData({ allowed: authorized });
  },
  onUnload() {
    unbindUserStore(this);
  },
  onReturn() {
    void wx.switchTab({ url: '/pages/profile/index' });
  },
});
