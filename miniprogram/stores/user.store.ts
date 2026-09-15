import { observable } from 'mobx-miniprogram';
import type { ErrorCode, OnboardingStep, UserProfile } from '../generated/shared';
import { environment } from '../config/env';

export function createUserStore(previewMode = false) {
  return observable({
    loading: false,
    user: null as UserProfile | null,
    errorMessage: '',
    errorCode: '' as ErrorCode | '',
    onboardingStep: 'identity' as OnboardingStep,
    previewMode,
    get isOnboarded(): boolean {
      return this.user !== null && this.onboardingStep === 'ready';
    },
    get isAdmin(): boolean {
      const user = this.user;
      return Boolean(
        user &&
        user.status === 'active' &&
        (user.role === 'super_admin' || (user.role === 'admin' && user.adminSchoolId)),
      );
    },
  });
}

export type UserStore = ReturnType<typeof createUserStore>;
export const userStore = createUserStore(environment.previewMode);
