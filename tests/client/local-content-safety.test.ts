import { afterEach, describe, expect, it, vi } from 'vitest';
import { localSafetyFeedback } from '../../miniprogram/services/local-content-safety';
import { environment } from '../../miniprogram/config/env';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('explicit local safety demo', () => {
  it.each(['pass', 'review', 'reject', 'pending', 'unavailable'] as const)(
    'labels %s as demo, never WeChat approval',
    (scenario) => {
      vi.stubGlobal('wx', { getStorageSync: () => true });
      const result = localSafetyFeedback(scenario);
      expect(result.source).toBe('local-demo');
      expect(result.message).toContain('非微信审核');
      expect(result.status).toBe(
        scenario === 'pending' || scenario === 'unavailable' ? scenario : 'complete',
      );
    },
  );
  it('requires explicit opt-in', () => {
    vi.stubGlobal('wx', { getStorageSync: () => false });
    expect(() => localSafetyFeedback('pass')).toThrow('仅限');
  });
  it('fails closed with unreadable opt-in', () => {
    vi.stubGlobal('wx', {
      getStorageSync: () => {
        throw new Error('unavailable');
      },
    });
    expect(() => localSafetyFeedback('pass')).toThrow('仅限');
  });
  it('cannot operate when cloud is configured', () => {
    vi.stubGlobal('wx', { getStorageSync: () => true });
    const config: { cloudConfigured: boolean } = environment;
    const previous = config.cloudConfigured;
    try {
      config.cloudConfigured = true;
      expect(() => localSafetyFeedback('pass')).toThrow('仅限');
    } finally {
      config.cloudConfigured = previous;
    }
  });
});
