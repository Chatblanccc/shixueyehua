import { isRecord, readString } from '../../shared';
import { getDocument, saveDocument } from './audio-db';
import type { CloudDatabasePort } from './db';
import { parseSafetyJob, safetyJobId, parseSafetyDraft } from './safety-jobs-db';
import { imageCheckId } from './safety-submission';
import type {
  ImageCheckRequest,
  ImageCheckStore,
  ImageCheckTransaction,
} from './safety-submission';

export function parseImageCheckRequest(value: unknown): ImageCheckRequest {
  if (!isRecord(value)) throw new Error('Invalid image check');
  const date = (v: unknown) => {
    if (!(v instanceof Date) || !Number.isFinite(v.getTime())) throw new Error('Invalid date');
    return v;
  };
  if (
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.failed !== 'boolean' ||
    typeof value.contentHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.contentHash) ||
    typeof value.traceId !== 'string' ||
    (value.traceId !== '' && !/^[A-Za-z0-9_-]{1,128}$/.test(value.traceId))
  )
    throw new Error('Invalid image check fields');
  const result: ImageCheckRequest = {
    _id: readString(value._id),
    appId: readString(value.appId),
    authorId: readString(value.authorId),
    letterId: readString(value.letterId),
    revision: value.revision,
    contentHash: value.contentHash,
    fileId: readString(value.fileId, 1024),
    token: readString(value.token),
    requestedAt: date(value.requestedAt),
    leaseUntil: date(value.leaseUntil),
    expiresAt: date(value.expiresAt),
    traceId: value.traceId,
    failed: value.failed,
  };
  if (
    imageCheckId(result) !== result._id ||
    result.leaseUntil <= result.requestedAt ||
    result.expiresAt <= result.leaseUntil ||
    !result.fileId.startsWith('cloud://') ||
    (result.failed && result.traceId)
  )
    throw new Error('Invalid image check binding');
  return result;
}

/** Registration and selected receipt commit atomically; lost responses cannot lose the job reference. */
export class CloudImageCheckStore implements ImageCheckStore {
  constructor(private readonly database: () => CloudDatabasePort) {}
  async runTransaction<T>(work: (tx: ImageCheckTransaction) => Promise<T>): Promise<T> {
    const db = this.database();
    if (!db.runTransaction) throw new Error('Missing database transaction API');
    let completed: { value: T } | undefined;
    const receipt: unknown = await db.runTransaction(async (tx) => {
      const value = await work({
        findDraft: (id) => getDocument(tx, 'letters', id, parseSafetyDraft),
        findRequest: (id) =>
          getDocument(tx, 'media_safety_submissions', id, parseImageCheckRequest),
        saveRequest: async (request, exists) => {
          await saveDocument(
            tx,
            'media_safety_submissions',
            parseImageCheckRequest(request),
            exists,
          );
        },
        findJob: (appId, traceId) =>
          getDocument(tx, 'media_safety_jobs', safetyJobId(appId, traceId), parseSafetyJob),
        insertJob: async (job) => {
          if (job.result || job.callbackHash) throw new Error('Cannot insert approved job');
          const document = parseSafetyJob({ ...job, _id: safetyJobId(job.appId, job.traceId) });
          await saveDocument(tx, 'media_safety_jobs', document, false);
        },
      });
      completed = { value };
      return completed;
    });
    if (!completed || receipt !== completed)
      throw new Error('Image check transaction not acknowledged');
    return completed.value;
  }
}
