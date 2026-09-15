/**
 * Version 7.0.0 publishes its runtime but omits the .d.ts named by package.json.
 * This declaration describes the small, verified runtime surface used here.
 */
declare module 'mobx-miniprogram-bindings' {
  export interface StoreBindingTarget {
    setData(data: Record<string, unknown>): void;
  }

  export interface StoreBindingsManager {
    updateStoreBindings(): void;
    destroyStoreBindings(): void;
  }

  export function createStoreBindings<TStore extends object>(
    target: StoreBindingTarget,
    options: {
      store: TStore;
      fields: Extract<keyof TStore, string>[];
      actions: never[];
    },
  ): StoreBindingsManager;
}
