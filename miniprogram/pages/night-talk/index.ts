import { bindUserStore, unbindUserStore } from '../../components/session-page/bindings';
import { refreshCurrentClass } from '../../services/class-summary.service';
import { userStore } from '../../stores/user.store';
import { requireSession } from '../../services/session.service';

Page({
  data: { loading: true, user: null, isOnboarded: false, isAdmin: false, previewMode: false },
  onLoad() {
    bindUserStore(this);
  },
  onShow() {
    void requireSession().then((allowed) => {
      if (allowed && userStore.user) void refreshCurrentClass(true);
    });
  },
  onUnload() {
    unbindUserStore(this);
  },
});
