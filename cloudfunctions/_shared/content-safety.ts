import { isRecord, safetyMessage } from '../../shared';
import type { SafetyFeedback } from '../../shared';
import { AppError } from './errors';

/** Internal server result. Never return this whole object to an author/public page. */
export interface SafetyResult {
  decision: SafetyFeedback['decision'];
  status: SafetyFeedback['status'];
  provider: 'wechat-v2';
  checkedAt: Date;
  labels: number[];
  traceIds: string[];
}
export interface SafetyPlatform {
  text(input: {
    openid: string;
    version: 2;
    scene: 3;
    title: string;
    content: string;
  }): Promise<unknown>;
  image(input: {
    openid: string;
    version: 2;
    scene: 3;
    mediaUrl: string;
    mediaType: 2;
  }): Promise<unknown>;
}
/** Must be loaded from the authenticated server-side user, never request payload. */
export interface SafetyActor {
  openid: string;
}
export interface ResolvedSafetyImage {
  url: string;
  size: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/bmp' | 'image/gif';
}
export interface SafetyDependencies {
  platform: SafetyPlatform;
  /** Verify actor ownership, validated bytes, immutable file and URL lifetime before returning. */
  resolveImage?: (actor: SafetyActor, fileId: string) => Promise<ResolvedSafetyImage>;
  timeoutMs?: number;
  now?: () => Date;
}
export interface ContentSafetyPort {
  checkText(actor: SafetyActor, input: { title: string; content: string }): Promise<SafetyResult>;
  checkImage(actor: SafetyActor, fileId: string): Promise<SafetyResult>;
}

function alias(record: Record<string, unknown>, camel: string, snake: string): unknown {
  if (record[camel] !== undefined && record[snake] !== undefined && record[camel] !== record[snake])
    throw new Error('Conflicting safety response');
  return record[camel] ?? record[snake];
}
function receipt(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || alias(value, 'errCode', 'errcode') !== 0)
    throw new Error('Safety service unavailable');
  return value;
}
function trace(value: Record<string, unknown>): string {
  const id = alias(value, 'traceId', 'trace_id');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    throw new Error('Invalid safety receipt');
  return id;
}
function verdict(value: unknown): { decision: SafetyResult['decision']; label: number } {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.label) ||
    typeof value.label !== 'number' ||
    value.label < 0
  )
    throw new Error('Invalid safety verdict');
  const decision =
    value.suggest === 'pass'
      ? 'pass'
      : value.suggest === 'review'
        ? 'review'
        : value.suggest === 'risky'
          ? 'reject'
          : undefined;
  if (!decision) throw new Error('Invalid safety verdict');
  return { decision, label: value.label };
}
const severity = { pass: 0, review: 1, reject: 2 } as const;
function strongest(
  a: SafetyResult['decision'],
  b: SafetyResult['decision'],
): SafetyResult['decision'] {
  return severity[a] >= severity[b] ? a : b;
}

/** Official 2500-character limit; overlap retains context around each split. No UTF-16 splitting. */
export function safetyTextChunks(content: string): string[] {
  const points = Array.from(content);
  const chunks: string[] = [];
  for (let offset = 0; offset < points.length; offset += 2300) {
    chunks.push(points.slice(offset, offset + 2400).join(''));
    if (offset + 2400 >= points.length) break;
  }
  return chunks;
}

/** No automatic retry: submission-level idempotency will own request/revision accounting. */
export function createContentSafety(deps: SafetyDependencies): ContentSafetyPort {
  const timeoutMs = deps.timeoutMs ?? 8000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new Error('Invalid safety timeout');
  const now = deps.now ?? (() => new Date());
  const result = (
    decision: SafetyResult['decision'],
    status: SafetyResult['status'],
    labels: number[] = [],
    traceIds: string[] = [],
  ): SafetyResult => ({
    decision,
    status,
    provider: 'wechat-v2',
    checkedAt: now(),
    labels: [...new Set(labels)],
    traceIds: [...new Set(traceIds)],
  });
  const bounded = async <T>(operation: (active: () => void) => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const active = () => {
      if (expired) throw new Error('Safety timeout');
    };
    try {
      return await Promise.race([
        Promise.resolve().then(() => operation(active)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(new Error('Safety timeout'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const actorValid = (actor: SafetyActor) => {
    if (!actor || typeof actor.openid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(actor.openid))
      throw new AppError('UNAUTHORIZED');
  };
  return {
    async checkText(actor, input) {
      actorValid(actor);
      if (
        !input ||
        typeof input.title !== 'string' ||
        typeof input.content !== 'string' ||
        Array.from(input.title).length > 30 ||
        Array.from(input.content).length > 3000 ||
        !input.content.trim()
      )
        throw new AppError('INVALID_ARGUMENT');
      const labels: number[] = [],
        traces: string[] = [];
      let decision: SafetyResult['decision'] = 'pass';
      try {
        // One deadline covers every chunk, so maximum response latency does not grow with length.
        return await bounded(async (active) => {
          for (const content of safetyTextChunks(input.content)) {
            active();
            const response = receipt(
              await deps.platform.text({
                openid: actor.openid,
                version: 2,
                scene: 3,
                title: input.title,
                content,
              }),
            );
            active();
            const checked = verdict(response.result);
            traces.push(trace(response));
            labels.push(checked.label);
            decision = strongest(decision, checked.decision);
            if (response.detail !== undefined) {
              if (!Array.isArray(response.detail) || response.detail.length > 100)
                throw new Error('Invalid safety detail');
              for (const detail of response.detail) {
                const item = verdict(receipt(detail));
                decision = strongest(decision, item.decision);
                labels.push(item.label);
              }
            }
            if (decision === 'reject') return result('reject', 'complete', labels, traces);
          }
          return result(decision, 'complete', labels, traces);
        });
      } catch {
        // Do not retain provider errors, echoed text, keywords or credentials.
        return result('review', 'unavailable', labels, traces);
      }
    },
    async checkImage(actor, fileId) {
      actorValid(actor);
      if (typeof fileId !== 'string' || !fileId.startsWith('cloud://') || fileId.length > 1024)
        throw new AppError('INVALID_ARGUMENT');
      try {
        return await bounded(async (active) => {
          if (!deps.resolveImage) throw new Error('Image ownership adapter not configured');
          const image = await deps.resolveImage(actor, fileId);
          active();
          const url = new URL(image.url);
          if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            !Number.isSafeInteger(image.size) ||
            image.size < 1 ||
            image.size > 10 * 1024 * 1024 ||
            !['image/jpeg', 'image/png', 'image/bmp', 'image/gif'].includes(image.mimeType)
          )
            throw new Error('Invalid trusted media');
          const response = receipt(
            await deps.platform.image({
              openid: actor.openid,
              version: 2,
              scene: 3,
              mediaUrl: image.url,
              mediaType: 2,
            }),
          );
          active();
          // A trace ID only acknowledges the job, NOT a successful image check.
          return result('review', 'pending', [], [trace(response)]);
        });
      } catch {
        return result('review', 'unavailable');
      }
    },
  };
}

export function publicSafetyFeedback(result: SafetyResult): SafetyFeedback {
  return {
    decision: result.decision,
    status: result.status,
    source: 'wechat',
    message: safetyMessage(result.decision, result.status),
  };
}

/** Allows only queue admission, NEVER public display. Caller persists draft before checking. */
export function assertSafetyQueueAdmission(
  results: readonly SafetyResult[],
  failurePolicy: 'block' | 'manual_review' = 'block',
): void {
  if (results.length === 0) throw new AppError('CONTENT_CHECK_UNAVAILABLE');
  if (results.some((r) => r.decision === 'reject')) throw new AppError('CONTENT_REJECTED');
  if (results.some((r) => r.status === 'pending')) throw new AppError('CONTENT_CHECK_PENDING');
  if (results.some((r) => r.status !== 'complete') && failurePolicy !== 'manual_review')
    throw new AppError('CONTENT_CHECK_UNAVAILABLE');
}

/** Review/reject/failure cannot be automatically published, even under manual-review policy. */
export function safetyChecksPassed(results: readonly SafetyResult[]): boolean {
  return (
    results.length > 0 && results.every((r) => r.status === 'complete' && r.decision === 'pass')
  );
}
