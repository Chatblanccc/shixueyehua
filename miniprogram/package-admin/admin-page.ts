import type { LoginResult, UserProfile } from '../generated/shared';
import { AdminPageGuard, requireAdminPage, wrapAdminAction } from '../services/admin-guard';
import { authService } from '../services/auth.service';
import { CloudClientError } from '../services/cloud-client';
import { recoverAdminSession, requireAdminSession } from '../services/session.service';
import { userStore } from '../stores/user.store';

interface AdminPageData {
  allowed: boolean;
  checking: boolean;
  user: UserProfile | null;
  permissionMessage: string;
}
interface AdminPageMethods {
  onRefreshPermission(): Promise<void>;
  onNavigate(event: WechatMiniprogram.TouchEvent): Promise<void>;
  onReturn(): void;
}
interface AdminPageOptions {
  superAdminOnly?: boolean;
  destinations?: readonly string[];
}
type AdminPage = WechatMiniprogram.Page.Instance<AdminPageData, AdminPageMethods>;
const guards = new WeakMap<AdminPage, AdminPageGuard>();

function assertAdminProfile(profile: LoginResult, superAdminOnly: boolean): void {
  const user = profile.user;
  if (user.status === 'deleted') throw new CloudClientError('USER_DELETED', 'admin-page');
  if (user.status !== 'active') throw new CloudClientError('USER_DISABLED', 'admin-page');
  if (
    profile.onboardingStep !== 'ready' ||
    (user.role !== 'super_admin' &&
      (superAdminOnly || user.role !== 'admin' || !user.adminSchoolId))
  )
    throw new CloudClientError('FORBIDDEN', 'admin-page');
}

/** Shared lifecycle wiring keeps every protected page, including deep links, fail-closed. */
export function createAdminPage(
  options: AdminPageOptions = {},
): WechatMiniprogram.Page.Options<AdminPageData, AdminPageMethods> {
  return {
    data: { allowed: false, checking: true, user: null, permissionMessage: '' },
    onLoad() {
      const guard = new AdminPageGuard({
        async requireAdminSession() {
          const allowed = await requireAdminSession();
          if (allowed) {
            const user = userStore.user;
            if (!user) throw new CloudClientError('UNAUTHORIZED', 'admin-page');
            assertAdminProfile(
              { user, onboardingStep: userStore.onboardingStep },
              options.superAdminOnly ?? false,
            );
          }
          return allowed;
        },
        clearPage: (checking) =>
          this.setData({ allowed: false, checking, user: null, permissionMessage: '' }),
        allowPage: () => this.setData({ allowed: true, checking: false, user: userStore.user }),
        showError: (error) =>
          this.setData({
            checking: false,
            permissionMessage:
              error instanceof CloudClientError
                ? error.message
                : '管理权限暂时无法核验，请稍后重试。',
          }),
        recoverAdminSession,
      });
      guards.set(this, guard);
      void requireAdminPage(guard);
    },
    onShow() {
      const guard = guards.get(this);
      if (guard) void requireAdminPage(guard);
    },
    onHide() {
      guards.get(this)?.hide();
    },
    onUnload() {
      guards.get(this)?.dispose();
      guards.delete(this);
    },
    async onRefreshPermission() {
      const guard = guards.get(this);
      if (!guard) return;
      await wrapAdminAction(
        guard,
        async () => {
          const result = await authService.getProfile();
          assertAdminProfile(result, options.superAdminOnly ?? false);
          return result.user;
        },
        (user) => this.setData({ user, permissionMessage: '管理权限已重新核验。' }),
      );
    },
    async onNavigate(event) {
      const destination: unknown = event.currentTarget.dataset.route;
      if (typeof destination !== 'string' || !options.destinations?.includes(destination)) return;
      const guard = guards.get(this);
      if (!guard) return;
      await wrapAdminAction(
        guard,
        async () => {
          if (destination === 'admin-manage' && userStore.user?.role !== 'super_admin')
            throw new CloudClientError('FORBIDDEN', 'admin-page');
          return destination;
        },
        (route) => void wx.navigateTo({ url: `/package-admin/pages/${route}/index` }),
      );
    },
    onReturn() {
      guards.get(this)?.hide();
      void wx.switchTab({ url: '/pages/profile/index' });
    },
  };
}
