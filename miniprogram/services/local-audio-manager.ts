import type { AudioManagerPort } from './player-controller';
import { localRepository } from './local.service';

/** InnerAudioContext plays bundled/saved files without an AppID. Production keeps background audio. */
export function createLocalAudioManager(): AudioManagerPort {
  const audio = wx.createInnerAudioContext();
  audio.autoplay = true;
  let source = '';
  return {
    title: '',
    epname: '',
    singer: '',
    coverImgUrl: '',
    get src() {
      return source;
    },
    set src(value: string) {
      source = value;
      audio.src = localRepository().media(value);
    },
    get startTime() {
      return audio.startTime;
    },
    set startTime(value: number) {
      audio.startTime = value;
    },
    get duration() {
      return audio.duration;
    },
    get currentTime() {
      return audio.currentTime;
    },
    get paused() {
      return audio.paused;
    },
    play: () => audio.play(),
    pause: () => audio.pause(),
    stop: () => audio.stop(),
    seek: (value) => audio.seek(value),
    onPlay: (fn) => audio.onPlay(fn),
    onPause: (fn) => audio.onPause(fn),
    onStop: (fn) => audio.onStop(fn),
    onEnded: (fn) => audio.onEnded(fn),
    onError: (fn) => audio.onError(fn),
    onCanplay: (fn) => audio.onCanplay(fn),
    onWaiting: (fn) => audio.onWaiting(fn),
    onTimeUpdate: (fn) => audio.onTimeUpdate(fn),
    onSeeked: (fn) => audio.onSeeked(fn),
    // These system-panel callbacks only exist on the production background manager.
    onNext: () => undefined,
    onPrev: () => undefined,
  };
}
