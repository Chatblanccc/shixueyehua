import { bindUserStore, unbindUserStore } from '../../components/session-page/bindings';
import { startSession } from '../../services/session.service';
import { userStore } from '../../stores/user.store';
import { enableLocalMode } from '../../services/local-mode';
import { runInAction } from 'mobx-miniprogram';

Page({
  data: { loading: true, errorMessage: '', previewMode: false },
  onLoad() {
    bindUserStore(this);
    void startSession(true);
  },
  onUnload() {
    unbindUserStore(this);
  },
  onRetry() {
    void startSession(true);
  },
  onPreview() {
    if (userStore.previewMode) {
      enableLocalMode();
      runInAction(() => {
        userStore.previewMode = false;
        userStore.localExperience = true;
      });
      void startSession(true);
    }
  },
});
