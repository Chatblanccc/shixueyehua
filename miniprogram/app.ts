import { initializeCloud } from './config/env';
import { playerService } from './services/player.service';
import { initializeRouteTransitions } from './services/route-transition';

App({
  onLaunch() {
    initializeRouteTransitions();
    initializeCloud();
    playerService.initialize();
  },
  onHide() {
    playerService.onAppHide();
  },
  onShow() {
    playerService.onAppShow();
  },
});
