import { LocalRepository } from './local-repository';
import { localModeEnabled } from './local-mode';
const repository = new LocalRepository({
  read: () => wx.getStorageSync<unknown>('shixue-local-data-v1'),
  write: (value) => wx.setStorageSync('shixue-local-data-v1', value),
  now: Date.now,
});
export function localRepository(): LocalRepository {
  if (!localModeEnabled()) throw new Error('本地体验未启用');
  return repository;
}
