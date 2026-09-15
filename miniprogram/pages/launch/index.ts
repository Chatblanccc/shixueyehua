import { bindUserStore, unbindUserStore } from '../../components/session-page/bindings';
import { startSession } from '../../services/session.service';
import { userStore } from '../../stores/user.store';

Page({
  data: { loading: true, errorMessage: '', previewMode: false },
  onLoad() {
    bindUserStore(this);
    void startSession();
  },
  onUnload() {
    unbindUserStore(this);
  },
  onRetry() {
    void startSession(true);
  },
  onPreview() {
    if (userStore.previewMode) {
      void wx.switchTab({ url: '/pages/night-talk/index' });
    }
  },
});
