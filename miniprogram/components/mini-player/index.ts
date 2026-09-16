import {
  bindPlayerStore,
  playerService,
  playerSnapshot,
  unbindPlayerStore,
} from '../../services/player.service';

Component({
  properties: {
    compact: { type: Boolean, value: false },
  },
  data: { playerState: playerSnapshot() },
  lifetimes: {
    attached() {
      bindPlayerStore(this);
    },
    detached() {
      unbindPlayerStore(this);
    },
  },
  pageLifetimes: {
    hide() {
      void playerService.flushProgress();
    },
  },
  methods: {
    onToggle() {
      if (this.data.playerState.status === 'playing' || this.data.playerState.status === 'loading')
        playerService.pause();
      else if (this.data.playerState.status === 'error') void playerService.retry();
      else void playerService.resume();
    },
    onOpen() {
      const audioId = this.data.playerState.audioId;
      if (!audioId) return;
      const pages = getCurrentPages();
      if (pages[pages.length - 1]?.route === 'pages/audio-detail/index') return;
      void wx.navigateTo({
        url: `/pages/audio-detail/index?audioId=${encodeURIComponent(audioId)}`,
      });
    },
    onRetrySync() {
      void playerService.flushProgress();
    },
  },
});
