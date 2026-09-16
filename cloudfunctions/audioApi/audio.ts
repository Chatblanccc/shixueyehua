import type {
  AudioDetail,
  AudioSummary,
  CursorPage,
  FavoriteResult,
  AudioProgress,
  User,
} from '../../shared';
import { requireActiveUser } from '../_shared/auth';
import {
  assertScope,
  cursor,
  fields,
  MEDIA_TTL,
  parsePage,
  progressDto,
  readScope,
  relationId,
  requireStorage,
  requireVisible,
  scopeKey,
  summary,
  visible,
  boundedNumber,
} from '../_shared/audio-common';
import type { AudioStoragePort } from '../_shared/audio-storage-port';
import type { Repository } from '../_shared/repository';
import { AppError } from '../_shared/errors';
import { identifier } from '../_shared/validate';
import { transactionUser } from '../_shared/user-transaction';

export async function listAudio(
  repository: Repository,
  storage: AudioStoragePort | undefined,
  openid: string,
  payload: Record<string, unknown>,
  now: Date,
  action: 'list' | 'history' | 'listFavorites',
): Promise<CursorPage<AudioSummary>> {
  const user = await readScope(repository, openid);
  fields(payload, ['cursor', 'pageSize']);
  const scope = scopeKey(user, action);
  const page = parsePage(payload, scope, now);
  const output: CursorPage<AudioSummary> = { items: [] };
  if (action === 'list') {
    const records = await repository.listAudio({
      schoolId: user.currentSchoolId!,
      classId: user.currentClassId,
      status: 'published',
      visibleOnly: true,
      snapshot: page.snapshot,
      before: page.before,
      limit: page.size + 1,
    });
    if (records.some((item) => !visible(item, user))) throw new AppError('INTERNAL_ERROR');
    output.items = await Promise.all(
      records.slice(0, page.size).map((item) => summary(repository, storage, item, user)),
    );
    const last = records[page.size - 1];
    if (records.length > page.size && last?.publishedAt)
      output.nextCursor = cursor(scope, page.snapshot, { time: last.publishedAt, id: last._id });
    return output;
  }
  // Scan bounded batches of personal relations; unavailable content is never returned.
  let before = page.before;
  for (let batch = 0; batch < 10; batch += 1) {
    const query = { userId: user._id, snapshot: page.snapshot, before, limit: 100 };
    const records =
      action === 'history'
        ? await repository.listProgress(query)
        : await repository.listFavorites(query);
    for (let index = 0; index < records.length; index += 1) {
      const relation = records[index]!;
      if (relation.userId !== user._id || relation.deletedAt != null)
        throw new AppError('INTERNAL_ERROR');
      const time = action === 'history' ? relation.updatedAt : relation.createdAt;
      before = { time, id: relation._id };
      const audio = await repository.findAudio(relation.audioId);
      if (visible(audio, user)) output.items.push(await summary(repository, storage, audio, user));
      if (output.items.length === page.size) {
        if (index < records.length - 1 || records.length === 100)
          output.nextCursor = cursor(scope, page.snapshot, before);
        return output;
      }
    }
    if (records.length < 100) return output;
  }
  if (before) output.nextCursor = cursor(scope, page.snapshot, before);
  return output;
}
export async function audioDetail(
  repository: Repository,
  storage: AudioStoragePort | undefined,
  openid: string,
  payload: Record<string, unknown>,
  now: Date,
): Promise<AudioDetail> {
  const user = await readScope(repository, openid);
  fields(payload, ['audioId', 'includeMedia']);
  if (payload.includeMedia !== undefined && typeof payload.includeMedia !== 'boolean')
    throw new AppError('INVALID_ARGUMENT');
  const audio = requireVisible(await repository.findAudio(identifier(payload.audioId)), user);
  const result: AudioDetail = {
    ...(await summary(repository, storage, audio, user)),
    description: audio.description,
  };
  const base = {
    schoolId: user.currentSchoolId!,
    classId: user.currentClassId,
    status: 'published' as const,
    visibleOnly: true,
    snapshot: now,
    limit: 1,
  };
  const position = { time: audio.publishedAt!, id: audio._id };
  const [newer, older] = await Promise.all([
    repository.listAudio({ ...base, after: position }),
    repository.listAudio({ ...base, before: position }),
  ]);
  if (newer[0] && visible(newer[0], user)) result.previousAudioId = newer[0]._id;
  if (older[0] && visible(older[0], user)) result.nextAudioId = older[0]._id;
  if (payload.includeMedia === true) {
    result.mediaUrl = await requireStorage(storage).temporaryUrl(audio.audioFileId, MEDIA_TTL);
    result.mediaExpiresAt = new Date(now.getTime() + MEDIA_TTL * 1000).toISOString();
  }
  return result;
}
async function writableAudio(repository: Repository, openid: string): Promise<User> {
  return requireActiveUser(repository, openid);
}
export async function saveAudioProgress(
  repository: Repository,
  openid: string,
  payload: Record<string, unknown>,
  now: Date,
): Promise<AudioProgress> {
  const actor = await writableAudio(repository, openid);
  fields(payload, ['audioId', 'currentTime']);
  const audioId = identifier(payload.audioId);
  return repository.runTransaction(async (transaction) => {
    const user = await transactionUser(transaction, actor._id, openid);
    await assertScope(transaction, user);
    const audio = requireVisible(await transaction.findAudio(audioId), user);
    const currentTime = boundedNumber(payload.currentTime, 0, audio.duration);
    const id = relationId(user._id, audioId);
    const old = await transaction.findProgress(id);
    if (old && (old.userId !== user._id || old.audioId !== audioId))
      throw new AppError('INTERNAL_ERROR');
    if (old && old.currentTime === currentTime && old.duration === audio.duration)
      return progressDto(old);
    if (old && now.getTime() - old.updatedAt.getTime() < 5000) throw new AppError('RATE_LIMITED');
    const progress = {
      _id: id,
      userId: user._id,
      schoolId: audio.schoolId,
      audioId,
      currentTime,
      duration: audio.duration,
      completed: currentTime / audio.duration >= 0.95 || old?.completed === true,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    };
    await transaction.saveProgress(progress, !!old);
    return progressDto(progress);
  });
}
export async function setFavorite(
  repository: Repository,
  openid: string,
  payload: Record<string, unknown>,
  now: Date,
): Promise<FavoriteResult> {
  const actor = await writableAudio(repository, openid);
  fields(payload, ['audioId', 'favorite']);
  const audioId = identifier(payload.audioId);
  if (typeof payload.favorite !== 'boolean') throw new AppError('INVALID_ARGUMENT');
  const favorite = payload.favorite;
  return repository.runTransaction(async (transaction) => {
    const user = await transactionUser(transaction, actor._id, openid);
    await assertScope(transaction, user);
    const audio = requireVisible(await transaction.findAudio(audioId), user);
    const id = relationId(user._id, audioId);
    const old = await transaction.findFavorite(id);
    if (old && (old.userId !== user._id || old.audioId !== audioId))
      throw new AppError('INTERNAL_ERROR');
    if ((!!old && old.deletedAt == null) === favorite) return { audioId, favorite };
    await transaction.saveFavorite(
      {
        _id: id,
        userId: user._id,
        schoolId: audio.schoolId,
        audioId,
        createdAt: favorite ? now : (old?.createdAt ?? now),
        updatedAt: now,
        deletedAt: favorite ? null : now,
      },
      !!old,
    );
    return { audioId, favorite };
  });
}
