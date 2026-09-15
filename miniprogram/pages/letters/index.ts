import { bindUserStore, unbindUserStore } from '../../components/session-page/bindings';
import { requireSession } from '../../services/session.service';

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
});
