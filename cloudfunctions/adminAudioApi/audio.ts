import { randomUUID } from 'node:crypto';
import type {
  AudioProgram,
  AudioUploadTicket,
  ConfirmedAudioUpload,
  CursorPage,
  ManagedAudio,
  User,
  Visibility,
} from '../../shared';
import {
  adminInTransaction,
  boundedNumber,
  cursor,
  fields,
  MEDIA_TTL,
  parsePage,
  requireStorage,
} from '../_shared/audio-common';
import { assertSameSchool, requireAdmin } from '../_shared/auth';
import { writeAudit } from '../_shared/audit';
import type { AudioUploadRecord } from '../_shared/audio-repository';
import type { AudioStoragePort } from '../_shared/audio-storage-port';
import type { Repository, TransactionRepository } from '../_shared/repository';
import { AppError } from '../_shared/errors';
import { identifier } from '../_shared/validate';

const TICKET_MS = 20 * 60 * 1000;
export interface AudioUploadLimits {
  audioMaxBytes: number;
  coverMaxBytes: number;
}
export const DEFAULT_AUDIO_UPLOAD_LIMITS: AudioUploadLimits = {
  audioMaxBytes: 50 * 1024 * 1024,
  coverMaxBytes: 5 * 1024 * 1024,
};
function text(value: unknown, maximum: number, required = false): string {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    [...value].some((char) => char.charCodeAt(0) < 32 && char !== '\n')
  )
    throw new AppError('INVALID_ARGUMENT');
  const result = value.trim();
  if (required && !result) throw new AppError('INVALID_ARGUMENT');
  return result;
}
async function audit(
  transaction: TransactionRepository,
  actor: User,
  ticket: { _id: string; schoolId: string; status: string },
  action: string,
  before: string,
  requestId: string,
  now: Date,
) {
  await writeAudit(transaction, {
    actor,
    schoolId: ticket.schoolId,
    action,
    targetType: action.startsWith('audio_upload') ? 'audio_upload' : 'audio',
    targetId: ticket._id,
    before: { status: before },
    after: { status: ticket.status },
    requestId,
    now,
  });
}
function owned(upload: AudioUploadRecord | undefined, actor: User): AudioUploadRecord {
  if (!upload || upload.userId !== actor._id) throw new AppError('FORBIDDEN');
  assertSameSchool(actor, upload.schoolId);
  return upload;
}
function confirmation(upload: AudioUploadRecord): ConfirmedAudioUpload {
  if (!upload.fileSize || !upload.mimeType) throw new AppError('UPLOAD_FAILED');
  return {
    ticketId: upload._id,
    kind: upload.kind,
    fileSize: upload.fileSize,
    mimeType: upload.mimeType,
    ...(upload.duration === undefined ? {} : { duration: upload.duration }),
  };
}
export async function prepareUpload(
  repository: Repository,
  storage: AudioStoragePort | undefined,
  actor: User,
  payload: Record<string, unknown>,
  now: Date,
  requestId: string,
  limits: AudioUploadLimits = DEFAULT_AUDIO_UPLOAD_LIMITS,
): Promise<AudioUploadTicket> {
  fields(payload, ['schoolId', 'kind', 'fileName', 'fileSize']);
  const schoolId = identifier(payload.schoolId);
  if (payload.kind !== 'audio' && payload.kind !== 'cover') throw new AppError('INVALID_ARGUMENT');
  const kind = payload.kind;
  const fileName = text(payload.fileName, 256, true);
  const extension = fileName.split('.').at(-1)?.toLowerCase();
  if (
    !extension ||
    !(kind === 'audio' ? ['mp3', 'm4a'] : ['jpg', 'jpeg', 'png', 'webp']).includes(extension)
  )
    throw new AppError('INVALID_ARGUMENT');
  const maxBytes = kind === 'audio' ? limits.audioMaxBytes : limits.coverMaxBytes;
  const expectedBytes = boundedNumber(payload.fileSize, 1, maxBytes);
  if (!Number.isSafeInteger(expectedBytes)) throw new AppError('INVALID_ARGUMENT');
  const id = randomUUID();
  const finalId = randomUUID();
  const sourcePath = `audio-quarantine/${schoolId}/${now.getUTCFullYear()}/${id}.${extension}`;
  const finalPath = `audio-media/${schoolId}/${now.getUTCFullYear()}/${finalId}.${extension}`;
  const upload: AudioUploadRecord = {
    _id: id,
    userId: actor._id,
    schoolId,
    kind,
    status: 'issued',
    originalFileName: fileName,
    expectedBytes,
    maxBytes,
    sourcePath,
    sourceFileId: '',
    finalPath,
    finalFileId: '',
    expiresAt: new Date(now.getTime() + TICKET_MS),
    grantExpiresAt: now,
    createdAt: now,
    updatedAt: now,
    sourceCleaned: false,
    finalCleaned: false,
    deletedAt: null,
  };
  await repository.runTransaction(async (transaction) => {
    const fresh = await adminInTransaction(transaction, actor, schoolId);
    const quota = await transaction.findUploadQuota(actor._id);
    const tickets = await Promise.all(
      (quota?.ticketIds ?? []).map((ticket) => transaction.findUpload(ticket)),
    );
    const active = tickets.filter(
      (ticket): ticket is AudioUploadRecord =>
        !!ticket &&
        ['issued', 'validating', 'confirmed'].includes(ticket.status) &&
        ticket.expiresAt > now,
    );
    if (active.length >= 3) throw new AppError('RATE_LIMITED');
    await transaction.saveUpload(upload, false);
    await transaction.saveUploadQuota(
      { _id: actor._id, ticketIds: [...active.map((ticket) => ticket._id), id] },
      !!quota,
    );
    await audit(transaction, fresh, upload, 'audio_upload_prepare', 'none', requestId, now);
  });
  const grant = await requireStorage(storage).prepare(sourcePath, now);
  if (
    !grant.fileId.startsWith('cloud://') ||
    !grant.fileId.endsWith(`/${sourcePath}`) ||
    grant.expiresAt <= now
  )
    throw new AppError('UPLOAD_FAILED');
  const finalFileId = grant.fileId.slice(0, -sourcePath.length) + finalPath;
  await repository.runTransaction(async (transaction) => {
    await adminInTransaction(transaction, actor, schoolId);
    const current = owned(await transaction.findUpload(id), actor);
    if (current.status !== 'issued') throw new AppError('UPLOAD_EXPIRED');
    await transaction.saveUpload(
      { ...current, sourceFileId: grant.fileId, finalFileId, grantExpiresAt: grant.expiresAt },
      true,
    );
  });
  return {
    ticketId: id,
    uploadUrl: grant.uploadUrl,
    method: grant.method,
    headers: grant.headers,
    expiresAt: new Date(
      Math.min(upload.expiresAt.getTime(), grant.expiresAt.getTime()),
    ).toISOString(),
    maxBytes,
  };
}
export async function confirmUpload(
  repository: Repository,
  storage: AudioStoragePort | undefined,
  actor: User,
  payload: Record<string, unknown>,
  now: Date,
  requestId: string,
): Promise<ConfirmedAudioUpload> {
  fields(payload, ['ticketId']);
  const id = identifier(payload.ticketId);
  const reserved = await repository.runTransaction(async (transaction) => {
    const current = owned(await transaction.findUpload(id), actor);
    const fresh = await adminInTransaction(transaction, actor, current.schoolId);
    if (current.status === 'confirmed' || current.status === 'bound') return current;
    if (current.status === 'validating') throw new AppError('DUPLICATE_REQUEST');
    if (
      current.status !== 'issued' ||
      current.expiresAt <= now ||
      current.grantExpiresAt <= now ||
      !current.sourceFileId
    )
      throw new AppError('UPLOAD_EXPIRED');
    const next = {
      ...current,
      status: 'validating' as const,
      validationStartedAt: now,
      updatedAt: now,
    };
    await transaction.saveUpload(next, true);
    await audit(transaction, fresh, next, 'audio_upload_validate', current.status, requestId, now);
    return next;
  });
  if (reserved.status === 'confirmed' || reserved.status === 'bound') return confirmation(reserved);
  try {
    const result = await requireStorage(storage).inspectAndSeal({
      sourceFileId: reserved.sourceFileId,
      finalPath: reserved.finalPath,
      kind: reserved.kind,
      expectedBytes: reserved.expectedBytes,
      maxBytes: reserved.maxBytes,
    });
    if (
      result.fileId !== reserved.finalFileId ||
      result.fileSize !== reserved.expectedBytes ||
      !result.mimeType ||
      (reserved.kind === 'audio' && (!result.duration || result.duration > 14400))
    )
      throw new AppError('UPLOAD_FAILED');
    return await repository.runTransaction(async (transaction) => {
      const current = owned(await transaction.findUpload(id), actor);
      const fresh = await adminInTransaction(transaction, actor, current.schoolId);
      if (current.status !== 'validating') throw new AppError('UPLOAD_EXPIRED');
      const next: AudioUploadRecord = {
        ...current,
        status: 'confirmed',
        fileSize: result.fileSize,
        mimeType: result.mimeType,
        ...(result.duration === undefined ? {} : { duration: result.duration }),
        updatedAt: now,
      };
      await transaction.saveUpload(next, true);
      await audit(transaction, fresh, next, 'audio_upload_confirm', current.status, requestId, now);
      return confirmation(next);
    });
  } catch (error: unknown) {
    // Never overwrite an immutable target on retry. A new ticket gets a new path.
    await repository.runTransaction(async (transaction) => {
      const current = await transaction.findUpload(id);
      if (current?.status === 'validating')
        await transaction.saveUpload({ ...current, status: 'cancelled', updatedAt: now }, true);
    });
    throw error;
  }
}
export async function cancelUpload(
  repository: Repository,
  actor: User,
  payload: Record<string, unknown>,
  now: Date,
  requestId: string,
): Promise<{ cancelled: true }> {
  fields(payload, ['ticketId']);
  const id = identifier(payload.ticketId);
  await repository.runTransaction(async (transaction) => {
    const current = owned(await transaction.findUpload(id), actor);
    const fresh = await adminInTransaction(transaction, actor, current.schoolId);
    if (current.status === 'bound') throw new AppError('AUDIO_STATE_CONFLICT');
    if (current.status === 'cancelled' || current.status === 'cleaned') return;
    // A validator already running may finish writing; cleanup waits beyond the grant and ticket TTL.
    const next = { ...current, status: 'cancelled' as const, updatedAt: now };
    await transaction.saveUpload(next, true);
    await audit(transaction, fresh, next, 'audio_upload_cancel', current.status, requestId, now);
  });
  return { cancelled: true };
}
async function bindings(
  transaction: TransactionRepository,
  actor: User,
  schoolId: string,
  ticketId: string,
  kind: 'audio' | 'cover',
  audioId: string,
  now: Date,
  requestId: string,
): Promise<AudioUploadRecord> {
  const current = owned(await transaction.findUpload(ticketId), actor);
  if (current.schoolId !== schoolId || current.kind !== kind) throw new AppError('FORBIDDEN');
  if (current.status === 'bound' && current.audioId === audioId) return current;
  if (
    current.status !== 'confirmed' ||
    current.expiresAt <= now ||
    !current.finalFileId ||
    !current.fileSize ||
    !current.mimeType
  )
    throw new AppError('UPLOAD_EXPIRED');
  const next = { ...current, status: 'bound' as const, audioId, updatedAt: now };
  await transaction.saveUpload(next, true);
  await audit(transaction, actor, next, 'audio_upload_bind', current.status, requestId, now);
  return next;
}
async function metadata(
  transaction: TransactionRepository,
  schoolId: string,
  payload: Record<string, unknown>,
): Promise<{
  title: string;
  description: string;
  speakerName: string;
  speakerTitle: string;
  visibility: Visibility;
  classIds: string[];
}> {
  const title = text(payload.title, 120, true);
  const description = text(payload.description, 2000);
  const speakerName = text(payload.speakerName, 80, true);
  const speakerTitle = text(payload.speakerTitle, 80);
  if (payload.visibility !== 'school' && payload.visibility !== 'classes')
    throw new AppError('INVALID_ARGUMENT');
  if (!Array.isArray(payload.classIds) || payload.classIds.length > 100)
    throw new AppError('INVALID_ARGUMENT');
  const classIds = payload.classIds.map(identifier);
  if (
    new Set(classIds).size !== classIds.length ||
    (payload.visibility === 'school' && classIds.length > 0) ||
    (payload.visibility === 'classes' && classIds.length === 0)
  )
    throw new AppError('INVALID_ARGUMENT');
  for (const id of classIds) {
    const classroom = await transaction.findClass(id);
    if (
      !classroom ||
      classroom.schoolId !== schoolId ||
      classroom.status !== 'active' ||
      classroom.deletedAt != null
    )
      throw new AppError('CLASS_NOT_AVAILABLE');
    const grade = await transaction.findGrade(classroom.gradeId);
    if (
      !grade ||
      grade.schoolId !== schoolId ||
      grade.status !== 'active' ||
      grade.deletedAt != null
    )
      throw new AppError('CLASS_NOT_AVAILABLE');
  }
  return {
    title,
    description,
    speakerName,
    speakerTitle,
    visibility: payload.visibility,
    classIds,
  };
}
function managedBase(audio: AudioProgram): ManagedAudio {
  return {
    _id: audio._id,
    schoolId: audio.schoolId,
    title: audio.title,
    description: audio.description,
    speakerName: audio.speakerName,
    speakerTitle: audio.speakerTitle,
    visibility: audio.visibility,
    classIds: audio.classIds,
    status: audio.status,
    duration: audio.duration,
    fileSize: audio.fileSize,
    mimeType: audio.mimeType ?? '',
    createdAt: audio.createdAt.toISOString(),
    updatedAt: audio.updatedAt.toISOString(),
    ...(audio.publishedAt ? { publishedAt: audio.publishedAt.toISOString() } : {}),
  };
}
async function managed(
  audio: AudioProgram,
  storage: AudioStoragePort | undefined,
  now: Date,
  includeMedia = false,
): Promise<ManagedAudio> {
  const result = managedBase(audio);
  if (audio.coverFileId)
    result.coverUrl = await requireStorage(storage).temporaryUrl(audio.coverFileId, MEDIA_TTL);
  if (includeMedia) {
    result.mediaUrl = await requireStorage(storage).temporaryUrl(audio.audioFileId, MEDIA_TTL);
    result.mediaExpiresAt = new Date(now.getTime() + MEDIA_TTL * 1000).toISOString();
  }
  return result;
}
export async function createDraft(
  repository: Repository,
  actor: User,
  payload: Record<string, unknown>,
  now: Date,
  requestId: string,
): Promise<ManagedAudio> {
  fields(payload, [
    'schoolId',
    'title',
    'description',
    'speakerName',
    'speakerTitle',
    'visibility',
    'classIds',
    'audioTicketId',
    'coverTicketId',
  ]);
  const schoolId = identifier(payload.schoolId);
  const audioTicketId = identifier(payload.audioTicketId);
  // Deterministic per uploaded media: retry after a lost response returns the same draft.
  const id = `audio_${audioTicketId}`;
  return repository.runTransaction(async (transaction) => {
    const fresh = await adminInTransaction(transaction, actor, schoolId);
    const existing = await transaction.findAudio(id);
    if (existing) {
      if (
        existing.createdBy !== actor._id ||
        existing.schoolId !== schoolId ||
        existing.status === 'deleted'
      )
        throw new AppError('AUDIO_STATE_CONFLICT');
      return managedBase(existing);
    }
    const values = await metadata(transaction, schoolId, payload);
    const audioUpload = await bindings(
      transaction,
      fresh,
      schoolId,
      audioTicketId,
      'audio',
      id,
      now,
      requestId,
    );
    if (!audioUpload.duration || audioUpload.duration > 14400) throw new AppError('UPLOAD_FAILED');
    const coverTicketId =
      payload.coverTicketId === undefined ? undefined : identifier(payload.coverTicketId);
    const cover = coverTicketId
      ? await bindings(transaction, fresh, schoolId, coverTicketId, 'cover', id, now, requestId)
      : undefined;
    const audio: AudioProgram = {
      _id: id,
      schoolId,
      ...values,
      audioTicketId,
      ...(coverTicketId ? { coverTicketId } : {}),
      audioFileId: audioUpload.finalFileId,
      coverFileId: cover?.finalFileId ?? '',
      fileSize: audioUpload.fileSize!,
      mimeType: audioUpload.mimeType!,
      duration: audioUpload.duration,
      originalFileName: audioUpload.originalFileName,
      status: 'draft',
      createdBy: fresh._id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await transaction.saveAudio(audio, false);
    await audit(transaction, fresh, audio, 'audio_create', 'none', requestId, now);
    return managedBase(audio);
  });
}
async function resource(
  transaction: TransactionRepository,
  actor: User,
  id: string,
): Promise<{ actor: User; audio: AudioProgram }> {
  const audio = await transaction.findAudio(id);
  if (!audio || audio.status === 'deleted' || audio.deletedAt != null)
    throw new AppError('AUDIO_NOT_FOUND');
  const fresh = await adminInTransaction(transaction, actor, audio.schoolId);
  return { actor: fresh, audio };
}
async function detach(
  transaction: TransactionRepository,
  id: string | undefined,
  audioId: string,
  now: Date,
): Promise<void> {
  if (!id) return;
  const upload = await transaction.findUpload(id);
  if (upload?.status === 'bound' && upload.audioId === audioId)
    await transaction.saveUpload(
      { ...upload, status: 'cancelled', updatedAt: now, finalCleaned: false },
      true,
    );
}
export async function updateDraft(
  repository: Repository,
  actor: User,
  payload: Record<string, unknown>,
  now: Date,
  requestId: string,
): Promise<ManagedAudio> {
  fields(payload, [
    'audioId',
    'title',
    'description',
    'speakerName',
    'speakerTitle',
    'visibility',
    'classIds',
    'audioTicketId',
    'coverTicketId',
    'useDefaultCover',
  ]);
  const id = identifier(payload.audioId);
  if (payload.useDefaultCover !== undefined && typeof payload.useDefaultCover !== 'boolean')
    throw new AppError('INVALID_ARGUMENT');
  if (payload.useDefaultCover === true && payload.coverTicketId !== undefined)
    throw new AppError('INVALID_ARGUMENT');
  return repository.runTransaction(async (transaction) => {
    const { actor: fresh, audio } = await resource(transaction, actor, id);
    if (audio.status !== 'draft' && audio.status !== 'offline')
      throw new AppError('AUDIO_STATE_CONFLICT');
    const next = {
      ...audio,
      ...(await metadata(transaction, audio.schoolId, payload)),
      updatedAt: now,
    };
    if (payload.audioTicketId !== undefined && payload.audioTicketId !== audio.audioTicketId) {
      const upload = await bindings(
        transaction,
        fresh,
        audio.schoolId,
        identifier(payload.audioTicketId),
        'audio',
        id,
        now,
        requestId,
      );
      if (!upload.duration) throw new AppError('UPLOAD_FAILED');
      await detach(transaction, audio.audioTicketId, id, now);
      next.audioTicketId = upload._id;
      next.audioFileId = upload.finalFileId;
      next.duration = upload.duration;
      next.fileSize = upload.fileSize!;
      next.mimeType = upload.mimeType!;
      next.originalFileName = upload.originalFileName;
    }
    if (payload.coverTicketId !== undefined && payload.coverTicketId !== audio.coverTicketId) {
      const upload = await bindings(
        transaction,
        fresh,
        audio.schoolId,
        identifier(payload.coverTicketId),
        'cover',
        id,
        now,
        requestId,
      );
      await detach(transaction, audio.coverTicketId, id, now);
      next.coverTicketId = upload._id;
      next.coverFileId = upload.finalFileId;
    } else if (payload.useDefaultCover === true) {
      await detach(transaction, audio.coverTicketId, id, now);
      next.coverFileId = '';
      next.coverTicketId = '';
    }
    await transaction.saveAudio(next, true);
    await audit(transaction, fresh, next, 'audio_update', audio.status, requestId, now);
    return managedBase(next);
  });
}
export async function transitionAudio(
  repository: Repository,
  actor: User,
  payload: Record<string, unknown>,
  action: 'publish' | 'offline' | 'delete',
  now: Date,
  requestId: string,
): Promise<ManagedAudio> {
  fields(payload, ['audioId']);
  const id = identifier(payload.audioId);
  return repository.runTransaction(async (transaction) => {
    const { actor: fresh, audio } = await resource(transaction, actor, id);
    if (
      (action === 'publish' && audio.status === 'published') ||
      (action === 'offline' && audio.status === 'offline')
    )
      return managedBase(audio);
    if (action === 'offline' && audio.status !== 'published')
      throw new AppError('AUDIO_STATE_CONFLICT');
    const next: AudioProgram = { ...audio, updatedAt: now };
    if (action === 'publish') {
      await metadata(transaction, audio.schoolId, { ...audio });
      const upload = audio.audioTicketId
        ? await transaction.findUpload(audio.audioTicketId)
        : undefined;
      if (
        !upload ||
        upload.status !== 'bound' ||
        upload.audioId !== audio._id ||
        upload.finalFileId !== audio.audioFileId ||
        upload.duration !== audio.duration ||
        upload.fileSize !== audio.fileSize ||
        !audio.duration ||
        audio.duration > 14400
      )
        throw new AppError('UPLOAD_FAILED');
      if (audio.coverFileId) {
        const cover = audio.coverTicketId
          ? await transaction.findUpload(audio.coverTicketId)
          : undefined;
        if (
          !cover ||
          cover.status !== 'bound' ||
          cover.audioId !== audio._id ||
          cover.finalFileId !== audio.coverFileId ||
          cover.kind !== 'cover'
        )
          throw new AppError('UPLOAD_FAILED');
      }
      next.status = 'published';
      next.publishedAt = now;
      next.publishedBy = fresh._id;
    } else if (action === 'offline') {
      next.status = 'offline';
      next.offlineAt = now;
    } else {
      next.status = 'deleted';
      next.deletedAt = now;
      next.deletedBy = fresh._id;
      await detach(transaction, audio.audioTicketId, id, now);
      await detach(transaction, audio.coverTicketId, id, now);
    }
    await transaction.saveAudio(next, true);
    await audit(transaction, fresh, next, `audio_${action}`, audio.status, requestId, now);
    return managedBase(next);
  });
}
export async function listManage(
  repository: Repository,
  storage: AudioStoragePort | undefined,
  actor: User,
  payload: Record<string, unknown>,
  now: Date,
): Promise<CursorPage<ManagedAudio>> {
  fields(payload, ['schoolId', 'status', 'cursor', 'pageSize']);
  const schoolId = identifier(payload.schoolId);
  await requireAdmin(repository, actor.openid, schoolId);
  const status = payload.status;
  if (status !== undefined && status !== 'draft' && status !== 'published' && status !== 'offline')
    throw new AppError('INVALID_ARGUMENT');
  const scope = JSON.stringify(['manage', actor._id, schoolId, status]);
  const page = parsePage(payload, scope, now);
  const records = await repository.listAudio({
    schoolId,
    status,
    snapshot: page.snapshot,
    before: page.before,
    limit: page.size + 1,
  });
  if (
    records.some(
      (record) =>
        record.schoolId !== schoolId ||
        record.deletedAt != null ||
        record.status === 'deleted' ||
        (status && record.status !== status),
    )
  )
    throw new AppError('INTERNAL_ERROR');
  const output: CursorPage<ManagedAudio> = {
    items: await Promise.all(
      records.slice(0, page.size).map((record) => managed(record, storage, now)),
    ),
  };
  const last = records[page.size - 1];
  if (records.length > page.size && last)
    output.nextCursor = cursor(scope, page.snapshot, { time: last.createdAt, id: last._id });
  return output;
}
export async function manageDetail(
  repository: Repository,
  storage: AudioStoragePort | undefined,
  actor: User,
  payload: Record<string, unknown>,
  now: Date,
): Promise<ManagedAudio> {
  fields(payload, ['audioId', 'includeMedia']);
  if (payload.includeMedia !== undefined && typeof payload.includeMedia !== 'boolean')
    throw new AppError('INVALID_ARGUMENT');
  const audio = await repository.runTransaction(
    async (transaction) => (await resource(transaction, actor, identifier(payload.audioId))).audio,
  );
  return managed(audio, storage, now, payload.includeMedia === true);
}
export async function cleanupUploads(
  repository: Repository,
  storage: AudioStoragePort | undefined,
  actor: User,
  payload: Record<string, unknown>,
  now: Date,
  requestId: string,
): Promise<{ cleaned: number; failed: number }> {
  fields(payload, ['schoolId']);
  const schoolId = identifier(payload.schoolId);
  await requireAdmin(repository, actor.openid, schoolId);
  const records = await repository.listCleanupUploads(
    schoolId,
    new Date(now.getTime() - 5 * 60 * 1000),
    30,
  );
  let cleaned = 0;
  let failed = 0;
  for (const candidate of records) {
    try {
      const upload = await repository.runTransaction(async (transaction) => {
        const fresh = await adminInTransaction(transaction, actor, schoolId);
        const current = await transaction.findUpload(candidate._id);
        if (
          !current ||
          current.schoolId !== schoolId ||
          current.status === 'cleaned' ||
          current.grantExpiresAt.getTime() + 5 * 60 * 1000 >= now.getTime() ||
          current.expiresAt > now
        )
          return null;
        if (current.status === 'bound') return current;
        if (
          current.status === 'validating' &&
          current.validationStartedAt &&
          current.validationStartedAt.getTime() + 10 * 60 * 1000 >= now.getTime()
        )
          return null;
        const next = { ...current, status: 'cancelled' as const, updatedAt: now };
        await transaction.saveUpload(next, true);
        await audit(
          transaction,
          fresh,
          next,
          'audio_upload_cleanup_claim',
          current.status,
          requestId,
          now,
        );
        return next;
      });
      if (!upload) continue;
      const files = [
        !upload.sourceCleaned ? upload.sourceFileId : '',
        upload.status !== 'bound' && !upload.finalCleaned ? upload.finalFileId : '',
      ].filter(Boolean);
      if (files.length) await requireStorage(storage).deleteFiles(files);
      await repository.runTransaction(async (transaction) => {
        const fresh = await adminInTransaction(transaction, actor, schoolId);
        const current = await transaction.findUpload(upload._id);
        if (!current || current.status !== upload.status)
          throw new AppError('AUDIO_STATE_CONFLICT');
        const next: AudioUploadRecord = {
          ...current,
          sourceCleaned: true,
          ...(current.status === 'bound' ? {} : { finalCleaned: true, status: 'cleaned' as const }),
          updatedAt: now,
        };
        await transaction.saveUpload(next, true);
        await audit(
          transaction,
          fresh,
          next,
          'audio_upload_cleanup',
          current.status,
          requestId,
          now,
        );
      });
      cleaned += 1;
    } catch {
      failed += 1;
    }
  }
  return { cleaned, failed };
}
