import { initializeCloud } from './config/env';
import { initializeRouteTransitions } from './services/route-transition';

App({
  onLaunch() {
    initializeRouteTransitions();
    initializeCloud();
  },
});
