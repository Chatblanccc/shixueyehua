import {
  isRecord,
  parseManagedAudio,
  parseUserProfile,
  parseAudioProgress,
  readEnum,
  readString,
} from '../generated/shared';
import type {
  AudioProgress,
  ManagedAudio,
  UserProfile,
  AudioDetail,
  ErrorCode,
} from '../generated/shared';
import type { CloudInvocation } from './cloud-client';
import { localLetterAction, LocalLetterError } from './local-letters';
import type { LocalLetter } from './local-letters';
import { parseOwnLetter } from '../generated/shared';
function parseLocalImages(value: unknown) {
  if (!Array.isArray(value) || value.length > 3) throw new Error('本地图片记录无效');
  return value.map((v: unknown) => {
    if (!isRecord(v)) throw new Error('本地图片记录无效');
    return { fileId: readString(v.fileId), path: readString(v.path, 2048) };
  });
}

const SCHOOL = 'demo-school';
const GRADE = 'demo-grade';
const CLASS = 'demo-class-1';
const MEDIA_PREFIX = 'https://local.shixue.invalid/';
export const SAMPLE_PATH = '/assets/demo-night.m4a';
export const SAMPLE_DURATION = 24.252744;
export const localClasses = [1, 2].map((n) => ({
  _id: `demo-class-${n}`,
  name: `七年级${n}班`,
  schoolId: SCHOOL,
  gradeId: GRADE,
  joinMode: 'free' as const,
}));
interface RecordAudio extends ManagedAudio {
  localPath: string;
  coverPath?: string;
}
interface LocalState {
  letters: LocalLetter[];
  version: 1;
  user: UserProfile;
  audio: RecordAudio[];
  progress: AudioProgress[];
  favorites: string[];
  sequence: number;
}
export interface LocalPersistence {
  read(): unknown;
  write(value: unknown): void;
  now(): number;
}
class LocalError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}
function denied(code: ErrorCode): never {
  throw new LocalError(code);
}
function seed(now: string): LocalState {
  const audio: RecordAudio[] = [
    '今晚，先听听孩子的话',
    '新学期，从一个小目标开始',
    '留给家人的十分钟',
  ].map((title, i) => ({
    _id: `demo-audio-${i + 1}`,
    schoolId: SCHOOL,
    title,
    description:
      '这是一段随开发版提供的合成语音，仅用于体验播放、收藏与发布流程。正式校园内容由学校管理员提供。',
    speakerName: '体验电台',
    speakerTitle: '示例节目',
    visibility: 'school',
    classIds: [],
    status: 'published',
    duration: SAMPLE_DURATION,
    fileSize: 1,
    mimeType: 'audio/mp4',
    createdAt: now,
    updatedAt: now,
    publishedAt: new Date(Date.parse(now) - i * 86400000).toISOString(),
    localPath: SAMPLE_PATH,
  }));
  return {
    version: 1,
    letters: [],
    sequence: 0,
    audio,
    progress: [],
    favorites: [],
    user: {
      _id: 'demo-listener',
      nickname: '体验听友',
      identity: 'parent',
      role: 'user',
      status: 'active',
      avatarPreset: 'moon',
      currentSchoolId: SCHOOL,
      currentGradeId: GRADE,
      currentClassId: CLASS,
      createdAt: now,
      updatedAt: now,
    },
  };
}
function restore(value: unknown): LocalState {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.audio) ||
    !Array.isArray(value.progress) ||
    !Array.isArray(value.favorites) ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0
  )
    throw new Error('本地体验数据损坏，请在我的页面重置');
  return {
    version: 1,
    letters:
      value.letters === undefined
        ? []
        : Array.isArray(value.letters)
          ? value.letters.map((v: unknown) => {
              if (!isRecord(v)) throw new Error('本地家书数据无效');
              return {
                ...parseOwnLetter(v),
                authorId: readString(v.authorId),
                requestKey: readString(v.requestKey),
                ...(v.images === undefined ? {} : { images: parseLocalImages(v.images) }),
              };
            })
          : (() => {
              throw new Error('本地家书数据无效');
            })(),
    sequence: value.sequence,
    user: parseUserProfile(value.user),
    audio: value.audio.map((entry: unknown) => {
      if (!isRecord(entry)) throw new Error('本地音频数据无效');
      return {
        ...parseManagedAudio(entry),
        localPath: readString(entry.localPath, 2048),
        ...(typeof entry.coverPath === 'string' ? { coverPath: entry.coverPath } : {}),
      };
    }),
    progress: value.progress.map(parseAudioProgress),
    favorites: value.favorites.map((id: unknown) => readString(id)),
  };
}
function visible(audio: RecordAudio, user: UserProfile): boolean {
  return (
    audio.status === 'published' &&
    audio.schoolId === user.currentSchoolId &&
    (audio.visibility === 'school' || audio.classIds.includes(user.currentClassId ?? ''))
  );
}
function publicAudio(audio: RecordAudio): ManagedAudio {
  const { localPath: _local, coverPath: _cover, ...result } = audio;
  return result;
}
/** Separate local database; preserves the same service DTOs without cloud credentials. */
export class LocalRepository {
  constructor(private readonly port: LocalPersistence) {}
  private read(): LocalState {
    const raw = this.port.read();
    if (raw === '' || raw === undefined || raw === null) {
      const initial = seed(new Date(this.port.now()).toISOString());
      this.port.write(initial);
      return initial;
    }
    return restore(raw);
  }
  reset(): void {
    this.port.write(seed(new Date(this.port.now()).toISOString()));
  }
  setRole(role: 'user' | 'admin'): void {
    const state = this.read();
    state.user.role = role;
    if (role === 'admin') state.user.adminSchoolId = SCHOOL;
    else delete state.user.adminSchoolId;
    this.port.write(state);
  }
  media(url: string): string {
    if (!url.startsWith(MEDIA_PREFIX)) throw new Error('非法本地媒体地址');
    const audio = this.read().audio.find((a) => a._id === url.slice(MEDIA_PREFIX.length));
    if (!audio || audio.status === 'deleted') throw new Error('本地音频不存在');
    return audio.localPath;
  }
  cover(audioId: string): string {
    return this.read().audio.find((a) => a._id === audioId)?.coverPath ?? '';
  }
  async invoke(request: CloudInvocation): Promise<unknown> {
    try {
      const state = this.read();
      const payload = request.data.payload === undefined ? {} : request.data.payload;
      if (!isRecord(payload)) denied('INVALID_ARGUMENT');
      const result = this.execute(state, request.name, request.data.action, payload);
      // Persist before returning a success, including storage-full errors.
      this.port.write(state);
      return { success: true, data: result, requestId: 'local-experience' };
    } catch (error: unknown) {
      return {
        success: false,
        error: {
          code:
            error instanceof LocalError || error instanceof LocalLetterError
              ? error.code
              : 'INVALID_ARGUMENT',
        },
        requestId: 'local-experience',
      };
    }
  }
  private execute(
    state: LocalState,
    domain: string,
    action: string,
    p: Record<string, unknown>,
  ): unknown {
    const user = state.user;
    const now = new Date(this.port.now()).toISOString();
    if (domain === 'letterApi')
      return localLetterAction(
        state.letters,
        user,
        action,
        p,
        now,
        () => `demo-letter-${String(++state.sequence).padStart(8, '0')}`,
      );
    const login = () => ({ user, onboardingStep: 'ready' });
    if (domain === 'authApi') {
      if (action === 'login' || action === 'getProfile') return login();
      if (action === 'updateProfile') {
        if (Object.keys(p).some((k) => !['identity', 'nickname', 'avatarPreset'].includes(k)))
          denied('INVALID_ARGUMENT');
        user.identity = readEnum(p.identity, ['student', 'parent', 'teacher'] as const);
        user.nickname = readString(
          typeof p.nickname === 'string' && p.nickname.trim() ? p.nickname.trim() : '体验听友',
          80,
        );
        user.avatarPreset = readEnum(p.avatarPreset ?? 'moon', ['moon', 'book', 'bamboo'] as const);
        user.updatedAt = now;
        return login();
      }
    }
    if (domain === 'classApi') {
      const school = { _id: SCHOOL, name: '实学体验学校' };
      const grade = { _id: GRADE, schoolId: SCHOOL, name: '七年级' };
      if (action === 'listSchools') return { items: [school] };
      if (action === 'getCurrentClass')
        return { school, grade, class: localClasses.find((c) => c._id === user.currentClassId) };
      if (p.schoolId !== SCHOOL) denied('SCHOOL_NOT_AVAILABLE');
      if (action === 'listGrades') return { items: [grade] };
      if (p.gradeId !== GRADE) denied('CLASS_NOT_AVAILABLE');
      if (action === 'listClasses') return { items: localClasses };
      if (action === 'selectClass') {
        if (!localClasses.some((c) => c._id === p.classId)) denied('CLASS_NOT_AVAILABLE');
        user.currentClassId = String(p.classId);
        return login();
      }
    }
    const summary = (a: RecordAudio): AudioDetail => ({
      _id: a._id,
      schoolId: a.schoolId,
      title: a.title,
      speakerName: a.speakerName,
      speakerTitle: a.speakerTitle,
      duration: a.duration,
      publishedAt: a.publishedAt ?? now,
      description: a.description,
      favorite: state.favorites.includes(a._id),
      progress: state.progress.find((r) => r.audioId === a._id) ?? null,
    });
    const page = <T>(items: T[]) => {
      const offset = p.cursor === undefined ? 0 : Number(p.cursor);
      const size = typeof p.pageSize === 'number' ? p.pageSize : 20;
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isInteger(size) ||
        size < 1 ||
        size > 100
      )
        denied('INVALID_ARGUMENT');
      return {
        items: items.slice(offset, offset + size),
        ...(offset + size < items.length ? { nextCursor: String(offset + size) } : {}),
      };
    };
    if (domain === 'audioApi') {
      const all = state.audio
        .filter((a) => visible(a, user))
        .sort(
          (a, b) =>
            (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || b._id.localeCompare(a._id),
        );
      if (action === 'list') return page(all.map(summary));
      if (action === 'history')
        return page(
          [...state.progress]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .flatMap((r) => {
              const a = all.find((item) => item._id === r.audioId);
              return a ? [summary(a)] : [];
            }),
        );
      if (action === 'listFavorites')
        return page(all.filter((a) => state.favorites.includes(a._id)).map(summary));
      const a = all.find((audio) => audio._id === p.audioId);
      if (!a) denied('AUDIO_NOT_FOUND');
      if (action === 'detail') {
        const index = all.indexOf(a);
        return {
          ...summary(a),
          ...(all[index - 1] ? { previousAudioId: all[index - 1]!._id } : {}),
          ...(all[index + 1] ? { nextAudioId: all[index + 1]!._id } : {}),
          ...(p.includeMedia === true
            ? {
                mediaUrl: MEDIA_PREFIX + a._id,
                mediaExpiresAt: new Date(this.port.now() + 600000).toISOString(),
              }
            : {}),
        };
      }
      if (action === 'toggleFavorite') {
        if (typeof p.favorite !== 'boolean') denied('INVALID_ARGUMENT');
        state.favorites = state.favorites.filter((id) => id !== a._id);
        if (p.favorite) state.favorites.push(a._id);
        return { audioId: a._id, favorite: p.favorite };
      }
      if (action === 'saveProgress') {
        if (
          typeof p.currentTime !== 'number' ||
          !Number.isFinite(p.currentTime) ||
          p.currentTime < 0 ||
          p.currentTime > a.duration
        )
          denied('INVALID_ARGUMENT');
        const old = state.progress.find((r) => r.audioId === a._id);
        const progress = {
          audioId: a._id,
          currentTime: p.currentTime,
          duration: a.duration,
          completed: p.currentTime / a.duration >= 0.95 || old?.completed === true,
          updatedAt: now,
        };
        state.progress = [...state.progress.filter((r) => r.audioId !== a._id), progress];
        return progress;
      }
    }
    if (domain === 'adminAudioApi') {
      if (user.role !== 'admin' || user.adminSchoolId !== SCHOOL) denied('FORBIDDEN');
      if (p.schoolId !== undefined && p.schoolId !== SCHOOL) denied('SCHOOL_SCOPE_DENIED');
      if (action === 'listManage')
        return page(
          state.audio
            .filter((a) => a.status !== 'deleted' && (!p.status || a.status === p.status))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map(publicAudio),
        );
      const a = state.audio.find((audio) => audio._id === p.audioId && audio.status !== 'deleted');
      if (action === 'detail') {
        if (!a) denied('AUDIO_NOT_FOUND');
        return {
          ...publicAudio(a),
          mediaUrl: MEDIA_PREFIX + a._id,
          mediaExpiresAt: new Date(this.port.now() + 600000).toISOString(),
        };
      }
      if (['publish', 'offline', 'delete'].includes(action)) {
        if (!a) denied('AUDIO_NOT_FOUND');
        if (action === 'offline' && a.status !== 'published' && a.status !== 'offline')
          denied('AUDIO_STATE_CONFLICT');
        a.status =
          action === 'publish' ? 'published' : action === 'offline' ? 'offline' : 'deleted';
        if (action === 'publish') a.publishedAt = now;
        a.updatedAt = now;
        return publicAudio(a);
      }
      if (action === 'createDraft' || action === 'updateDraft') {
        const localId = action === 'createDraft' ? `local-${readString(p.audioTicketId, 100)}` : '';
        const prior =
          action === 'createDraft'
            ? state.audio.find((record) => record._id === localId)
            : undefined;
        if (prior) {
          if (prior.status === 'deleted') denied('AUDIO_STATE_CONFLICT');
          return publicAudio(prior);
        }
        if (action === 'updateDraft' && (!a || a.status === 'published'))
          denied('AUDIO_STATE_CONFLICT');
        const visibility = readEnum(p.visibility, ['school', 'classes']);
        if (
          !Array.isArray(p.classIds) ||
          p.classIds.some((id) => !localClasses.some((c) => c._id === id)) ||
          (visibility === 'classes' && p.classIds.length === 0)
        )
          denied('INVALID_ARGUMENT');
        const title = readString(typeof p.title === 'string' ? p.title.trim() : '', 120);
        const speakerName = readString(
          typeof p.speakerName === 'string' ? p.speakerName.trim() : '',
          80,
        );
        const description =
          typeof p.description === 'string' && p.description.length <= 2000
            ? p.description
            : denied('INVALID_ARGUMENT');
        const duration = typeof p.localDuration === 'number' ? p.localDuration : a?.duration;
        if (!duration || !Number.isFinite(duration) || duration > 14400 || duration < 0.001)
          denied('INVALID_ARGUMENT');
        const localPath =
          typeof p.localPath === 'string' ? readString(p.localPath, 2048) : a?.localPath;
        if (!localPath) denied('UPLOAD_FAILED');
        const next: RecordAudio = {
          _id: a?._id ?? localId,
          schoolId: SCHOOL,
          title,
          speakerName,
          speakerTitle: typeof p.speakerTitle === 'string' ? p.speakerTitle.slice(0, 80) : '',
          description,
          visibility,
          classIds: visibility === 'school' ? [] : p.classIds.map((id) => String(id)),
          status: a?.status ?? 'draft',
          duration,
          fileSize: typeof p.localBytes === 'number' ? p.localBytes : (a?.fileSize ?? 1),
          mimeType: 'audio/mp4',
          createdAt: a?.createdAt ?? now,
          updatedAt: now,
          localPath,
          ...(a?.publishedAt ? { publishedAt: a.publishedAt } : {}),
          ...(typeof p.localCover === 'string'
            ? { coverPath: p.localCover }
            : a?.coverPath
              ? { coverPath: a.coverPath }
              : {}),
        };
        state.audio = [...state.audio.filter((r) => r._id !== next._id), next];
        return publicAudio(next);
      }
    }
    denied('NOT_IMPLEMENTED');
  }
}
