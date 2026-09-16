/** Public projection only: no platform labels, trace IDs, text or credentials. */
export interface SafetyFeedback {
  decision: 'pass' | 'review' | 'reject';
  status: 'complete' | 'pending' | 'unavailable';
  source: 'wechat' | 'local-demo';
  message: string;
}

export function safetyMessage(
  decision: SafetyFeedback['decision'],
  status: SafetyFeedback['status'],
): string {
  if (status === 'unavailable') return '暂时无法完成内容检查，草稿可保留，请稍后重试';
  if (status === 'pending') return '图片正在检查中，请稍后重试；草稿可保留';
  if (decision === 'reject') return '内容暂时无法提交，请修改后重试';
  if (decision === 'review') return '内容需要进一步人工复核，尚未公开';
  return '内容检查完成，公开展示仍需管理员审核';
}
