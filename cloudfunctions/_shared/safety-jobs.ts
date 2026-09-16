import { createHash } from 'node:crypto';
import type { MediaSafetyEvent, MediaSafetySink } from './safety-callback';
import type { SafetyResult } from './content-safety';

/** Persist before consuming callbacks; immutable source file and exact draft revision. */
export interface MediaSafetyJob {
  appId: string;
  traceId: string;
  authorId: string;
  letterId: string;
  revision: number;
  contentHash: string;
  fileId: string;
  requestedAt: Date;
  expiresAt: Date;
  result?: SafetyResult;
  callbackHash?: string;
}
export interface SafetyDraftSnapshot {
  authorId: string;
  revision: number;
  contentHash: string;
  imageFileIds: string[];
  reviewStatus: string;
  deleted: boolean;
}
export interface SafetyJobTransaction {
  findJob(appId: string, traceId: string): Promise<MediaSafetyJob | undefined>;
  findDraft(letterId: string): Promise<SafetyDraftSnapshot | undefined>;
  saveJob(job: MediaSafetyJob): Promise<void>;
}
export interface SafetyJobStore {
  runTransaction<T>(work: (transaction: SafetyJobTransaction) => Promise<T>): Promise<T>;
}

/** No business state changes here: even a passing callback cannot publish a letter. */
export function createMediaSafetySink(store: SafetyJobStore): MediaSafetySink {
  return {
    async accept(event: MediaSafetyEvent): Promise<void> {
      await store.runTransaction(async (tx) => {
        const job = await tx.findJob(event.appId, event.traceId);
        // The external request can finish before the submission persists its trace receipt.
        // Return a retryable failure, not success that silently drops an early callback.
        if (!job) throw new Error('Safety job not registered');
        if (job.appId !== event.appId || job.traceId !== event.traceId)
          throw new Error('Safety job mismatch');
        const hash = createHash('sha256')
          .update(
            JSON.stringify({
              appId: event.appId,
              traceId: event.traceId,
              createdAt: event.createdAt.toISOString(),
              decision: event.result.decision,
              status: event.result.status,
              labels: [...event.result.labels].sort((a, b) => a - b),
            }),
          )
          .digest('hex');
        if (job.callbackHash) {
          if (job.callbackHash !== hash) throw new Error('Conflicting safety callback');
          return; // Duplicate delivery is idempotent, including no second database write.
        }
        if (
          !Number.isFinite(job.requestedAt.getTime()) ||
          !Number.isFinite(job.expiresAt.getTime()) ||
          job.expiresAt <= job.requestedAt
        )
          throw new Error('Invalid job lifetime');
        if (
          event.createdAt.getTime() < job.requestedAt.getTime() - 300000 ||
          event.createdAt > job.expiresAt ||
          event.result.checkedAt > job.expiresAt
        )
          return;
        const draft = await tx.findDraft(job.letterId);
        if (
          !draft ||
          draft.deleted ||
          !['draft', 'rejected'].includes(draft.reviewStatus) ||
          draft.authorId !== job.authorId ||
          draft.revision !== job.revision ||
          draft.contentHash !== job.contentHash ||
          !draft.imageFileIds.includes(job.fileId)
        )
          return;
        await tx.saveJob({ ...job, result: event.result, callbackHash: hash });
      });
    },
  };
}
