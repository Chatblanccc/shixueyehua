import { CloudClientError } from './cloud-client';

export interface AdminGuardPort {
  requireAdminSession(): Promise<boolean>;
  clearPage(checking: boolean): void;
  allowPage(): void;
  showError(error?: unknown): void;
  recoverAdminSession(): Promise<void>;
}

const deniedCodes = new Set([
  'FORBIDDEN',
  'SCHOOL_SCOPE_DENIED',
  'USER_DISABLED',
  'USER_DELETED',
  'UNAUTHORIZED',
]);

/** One instance per page. Page state is never authorized by an earlier lifecycle or action. */
export class AdminPageGuard {
  private revision = 0;
  private visible = true;
  private disposed = false;
  private allowed = false;
  private actionPending = false;

  constructor(private readonly port: AdminGuardPort) {}

  async requireAdminPage(): Promise<boolean> {
    if (this.disposed) return false;
    this.visible = true;
    return (await this.authorize()) !== undefined;
  }

  hide(): void {
    if (this.disposed) return;
    this.visible = false;
    this.revision++;
    this.allowed = false;
    this.port.clearPage(false);
  }

  dispose(): void {
    this.disposed = true;
    this.visible = false;
    this.allowed = false;
    this.revision++;
  }

  async wrapAdminAction<T>(action: () => Promise<T>, commit: (value: T) => void): Promise<boolean> {
    if (this.disposed || !this.visible || !this.allowed || this.actionPending) return false;
    this.actionPending = true;
    let revision: number | undefined;
    try {
      revision = await this.authorize();
      if (revision === undefined || !this.isCurrent(revision)) return false;
      const value = await action();
      if (!this.isCurrent(revision)) return false;
      commit(value);
      return true;
    } catch (error: unknown) {
      if (revision !== undefined && this.isCurrent(revision)) await this.handleFailure(error);
      return false;
    } finally {
      this.actionPending = false;
    }
  }

  private isCurrent(revision: number): boolean {
    return !this.disposed && this.visible && this.revision === revision;
  }

  private async authorize(): Promise<number | undefined> {
    const revision = ++this.revision;
    this.allowed = false;
    this.port.clearPage(true);
    try {
      const allowed = await this.port.requireAdminSession();
      if (!this.isCurrent(revision)) return;
      if (!allowed) {
        this.port.clearPage(false);
        this.port.showError();
        return;
      }
      this.allowed = true;
      this.port.allowPage();
      return revision;
    } catch (error: unknown) {
      if (this.isCurrent(revision)) await this.handleFailure(error);
      return;
    }
  }

  private async handleFailure(error: unknown): Promise<void> {
    if (error instanceof CloudClientError && deniedCodes.has(error.code)) {
      // Invalidate other pending work before any refresh or navigation can yield.
      this.revision++;
      this.allowed = false;
      this.port.clearPage(false);
      this.port.showError(error);
      try {
        await this.port.recoverAdminSession();
      } catch {
        // Keep the page locked even if recovery/navigation fails. The return button remains.
      }
      return;
    }
    this.port.showError(error);
  }
}

export const requireAdminPage = (guard: AdminPageGuard): Promise<boolean> =>
  guard.requireAdminPage();

export const wrapAdminAction = <T>(
  guard: AdminPageGuard,
  action: () => Promise<T>,
  commit: (value: T) => void,
): Promise<boolean> => guard.wrapAdminAction(action, commit);
