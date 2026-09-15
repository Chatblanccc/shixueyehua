import { runtimeConfig } from '../generated/env';

export const environment = runtimeConfig;

export function initializeCloud(): boolean {
  if (!runtimeConfig.cloudConfigured || !runtimeConfig.envId || !wx.cloud) return false;
  wx.cloud.init({ env: runtimeConfig.envId, traceUser: true });
  return true;
}
