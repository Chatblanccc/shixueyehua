import { environment } from '../config/env';

/** Explicit opt-in, dev only. Never used as a fallback after a cloud error. */
export function localModeAvailable(): boolean {
  return allowsLocalMode(environment);
}
export function allowsLocalMode(config: {
  environment: string;
  cloudConfigured: boolean;
  envId: string;
}): boolean {
  return config.environment === 'dev' && !config.cloudConfigured && !config.envId;
}
export function localModeEnabled(): boolean {
  if (!localModeAvailable() || typeof wx === 'undefined') return false;
  try {
    return wx.getStorageSync<unknown>('shixue-local-enabled-v1') === true;
  } catch {
    return false;
  }
}
export function enableLocalMode(): void {
  if (!localModeAvailable()) throw new Error('当前环境不允许本地体验');
  wx.setStorageSync('shixue-local-enabled-v1', true);
}
