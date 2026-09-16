import { createHash, randomUUID } from 'node:crypto';
import type { ContentSafetyPort, SafetyResult } from './content-safety';
import type { MediaSafetyJob, SafetyDraftSnapshot } from './safety-jobs';
import { AppError } from './errors';

export interface ImageCheckBinding {
  appId: string;
  authorId: string;
  letterId: string;
  revision: number;
  contentHash: string;
  fileId: string;
}
export interface ImageCheckRequest extends ImageCheckBinding {
  _id: string;
  token: string;
  requestedAt: Date;
  leaseUntil: Date;
  expiresAt: Date;
  traceId: string;
  failed: boolean;
}
export interface ImageCheckTransaction {
  findDraft(id: string): Promise<SafetyDraftSnapshot | undefined>;
  findRequest(id: string): Promise<ImageCheckRequest | undefined>;
  saveRequest(value: ImageCheckRequest, exists: boolean): Promise<void>;
  findJob(appId: string, traceId: string): Promise<MediaSafetyJob | undefined>;
  insertJob(value: MediaSafetyJob): Promise<void>;
}
export interface ImageCheckStore {
  runTransaction<T>(work: (tx: ImageCheckTransaction) => Promise<T>): Promise<T>;
}
export function imageCheckId(value: ImageCheckBinding): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        value.appId,
        value.authorId,
        value.letterId,
        value.revision,
        value.contentHash,
        value.fileId,
      ]),
    )
    .digest('hex');
}
const bindingKeys = ['appId', 'authorId', 'letterId', 'revision', 'contentHash', 'fileId'] as const;
function assertBinding(a: ImageCheckBinding, b: ImageCheckBinding) {
  if (bindingKeys.some((key) => a[key] !== b[key])) throw new AppError('CONTENT_CHECK_UNAVAILABLE');
}
async function assertDraft(tx: ImageCheckTransaction, value: ImageCheckBinding) {
  const draft = await tx.findDraft(value.letterId);
  if (
    !draft ||
    draft.deleted ||
    draft.authorId !== value.authorId ||
    draft.revision !== value.revision ||
    draft.contentHash !== value.contentHash ||
    !draft.imageFileIds.includes(value.fileId) ||
    !['draft', 'rejected'].includes(draft.reviewStatus)
  )
    throw new AppError('LETTER_STATE_CONFLICT');
}
const feedback = (now: Date, status: 'pending' | 'unavailable'): SafetyResult => ({
  provider: 'wechat-v2',
  decision: 'review',
  status,
  checkedAt: now,
  labels: [],
  traceIds: [],
});

/** Server-only orchestration. The caller must authenticate and verify immutable upload ownership.
 * A receipt is never approval; callbacks only persist results. This module never publishes letters.
 * Keep runtime image submission disabled until its trusted upload resolver is installed.
 */
export function createImageSafetyCoordinator(deps: {
  appId: string;
  store: ImageCheckStore;
  safety: ContentSafetyPort;
  now?: () => Date;
}) {
  if (!/^wx[a-fA-F0-9]{16}$/.test(deps.appId)) throw new Error('Invalid safety AppID');
  const now = deps.now ?? (() => new Date());
  return {
    async check(input: {
      authorId: string;
      openid: string;
      letterId: string;
      revision: number;
      contentHash: string;
      imageFileIds: string[];
    }): Promise<SafetyResult[]> {
      if (
        !input.authorId ||
        !input.openid ||
        !input.letterId ||
        !Number.isSafeInteger(input.revision) ||
        input.revision < 1 ||
        !/^[a-f0-9]{64}$/.test(input.contentHash) ||
        input.imageFileIds.length < 1 ||
        input.imageFileIds.length > 3 ||
        new Set(input.imageFileIds).size !== input.imageFileIds.length ||
        input.imageFileIds.some((id) => !id.startsWith('cloud://') || id.length > 1024)
      )
        throw new AppError('INVALID_ARGUMENT');
      const results: SafetyResult[] = [];
      for (const fileId of input.imageFileIds) {
        const binding: ImageCheckBinding = {
          appId: deps.appId,
          authorId: input.authorId,
          letterId: input.letterId,
          revision: input.revision,
          contentHash: input.contentHash,
          fileId,
        };
        const time = now();
        const id = imageCheckId(binding);
        const claimed = await deps.store.runTransaction(
          async (tx): Promise<{ request: ImageCheckRequest } | { result: SafetyResult }> => {
            await assertDraft(tx, binding);
            const previous = await tx.findRequest(id);
            if (previous) {
              assertBinding(previous, binding);
              if (previous.traceId) {
                const job = await tx.findJob(deps.appId, previous.traceId);
                if (!job) throw new AppError('CONTENT_CHECK_UNAVAILABLE');
                assertBinding(job, binding);
                if (
                  job.traceId !== previous.traceId ||
                  job.expiresAt.getTime() !== previous.expiresAt.getTime() ||
                  job.requestedAt.getTime() !== previous.requestedAt.getTime()
                )
                  throw new AppError('CONTENT_CHECK_UNAVAILABLE');
                if (
                  job.result &&
                  job.result.checkedAt >= job.requestedAt &&
                  job.result.checkedAt <= job.expiresAt &&
                  (previous.expiresAt > time || job.result.decision === 'reject')
                )
                  return { result: job.result };
                if (previous.expiresAt > time) return { result: feedback(time, 'pending') };
              }
              if (previous.leaseUntil > time)
                return { result: feedback(time, previous.failed ? 'unavailable' : 'pending') };
            }
            const request: ImageCheckRequest = {
              ...binding,
              _id: id,
              token: randomUUID(),
              requestedAt: time,
              leaseUntil: new Date(time.getTime() + 60000),
              expiresAt: new Date(time.getTime() + 30 * 60000),
              traceId: '',
              failed: false,
            };
            await tx.saveRequest(request, !!previous);
            return { request };
          },
        );
        if ('result' in claimed) {
          results.push(claimed.result);
          continue;
        }
        const request = claimed.request;
        let receipt: SafetyResult;
        try {
          receipt = await deps.safety.checkImage({ openid: input.openid }, fileId);
        } catch {
          receipt = feedback(now(), 'unavailable');
        }
        const result = await deps.store.runTransaction(async (tx) => {
          await assertDraft(tx, binding);
          const current = await tx.findRequest(id);
          const finishedAt = now();
          if (!current || current.token !== request.token || current.leaseUntil <= finishedAt)
            return feedback(finishedAt, 'unavailable');
          assertBinding(current, binding);
          // Only the asynchronous pending receipt is valid here. A direct 'pass' is not trusted.
          if (
            receipt.provider !== 'wechat-v2' ||
            receipt.status !== 'pending' ||
            receipt.decision !== 'review' ||
            receipt.traceIds.length !== 1 ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.traceIds[0] ?? '')
          ) {
            await tx.saveRequest({ ...current, failed: true }, true);
            return feedback(finishedAt, 'unavailable');
          }
          const traceId = receipt.traceIds[0]!;
          const existing = await tx.findJob(deps.appId, traceId);
          // Never rebind a platform trace, including to another lease of the same draft.
          if (existing) throw new AppError('CONTENT_CHECK_UNAVAILABLE');
          await tx.insertJob({
            ...binding,
            traceId,
            requestedAt: request.requestedAt,
            expiresAt: request.expiresAt,
          });
          await tx.saveRequest({ ...current, traceId }, true);
          return feedback(finishedAt, 'pending');
        });
        results.push(result);
      }
      return results;
    },
  };
}
