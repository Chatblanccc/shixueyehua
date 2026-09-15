import { bindUserStore, unbindUserStore } from '../../components/session-page/bindings';
import { requireSession } from '../../services/session.service';
import { userStore } from '../../stores/user.store';

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
  async onSelectClass() {
    if (userStore.user && (await requireSession())) {
      void wx.navigateTo({ url: '/pages/class-select/index' });
    }
  },
  onConnect() {
    void wx.reLaunch({ url: '/pages/launch/index' });
  },
});
