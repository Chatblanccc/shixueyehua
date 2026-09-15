import { authService } from './auth.service';
import { SessionController } from './session-controller';
import { SessionNavigator } from './session-navigator';
import { userStore } from '../stores/user.store';
import { routeTransition } from './route-transition';

const navigator = new SessionNavigator({
  currentRoute() {
    const pages = getCurrentPages();
    return pages[pages.length - 1]?.route;
  },
  waitUntilIdle: () => routeTransition.waitUntilIdle(),
  changeRoute(route, tab) {
    return new Promise<void>((resolve, reject) => {
      const options = {
        url: `/${route}`,
        success: () => resolve(),
        fail: () => reject(new Error('页面暂时无法打开')),
      };
      if (tab) wx.switchTab(options);
      else wx.reLaunch(options);
    });
  },
});

const controller = new SessionController(userStore, authService.login, (destination) =>
  navigator.navigate(destination),
);
export const startSession = (force = false): Promise<void> => controller.start(force);
export const requireSession = (): Promise<boolean> => controller.requireSession();
export const requireAdminSession = (): Promise<boolean> => controller.requireAdminSession();

export const ensureUserSession = (): Promise<boolean> => controller.ensureUser();
export const mutateSession = (action: () => Promise<import('../generated/shared').LoginResult>) =>
  controller.mutate(action);
export const recoverAdminSession = (): Promise<void> => controller.recoverAdminSession();
