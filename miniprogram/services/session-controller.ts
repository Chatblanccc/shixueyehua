import { runInAction } from 'mobx-miniprogram';
import { parseLoginResult } from '../generated/shared';
import type { LoginResult } from '../generated/shared';
import type { UserStore } from '../stores/user.store';
import { CloudClientError } from './cloud-client';

export type SessionDestination = 'launch' | 'identity' | 'class' | 'ready';

export class SessionController {
  private inFlight: Promise<void> | null = null;
  private revision = 0;
  private epoch = 0;
  private mutations: Promise<unknown> = Promise.resolve();
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
    if (this.inFlight && !force) return this.inFlight;
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
      this.applyResult(result);
    } catch (error: unknown) {
      if (revision !== this.revision) return;
      const failure =
        error instanceof CloudClientError
          ? error
          : new CloudClientError('NETWORK_ERROR', 'session');
      runInAction(() => {
        this.clearScope();
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
    if (!this.store.user) await this.refresh();
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
    // An unauthenticated preview never starts a cloud request to prove it has no permission.
    if (this.store.previewMode && !this.store.user) {
      await this.navigate('launch');
      return false;
    }
    // Refresh permission for each protected page entry, including after revocation.
    const pending = this.refresh(true);
    const revision = this.revision;
    await pending;
    if (revision !== this.revision) return false;
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
    this.epoch++;
    this.inFlight = null;
    runInAction(() => {
      this.clearScope();
      this.store.user = null;
      this.store.loading = false;
      this.store.errorMessage = '';
      this.store.errorCode = '';
      this.store.onboardingStep = 'identity';
    });
  }

  /** Profile editing must not immediately route an already-onboarded user away. */
  async ensureUser(): Promise<boolean> {
    if (this.store.previewMode && !this.store.user) return false;
    await this.refresh();
    if (!this.store.user) {
      await this.navigate('launch');
      return false;
    }
    return true;
  }

  /** Serialize writes and reject responses from an invalidated/replaced session. */
  mutate(action: () => Promise<LoginResult>): Promise<LoginResult> {
    const owner = this.store.user?._id;
    const epoch = this.epoch;
    const task = this.mutations.then(async () => {
      const user = this.store.user;
      if (!owner || !user || user._id !== owner || epoch !== this.epoch)
        throw new CloudClientError('UNAUTHORIZED', 'session');
      if (user.status !== 'active') throw new CloudClientError('USER_DISABLED', 'session');
      const revision = ++this.revision;
      this.inFlight = null;
      const result = parseLoginResult(await action());
      if (revision !== this.revision || this.store.user?._id !== owner)
        throw new CloudClientError('UNAUTHORIZED', 'stale-session');
      if (result.user._id !== owner) throw new CloudClientError('INVALID_RESPONSE', 'session');
      if (result.user.status !== 'active') throw new CloudClientError('USER_DISABLED', 'session');
      this.applyResult(result);
      return result;
    });
    this.mutations = task.catch(() => undefined);
    return task;
  }

  /** Any rejected management operation exits its page, even if a refresh still says admin. */
  async recoverAdminSession(): Promise<void> {
    this.clear();
    if (!this.store.previewMode) await this.refresh(true);
    await this.navigate(this.store.user && this.store.isOnboarded ? 'ready' : 'launch');
  }

  private clearScope(): void {
    this.store.currentClass = null;
    this.store.classLoading = false;
    this.store.classError = '';
    this.store.scopeRevision += 1;
  }

  private applyResult(result: LoginResult): void {
    const before = this.store.user;
    runInAction(() => {
      if (
        before?._id !== result.user._id ||
        before.currentSchoolId !== result.user.currentSchoolId ||
        before.currentGradeId !== result.user.currentGradeId ||
        before.currentClassId !== result.user.currentClassId
      )
        this.clearScope();
      this.store.user = result.user;
      this.store.onboardingStep = result.onboardingStep;
      this.store.loading = false;
      this.store.errorCode = '';
      this.store.errorMessage = '';
    });
  }

  private async route(): Promise<void> {
    if (!this.store.user) return;
    await this.navigate(this.store.onboardingStep);
  }
}
