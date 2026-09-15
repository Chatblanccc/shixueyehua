import { runInAction } from 'mobx-miniprogram';
import type { LoginResult } from '../generated/shared';
import type { UserStore } from '../stores/user.store';
import { CloudClientError } from './cloud-client';

export type SessionDestination = 'launch' | 'identity' | 'class' | 'ready';

export class SessionController {
  private inFlight: Promise<void> | null = null;
  private revision = 0;
  constructor(
    private readonly store: UserStore,
    private readonly login: () => Promise<LoginResult>,
    private readonly navigate: (destination: SessionDestination) => Promise<void>,
  ) {}

  async start(force = false): Promise<void> {
    await this.refresh(force);
    await this.route();
  }

  private async refresh(force = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (!force && this.store.user) return;
    const pending = this.load();
    this.inFlight = pending;
    try {
      await pending;
    } finally {
      if (this.inFlight === pending) this.inFlight = null;
    }
  }

  private async load(): Promise<void> {
    const revision = ++this.revision;
    runInAction(() => {
      this.store.loading = true;
      this.store.errorMessage = '';
      this.store.errorCode = '';
    });
    try {
      const result = await this.login();
      if (revision !== this.revision) return;
      if (result.user.status === 'deleted') throw new CloudClientError('USER_DELETED', 'session');
      runInAction(() => {
        this.store.user = result.user;
        this.store.onboardingStep = result.onboardingStep;
      });
    } catch (error: unknown) {
      if (revision !== this.revision) return;
      const failure =
        error instanceof CloudClientError
          ? error
          : new CloudClientError('NETWORK_ERROR', 'session');
      runInAction(() => {
        this.store.user = null;
        this.store.errorMessage = failure.message;
        this.store.errorCode = failure.code;
      });
    } finally {
      if (revision === this.revision)
        runInAction(() => {
          this.store.loading = false;
        });
    }
  }

  async requireSession(): Promise<boolean> {
    if (this.store.previewMode && !this.store.user) return true; // Empty shell only; no fake account.
    if (!this.store.user) await this.start();
    if (!this.store.user) {
      await this.navigate('launch');
      return false;
    }
    if (!this.store.isOnboarded) {
      await this.route();
      return false;
    }
    return true;
  }

  async requireAdminSession(): Promise<boolean> {
    // Refresh permission for each protected page entry, including after revocation.
    await this.refresh(true);
    if (!this.store.isAdmin) {
      await this.navigate(this.store.user && this.store.isOnboarded ? 'ready' : 'launch');
      return false;
    }
    if (!this.store.isOnboarded) {
      await this.route();
      return false;
    }
    return true;
  }

  clear(): void {
    this.revision++;
    this.inFlight = null;
    runInAction(() => {
      this.store.user = null;
      this.store.loading = false;
      this.store.errorMessage = '';
      this.store.errorCode = '';
      this.store.onboardingStep = 'identity';
    });
  }

  private async route(): Promise<void> {
    if (!this.store.user) return;
    await this.navigate(this.store.onboardingStep);
  }
}
