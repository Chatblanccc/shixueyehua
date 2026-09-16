import { isRecord, parseOwnLetter, readString, readEnum } from '../../shared';
import type { SafetyResult } from './content-safety';
import { dbCall } from './audio-db';
import type { LetterRecord } from './letter-repository';
export function parseLetterDocument(value: unknown): LetterRecord {
  if (
    !isRecord(value) ||
    !(value.createdAt instanceof Date) ||
    !(value.updatedAt instanceof Date) ||
    (value.deletedAt !== null && !(value.deletedAt instanceof Date))
  )
    throw new Error('Invalid letter document');
  const dto = parseOwnLetter({
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  });
  if (typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash))
    throw new Error('Invalid content hash');
  let safety: SafetyResult | null = null;
  if (value.safety !== null && value.safety !== undefined) {
    const raw = value.safety;
    if (
      !isRecord(raw) ||
      raw.provider !== 'wechat-v2' ||
      !(raw.checkedAt instanceof Date) ||
      !Number.isFinite(raw.checkedAt.getTime()) ||
      !Array.isArray(raw.labels) ||
      raw.labels.length > 202 ||
      !Array.isArray(raw.traceIds) ||
      raw.traceIds.length > 2
    )
      throw new Error('Invalid safety evidence');
    safety = {
      provider: 'wechat-v2',
      decision: readEnum(raw.decision, ['pass', 'review', 'reject']),
      status: readEnum(raw.status, ['complete', 'pending', 'unavailable']),
      checkedAt: raw.checkedAt,
      labels: raw.labels.map((v: unknown) => {
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
          throw new Error('Invalid label');
        return v;
      }),
      traceIds: raw.traceIds.map((v: unknown) => readString(v)),
    };
  }
  return {
    ...dto,
    authorId: readString(value.authorId),
    schoolId: readString(value.schoolId),
    gradeId: readString(value.gradeId),
    classId: readString(value.classId),
    contentHash: value.contentHash,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: value.deletedAt,
    safety,
  };
}
export async function queryOwnLetters(
  db: unknown,
  authorId: string,
  after?: string,
): Promise<LetterRecord[]> {
  if (!isRecord(db)) throw new Error('Invalid database');
  const query = {
    authorId,
    deletedAt: null,
    ...(after ? { _id: dbCall(db.command, 'gt', after) } : {}),
  };
  const target = dbCall(
    dbCall(dbCall(dbCall(db, 'collection', 'letters'), 'where', query), 'orderBy', '_id', 'asc'),
    'limit',
    21,
  );
  const result: unknown = await dbCall(target, 'get');
  if (
    !isRecord(result) ||
    result.code ||
    result.Error ||
    (result.errCode !== undefined && result.errCode !== 0) ||
    !Array.isArray(result.data)
  )
    throw new Error('Invalid letter query');
  return result.data.map(parseLetterDocument);
}
