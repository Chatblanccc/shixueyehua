export interface RouteEvent {
  routeEventId: string;
  path: string;
  openType: string;
  webviewId: number;
}

/** Wait for the current native route animation before a session guard redirects. */
export class RouteTransition {
  private readonly active = new Map<string, RouteEvent>();
  private readonly waiters = new Set<() => void>();
  private sequence = 0;

  begin(event: RouteEvent): void {
    this.active.set(event.routeEventId || `missing-id:${++this.sequence}`, { ...event });
  }

  complete(event: RouteEvent): void {
    if (event.routeEventId) {
      this.active.delete(event.routeEventId);
    } else {
      // DevTools 3.17.3 sends an empty id for reLaunch's completion event.
      // Match the exact native page only when there is one unambiguous candidate.
      const matches = [...this.active.entries()].filter(
        ([, pending]) =>
          pending.path === event.path &&
          pending.openType === event.openType &&
          pending.webviewId === event.webviewId,
      );
      if (matches.length === 1 && matches[0]) this.active.delete(matches[0][0]);
    }
    if (this.active.size) return;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }

  waitUntilIdle(timeoutMs = 10000): Promise<void> {
    if (!this.active.size) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiters.delete(done);
        reject(new Error('页面切换未完成，请重新打开小程序'));
      }, timeoutMs);
      this.waiters.add(done);
    });
  }
}

export const routeTransition = new RouteTransition();
let initialized = false;

/** Requires the documented route event contract from base library >=3.5.5. */
export function initializeRouteTransitions(): void {
  if (initialized) return;
  initialized = true;
  wx.onBeforeAppRoute((event) => {
    if (!event.notFound) routeTransition.begin(event);
  });
  wx.onAppRouteDone((event) => routeTransition.complete(event));
}
