import type { SessionDestination } from './session-controller';

const routes: Record<SessionDestination, string> = {
  launch: 'pages/launch/index',
  identity: 'pages/onboarding/identity',
  class: 'pages/class-select/index',
  ready: 'pages/night-talk/index',
};

interface NavigationPort {
  currentRoute(): string | undefined;
  waitUntilIdle(): Promise<void>;
  changeRoute(route: string, tab: boolean): Promise<void>;
}

/** Serialize session redirects before any await can let a second guard overtake. */
export class SessionNavigator {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly port: NavigationPort) {}

  navigate(destination: SessionDestination): Promise<void> {
    const task = this.tail.then(async () => {
      await this.port.waitUntilIdle();
      const route = routes[destination];
      if (this.port.currentRoute() === route) return;
      await this.port.changeRoute(route, destination === 'ready');
    });
    // A rejected native API is visible to its caller but cannot poison the queue.
    this.tail = task.catch(() => undefined);
    return task;
  }
}
