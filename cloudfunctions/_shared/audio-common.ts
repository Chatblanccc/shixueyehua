import { createHash } from 'node:crypto';
import type { AudioProgram, AudioProgress, AudioSummary, User } from '../../shared';
import { isRecord } from '../../shared';
import { assertNotDeleted, assertSameSchool, requireLogin } from './auth';
import type { AudioPosition, AudioReader } from './audio-repository';
import type { Repository, TransactionRepository } from './repository';
import type { AudioStoragePort } from './audio-storage-port';
import { AppError } from './errors';
import { identifier } from './validate';
import { transactionUser } from './user-transaction';

export const MEDIA_TTL = 600;
export function relationId(userId: string, audioId: string): string {
  return createHash('sha256')
    .update(JSON.stringify([userId, audioId]))
    .digest('hex');
}
export function fields(payload: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(payload).some((key) => !allowed.includes(key)))
    throw new AppError('INVALID_ARGUMENT');
}
export function boundedNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new AppError('INVALID_ARGUMENT');
  return value;
}
export async function readScope(repository: Repository, openid: string): Promise<User> {
  const user = await requireLogin(repository, openid);
  await assertScope(repository, user);
  return user;
}
export async function assertScope(
  repository: Pick<Repository, 'findSchool' | 'findGrade' | 'findClass'>,
  user: User,
): Promise<void> {
  if (!user.identity || !user.currentSchoolId || !user.currentGradeId || !user.currentClassId)
    throw new AppError('CLASS_NOT_AVAILABLE');
  const [school, grade, classroom] = await Promise.all([
    repository.findSchool(user.currentSchoolId),
    repository.findGrade(user.currentGradeId),
    repository.findClass(user.currentClassId),
  ]);
  if (!school || school.status !== 'active' || school.deletedAt != null)
    throw new AppError('SCHOOL_NOT_AVAILABLE');
  if (
    !grade ||
    grade.status !== 'active' ||
    grade.deletedAt != null ||
    grade.schoolId !== school._id ||
    !classroom ||
    classroom.status !== 'active' ||
    classroom.deletedAt != null ||
    classroom.schoolId !== school._id ||
    classroom.gradeId !== grade._id
  )
    throw new AppError('CLASS_NOT_AVAILABLE');
}
export function visible(audio: AudioProgram | undefined, user: User): audio is AudioProgram {
  return (
    !!audio &&
    audio.status === 'published' &&
    audio.deletedAt == null &&
    audio.schoolId === user.currentSchoolId &&
    !!audio.publishedAt &&
    (audio.visibility === 'school' ||
      (audio.visibility === 'classes' &&
        !!user.currentClassId &&
        audio.classIds.includes(user.currentClassId)))
  );
}
export function requireVisible(audio: AudioProgram | undefined, user: User): AudioProgram {
  if (!visible(audio, user)) throw new AppError('AUDIO_NOT_FOUND');
  return audio;
}
export function progressDto(value: import('../../shared').PlayProgress): AudioProgress {
  return {
    audioId: value.audioId,
    currentTime: value.currentTime,
    duration: value.duration,
    completed: value.completed,
    updatedAt: value.updatedAt.toISOString(),
  };
}
export async function summary(
  repository: AudioReader,
  storage: AudioStoragePort | undefined,
  audio: AudioProgram,
  user: User,
): Promise<AudioSummary> {
  if (!audio.publishedAt) throw new AppError('AUDIO_NOT_FOUND');
  const id = relationId(user._id, audio._id);
  const [progress, favorite] = await Promise.all([
    repository.findProgress(id),
    repository.findFavorite(id),
  ]);
  if (
    (progress && (progress.userId !== user._id || progress.audioId !== audio._id)) ||
    (favorite && (favorite.userId !== user._id || favorite.audioId !== audio._id))
  )
    throw new AppError('INTERNAL_ERROR');
  const result: AudioSummary = {
    _id: audio._id,
    schoolId: audio.schoolId,
    title: audio.title,
    speakerName: audio.speakerName,
    speakerTitle: audio.speakerTitle,
    duration: audio.duration,
    publishedAt: audio.publishedAt.toISOString(),
    progress: progress && progress.deletedAt == null ? progressDto(progress) : null,
    favorite: !!favorite && favorite.deletedAt == null,
  };
  if (audio.coverFileId)
    result.coverUrl = await requireStorage(storage).temporaryUrl(audio.coverFileId, MEDIA_TTL);
  return result;
}
export function requireStorage(storage: AudioStoragePort | undefined): AudioStoragePort {
  if (!storage) throw new AppError('UPLOAD_FAILED');
  return storage;
}
export function parsePage(
  payload: Record<string, unknown>,
  scope: string,
  now: Date,
): { size: number; snapshot: Date; before?: AudioPosition } {
  const size = payload.pageSize === undefined ? 20 : boundedNumber(payload.pageSize, 1, 100);
  if (!Number.isInteger(size)) throw new AppError('INVALID_ARGUMENT');
  if (payload.cursor === undefined) return { size, snapshot: now };
  try {
    if (typeof payload.cursor !== 'string' || payload.cursor.length > 2048) throw new Error();
    const decoded: unknown = JSON.parse(Buffer.from(payload.cursor, 'base64url').toString('utf8'));
    if (
      !isRecord(decoded) ||
      decoded.v !== 1 ||
      decoded.scope !== scope ||
      typeof decoded.snapshot !== 'string' ||
      typeof decoded.time !== 'string'
    )
      throw new Error();
    const snapshot = new Date(decoded.snapshot);
    const time = new Date(decoded.time);
    if (
      !Number.isFinite(snapshot.getTime()) ||
      !Number.isFinite(time.getTime()) ||
      snapshot > now ||
      time > snapshot
    )
      throw new Error();
    return { size, snapshot, before: { time, id: identifier(decoded.id) } };
  } catch {
    throw new AppError('INVALID_ARGUMENT');
  }
}
export function cursor(scope: string, snapshot: Date, position: AudioPosition): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      scope,
      snapshot: snapshot.toISOString(),
      time: position.time.toISOString(),
      id: position.id,
    }),
  ).toString('base64url');
}
export function scopeKey(user: User, action: string): string {
  return JSON.stringify([
    action,
    user._id,
    user.currentSchoolId,
    user.currentGradeId,
    user.currentClassId,
  ]);
}
export async function adminInTransaction(
  transaction: TransactionRepository,
  user: User,
  schoolId: string,
): Promise<User> {
  const fresh = await transactionUser(transaction, user._id, user.openid);
  if (fresh.role !== 'admin' && fresh.role !== 'super_admin') throw new AppError('FORBIDDEN');
  assertSameSchool(fresh, schoolId);
  const school = await transaction.findSchool(schoolId);
  if (!school || school.status !== 'active' || school.deletedAt != null)
    throw new AppError('SCHOOL_NOT_AVAILABLE');
  return fresh;
}
export function assertReadUser(user: User): void {
  assertNotDeleted(user);
}
