import { observable } from 'mobx-miniprogram';
import type { CurrentClass, ErrorCode, OnboardingStep, UserProfile } from '../generated/shared';
import { environment } from '../config/env';
import { localModeEnabled } from '../services/local-mode';

export function createUserStore(previewMode = false) {
  return observable({
    loading: false,
    user: null as UserProfile | null,
    errorMessage: '',
    errorCode: '' as ErrorCode | '',
    onboardingStep: 'identity' as OnboardingStep,
    previewMode,
    localExperience: false,
    currentClass: null as CurrentClass | null,
    classLoading: false,
    classError: '',
    // Pages observe this revision to discard data from the previous class scope.
    scopeRevision: 0,
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
export const userStore = createUserStore(environment.previewMode && !localModeEnabled());
userStore.localExperience = localModeEnabled();
