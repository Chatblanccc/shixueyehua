import { createStoreBindings } from 'mobx-miniprogram-bindings';
import { userStore } from '../../stores/user.store';

type BindingTarget = Parameters<typeof createStoreBindings>[0];
type Binding = ReturnType<typeof createStoreBindings>;

const bindings = new WeakMap<BindingTarget, Binding>();

/** Keep page state reactive without sharing bindings between page instances. */
export function bindUserStore(target: BindingTarget): void {
  bindings.get(target)?.destroyStoreBindings();
  const binding = createStoreBindings(target, {
    store: userStore,
    fields: [
      'loading',
      'user',
      'isOnboarded',
      'isAdmin',
      'onboardingStep',
      'errorMessage',
      'previewMode',
      'currentClass',
      'classLoading',
      'classError',
      'scopeRevision',
    ],
    actions: [],
  });
  bindings.set(target, binding);
  binding.updateStoreBindings();
}

export function unbindUserStore(target: BindingTarget): void {
  bindings.get(target)?.destroyStoreBindings();
  bindings.delete(target);
}
