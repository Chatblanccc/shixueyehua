import { safetyMessage } from '../generated/shared';
import type { SafetyFeedback } from '../generated/shared';
import { localModeEnabled } from './local-mode';

/** Explicit demo controls for the upcoming letter UI. Never a real moderation classifier. */
export function localSafetyFeedback(
  scenario: 'pass' | 'review' | 'reject' | 'pending' | 'unavailable',
): SafetyFeedback {
  if (!localModeEnabled()) throw new Error('仅限已启用的无云开发体验');
  const status = scenario === 'pending' || scenario === 'unavailable' ? scenario : 'complete';
  const decision =
    status === 'complete' && (scenario === 'pass' || scenario === 'reject') ? scenario : 'review';
  return {
    decision,
    status,
    source: 'local-demo',
    message: `本地演示（非微信审核）：${safetyMessage(decision, status)}`,
  };
}
