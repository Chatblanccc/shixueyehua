import { createHash } from 'node:crypto';
import { isRecord, readEnum, readString } from '../../shared';
import { getDocument, saveDocument } from './audio-db';
import type { CloudDatabasePort } from './db';
import type {
  MediaSafetyJob,
  SafetyDraftSnapshot,
  SafetyJobStore,
  SafetyJobTransaction,
} from './safety-jobs';

export function safetyJobId(appId: string, traceId: string): string {
  return createHash('sha256')
    .update(JSON.stringify([appId, traceId]))
    .digest('hex');
}
function date(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new Error('Invalid safety date');
  return value;
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('Invalid safety revision');
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error('Invalid safety hash');
  return value;
}
export function parseSafetyJob(value: unknown): MediaSafetyJob & { _id: string } {
  if (!isRecord(value)) throw new Error('Invalid safety job');
  const job: MediaSafetyJob & { _id: string } = {
    _id: readString(value._id),
    appId: readString(value.appId),
    traceId: readString(value.traceId),
    authorId: readString(value.authorId),
    letterId: readString(value.letterId),
    revision: revision(value.revision),
    contentHash: hash(value.contentHash),
    fileId: readString(value.fileId, 1024),
    requestedAt: date(value.requestedAt),
    expiresAt: date(value.expiresAt),
  };
  if (job._id !== safetyJobId(job.appId, job.traceId) || job.expiresAt <= job.requestedAt)
    throw new Error('Invalid safety job binding');
  if (value.result !== undefined) {
    const result = value.result;
    if (
      !isRecord(result) ||
      result.provider !== 'wechat-v2' ||
      !Array.isArray(result.labels) ||
      result.labels.length > 101 ||
      !result.labels.every(
        (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
      ) ||
      !Array.isArray(result.traceIds) ||
      result.traceIds.length !== 1 ||
      result.traceIds[0] !== job.traceId
    )
      throw new Error('Invalid safety job result');
    job.result = {
      provider: 'wechat-v2',
      decision: readEnum(result.decision, ['pass', 'review', 'reject']),
      status: readEnum(result.status, ['complete', 'unavailable']),
      checkedAt: date(result.checkedAt),
      labels: result.labels as number[],
      traceIds: [job.traceId],
    };
    job.callbackHash = hash(value.callbackHash);
  } else if (value.callbackHash !== undefined) throw new Error('Incomplete safety receipt');
  return job;
}
function parseDraft(value: unknown): SafetyDraftSnapshot & { _id: string } {
  if (!isRecord(value) || !Array.isArray(value.imageFileIds) || value.imageFileIds.length > 3)
    throw new Error('Invalid safety draft');
  return {
    _id: readString(value._id),
    authorId: readString(value.authorId),
    revision: revision(value.revision),
    contentHash: hash(value.contentHash),
    imageFileIds: value.imageFileIds.map((id: unknown) => readString(id, 1024)),
    reviewStatus: readEnum(value.reviewStatus, [
      'draft',
      'pending',
      'approved',
      'rejected',
      'hidden',
      'deleted',
    ]),
    deleted: value.deletedAt != null || value.reviewStatus === 'deleted',
  };
}

/** No client write access. Same transaction reads draft/version and writes its bound result. */
export class CloudSafetyJobStore implements SafetyJobStore {
  constructor(private readonly database: () => CloudDatabasePort) {}
  /** Called only by authenticated submission code after receiving a platform trace ID. */
  async register(job: MediaSafetyJob): Promise<void> {
    if (job.result || job.callbackHash)
      throw new Error('Cannot register a pre-approved safety job');
    const document = parseSafetyJob({ ...job, _id: safetyJobId(job.appId, job.traceId) });
    const db = this.database();
    if (!db.runTransaction) throw new Error('Missing database transaction API');
    let receipt: object | undefined;
    const result: unknown = await db.runTransaction(async (tx) => {
      const old = await getDocument(tx, 'media_safety_jobs', document._id, parseSafetyJob);
      if (old) {
        for (const field of [
          'appId',
          'traceId',
          'authorId',
          'letterId',
          'revision',
          'contentHash',
          'fileId',
        ] as const)
          if (old[field] !== document[field]) throw new Error('Cannot rebind a safety job');
        if (
          old.requestedAt.getTime() !== document.requestedAt.getTime() ||
          old.expiresAt.getTime() !== document.expiresAt.getTime()
        )
          throw new Error('Cannot extend a safety job');
      } else await saveDocument(tx, 'media_safety_jobs', document, false);
      receipt = {};
      return receipt;
    });
    if (!receipt || result !== receipt) throw new Error('Safety registration not acknowledged');
  }
  async runTransaction<T>(work: (transaction: SafetyJobTransaction) => Promise<T>): Promise<T> {
    const db = this.database();
    if (!db.runTransaction) throw new Error('Missing database transaction API');
    let completed: { value: T } | undefined;
    const receipt: unknown = await db.runTransaction(async (tx) => {
      const value = await work({
        findJob: (appId, traceId) =>
          getDocument(tx, 'media_safety_jobs', safetyJobId(appId, traceId), parseSafetyJob),
        findDraft: (id) => getDocument(tx, 'letters', id, parseDraft),
        saveJob: async (job) => {
          const document = parseSafetyJob({ ...job, _id: safetyJobId(job.appId, job.traceId) });
          await saveDocument(tx, 'media_safety_jobs', document, true);
        },
      });
      completed = { value };
      return completed;
    });
    if (!completed || receipt !== completed) throw new Error('Safety transaction not acknowledged');
    return completed.value;
  }
}
