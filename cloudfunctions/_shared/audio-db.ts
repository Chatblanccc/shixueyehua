import { isRecord, readEnum, readString } from '../../shared';
import type { AudioProgram, Favorite, PlayProgress } from '../../shared';
import type {
  AudioPosition,
  AudioQuery,
  AudioUploadRecord,
  PersonalAudioQuery,
  UploadQuota,
} from './audio-repository';

export function dbCall(target: unknown, name: string, ...args: unknown[]): unknown {
  if (!isRecord(target) || typeof target[name] !== 'function')
    throw new Error('Invalid database API');
  return Reflect.apply(target[name], target, args);
}
function result(value: unknown): Record<string, unknown> {
  if (
    !isRecord(value) ||
    value.code ||
    value.Error ||
    (value.errCode !== undefined && value.errCode !== 0)
  )
    throw new Error('Invalid audio database response');
  return value;
}
function date(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new Error('Invalid date');
  return value;
}
function num(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error('Invalid number');
  return value;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) throw new Error('Invalid string');
  return value;
}
function dates(value: Record<string, unknown>) {
  return {
    createdAt: date(value.createdAt),
    updatedAt: date(value.updatedAt),
    deletedAt: value.deletedAt == null ? null : date(value.deletedAt),
  };
}
export function parseAudioDocument(value: unknown): AudioProgram {
  if (!isRecord(value) || !Array.isArray(value.classIds)) throw new Error('Invalid audio document');
  const audio: AudioProgram = {
    ...dates(value),
    _id: readString(value._id),
    schoolId: readString(value.schoolId),
    classIds: value.classIds.map((id) => readString(id)),
    title: readString(value.title, 120),
    description: text(value.description, 2000),
    speakerName: readString(value.speakerName, 80),
    speakerTitle: text(value.speakerTitle, 80),
    coverFileId: text(value.coverFileId, 1024),
    audioFileId: readString(value.audioFileId, 1024),
    fileSize: num(value.fileSize),
    duration: num(value.duration),
    status: readEnum(value.status, ['draft', 'published', 'offline', 'deleted']),
    visibility: readEnum(value.visibility, ['school', 'classes']),
    createdBy: readString(value.createdBy),
  };
  for (const key of ['publishedAt', 'offlineAt'] as const)
    if (value[key] !== undefined) audio[key] = date(value[key]);
  for (const key of [
    'publishedBy',
    'deletedBy',
    'audioTicketId',
    'coverTicketId',
    'originalFileName',
    'mimeType',
  ] as const)
    if (value[key] !== undefined) audio[key] = text(value[key], 256);
  return audio;
}
export function parseProgressDocument(value: unknown): PlayProgress {
  if (!isRecord(value) || typeof value.completed !== 'boolean')
    throw new Error('Invalid progress document');
  return {
    ...dates(value),
    _id: readString(value._id),
    userId: readString(value.userId),
    schoolId: readString(value.schoolId),
    audioId: readString(value.audioId),
    currentTime: num(value.currentTime),
    duration: num(value.duration),
    completed: value.completed,
  };
}
export function parseFavoriteDocument(value: unknown): Favorite {
  if (!isRecord(value)) throw new Error('Invalid favorite document');
  return {
    ...dates(value),
    _id: readString(value._id),
    userId: readString(value.userId),
    schoolId: readString(value.schoolId),
    audioId: readString(value.audioId),
  };
}
export function parseUploadDocument(value: unknown): AudioUploadRecord {
  if (!isRecord(value)) throw new Error('Invalid upload document');
  const upload: AudioUploadRecord = {
    ...dates(value),
    _id: readString(value._id),
    userId: readString(value.userId),
    schoolId: readString(value.schoolId),
    kind: readEnum(value.kind, ['audio', 'cover']),
    status: readEnum(value.status, [
      'issued',
      'validating',
      'confirmed',
      'bound',
      'cancelled',
      'cleaned',
    ]),
    originalFileName: readString(value.originalFileName, 256),
    expectedBytes: num(value.expectedBytes),
    maxBytes: num(value.maxBytes),
    sourcePath: readString(value.sourcePath, 1024),
    sourceFileId: text(value.sourceFileId, 1024),
    finalPath: readString(value.finalPath, 1024),
    finalFileId: text(value.finalFileId, 1024),
    expiresAt: date(value.expiresAt),
    grantExpiresAt: date(value.grantExpiresAt),
  };
  for (const key of ['fileSize', 'duration'] as const)
    if (value[key] !== undefined) upload[key] = num(value[key]);
  for (const key of ['mimeType', 'audioId'] as const)
    if (value[key] !== undefined) upload[key] = readString(value[key], 128);
  for (const key of ['sourceCleaned', 'finalCleaned'] as const)
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'boolean') throw new Error('Invalid cleanup state');
      upload[key] = value[key];
    }
  if (value.validationStartedAt !== undefined)
    upload.validationStartedAt = date(value.validationStartedAt);
  return upload;
}
export function parseQuotaDocument(value: unknown): UploadQuota {
  if (!isRecord(value) || !Array.isArray(value.ticketIds)) throw new Error('Invalid quota');
  return { _id: readString(value._id), ticketIds: value.ticketIds.map((id) => readString(id)) };
}
export async function getDocument<T extends { _id: string }>(
  database: unknown,
  collection: string,
  id: string,
  parse: (value: unknown) => T,
): Promise<T | undefined> {
  const response = result(
    await dbCall(dbCall(dbCall(database, 'collection', collection), 'doc', id), 'get'),
  );
  if (response.data === null) return undefined;
  const document = parse(response.data);
  if (document._id !== id) throw new Error('Document ID mismatch');
  return document;
}
export async function saveDocument(
  database: unknown,
  collection: string,
  value: { _id: string },
  exists: boolean,
): Promise<void> {
  const target = dbCall(database, 'collection', collection);
  if (exists) {
    const { _id, ...data } = value;
    const response = result(await dbCall(dbCall(target, 'doc', _id), 'update', { data }));
    if (!isRecord(response.stats) || response.stats.updated !== 1)
      throw new Error('Update not acknowledged');
  } else if (result(await dbCall(target, 'add', { data: value }))._id !== value._id)
    throw new Error('Insert not acknowledged');
}
function command(database: unknown, name: string, ...args: unknown[]): unknown {
  if (!isRecord(database)) throw new Error('Invalid database');
  return dbCall(database.command, name, ...args);
}
function position(database: unknown, field: string, mark: AudioPosition, direction: 'lt' | 'gt') {
  return command(database, 'or', [
    { [field]: command(database, direction, mark.time) },
    { [field]: mark.time, _id: command(database, direction, mark.id) },
  ]);
}
async function select<T>(
  database: unknown,
  collection: string,
  predicates: unknown[],
  field: string,
  direction: 'asc' | 'desc',
  limit: number,
  parse: (value: unknown) => T,
): Promise<T[]> {
  let query = dbCall(
    dbCall(database, 'collection', collection),
    'where',
    command(database, 'and', predicates),
  );
  query = dbCall(dbCall(query, 'orderBy', field, direction), 'orderBy', '_id', direction);
  const response = result(await dbCall(dbCall(query, 'limit', limit), 'get'));
  if (!Array.isArray(response.data) || response.data.length > limit)
    throw new Error('Invalid query rows');
  return response.data.map(parse);
}
export function queryAudio(database: unknown, query: AudioQuery): Promise<AudioProgram[]> {
  const filters: unknown[] = [
    {
      schoolId: query.schoolId,
      deletedAt: null,
      ...(query.status
        ? { status: query.status }
        : { status: command(database, 'neq', 'deleted') }),
    },
  ];
  const field = query.visibleOnly ? 'publishedAt' : 'createdAt';
  filters.push({ [field]: command(database, 'lte', query.snapshot) });
  if (query.visibleOnly)
    filters.push(
      command(database, 'or', [
        { visibility: 'school' },
        { visibility: 'classes', classIds: query.classId },
      ]),
    );
  if (query.before) filters.push(position(database, field, query.before, 'lt'));
  if (query.after) filters.push(position(database, field, query.after, 'gt'));
  return select(
    database,
    'audio_programs',
    filters,
    field,
    query.after ? 'asc' : 'desc',
    query.limit,
    parseAudioDocument,
  );
}
export function queryPersonal<T>(
  database: unknown,
  collection: string,
  field: string,
  query: PersonalAudioQuery,
  parse: (value: unknown) => T,
): Promise<T[]> {
  const filters: unknown[] = [
    { userId: query.userId, deletedAt: null, [field]: command(database, 'lte', query.snapshot) },
  ];
  if (query.before) filters.push(position(database, field, query.before, 'lt'));
  return select(database, collection, filters, field, 'desc', query.limit, parse);
}
export function queryCleanup(
  database: unknown,
  schoolId: string,
  before: Date,
  limit: number,
): Promise<AudioUploadRecord[]> {
  return select(
    database,
    'audio_uploads',
    [
      {
        schoolId,
        status: command(database, 'neq', 'cleaned'),
        grantExpiresAt: command(database, 'lt', before),
      },
      command(database, 'or', [
        { sourceCleaned: false },
        { status: command(database, 'neq', 'bound') },
      ]),
    ],
    'grantExpiresAt',
    'asc',
    limit,
    parseUploadDocument,
  );
}
