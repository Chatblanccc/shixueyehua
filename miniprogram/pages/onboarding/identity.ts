import { bindUserStore, unbindUserStore } from '../../components/session-page/bindings';
import { startSession } from '../../services/session.service';

Page({
  data: { loading: false, errorMessage: '', previewMode: false },
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
});
