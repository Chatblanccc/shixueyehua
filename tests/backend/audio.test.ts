import { describe, expect, it, vi } from 'vitest';
import type {
  AudioProgram,
  AudioUploadTicket,
  ConfirmedAudioUpload,
  ManagedAudio,
} from '../../shared';
import {
  parseAudioDetail,
  parseAudioPage,
  parseAudioProgress,
  parseAudioUploadTicket,
  parseConfirmedAudioUpload,
  parseManagedAudio,
  parseManagedAudioPage,
} from '../../shared';
import { createHandler } from '../../cloudfunctions/_shared/handler';
import type { Domain } from '../../cloudfunctions/_shared/handler';
import type { AudioStoragePort } from '../../cloudfunctions/_shared/audio-storage-port';
import { relationId } from '../../cloudfunctions/_shared/audio-common';
import { MemoryRepository, NOW, classroom, school, user } from './fixtures';

const SCOPE = {
  identity: 'teacher' as const,
  currentSchoolId: 'test_school_a',
  currentGradeId: 'test_grade_a',
  currentClassId: 'test_class_a',
};
function audio(overrides: Partial<AudioProgram> = {}): AudioProgram {
  return {
    _id: 'audio_a',
    schoolId: SCOPE.currentSchoolId,
    classIds: [],
    title: '今夜读书',
    description: '学校的声音',
    speakerName: '老师',
    speakerTitle: '主讲人',
    coverFileId: '',
    audioFileId: 'cloud://test.bucket/audio-media/a.mp3',
    fileSize: 1000,
    duration: 100,
    visibility: 'school',
    status: 'published',
    createdBy: 'test_user',
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}
export class MemoryAudioStorage implements AudioStoragePort {
  readonly prepared: string[] = [];
  readonly deleted: string[][] = [];
  failSeal = false;
  failDelete = false;
  sealHook?: () => Promise<void>;
  temporaryUrl = vi.fn(
    async (fileId: string) =>
      `https://media.example.test/${encodeURIComponent(fileId)}?signed=private`,
  );
  async prepare(path: string, now: Date) {
    this.prepared.push(path);
    return {
      fileId: `cloud://test.bucket/${path}`,
      uploadUrl: `https://storage.example.test/${path}`,
      method: 'PUT' as const,
      headers: { Authorization: 'test-path-only-signature' },
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    };
  }
  async inspectAndSeal(input: Parameters<AudioStoragePort['inspectAndSeal']>[0]) {
    await this.sealHook?.();
    if (this.failSeal) throw new Error('Invalid real bytes');
    return {
      fileId: `cloud://test.bucket/${input.finalPath}`,
      fileSize: input.expectedBytes,
      mimeType: input.kind === 'audio' ? 'audio/mpeg' : 'image/png',
      ...(input.kind === 'audio' ? { duration: 100 } : {}),
    };
  }
  async deleteFiles(ids: string[]) {
    if (this.failDelete) throw new Error('Storage unavailable');
    this.deleted.push(ids);
  }
}
function setup(admin = false) {
  const repository = new MemoryRepository([
    user({ ...SCOPE, ...(admin ? { role: 'admin', adminSchoolId: SCOPE.currentSchoolId } : {}) }),
  ]);
  const storage = new MemoryAudioStorage();
  let current = NOW;
  const call = async (domain: Domain, action: string, payload: Record<string, unknown> = {}) =>
    createHandler(domain, {
      repository,
      audioStorage: storage,
      now: () => current,
      getContext: () => ({ OPENID: 'test_trusted_openid' }),
      getEnvironment: () => 'test',
      logger: { write: () => {} },
    })({ action, payload });
  const value = async <T>(
    domain: Domain,
    action: string,
    payload: Record<string, unknown>,
    parse: (data: unknown) => T,
  ): Promise<T> => {
    const result = await call(domain, action, payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) throw new Error(result.error.code);
    return parse(result.data);
  };
  const prepare = async (kind: 'audio' | 'cover' = 'audio'): Promise<AudioUploadTicket> =>
    value(
      'adminAudioApi',
      'prepareUpload',
      {
        schoolId: SCOPE.currentSchoolId,
        kind,
        fileName: kind === 'audio' ? '本地测试.mp3' : '封面.png',
        fileSize: 1000,
      },
      parseAudioUploadTicket,
    );
  const confirm = async (ticketId: string): Promise<ConfirmedAudioUpload> =>
    value('adminAudioApi', 'confirmUpload', { ticketId }, parseConfirmedAudioUpload);
  const draft = async (): Promise<ManagedAudio> => {
    const ticket = await prepare();
    await confirm(ticket.ticketId);
    return value(
      'adminAudioApi',
      'createDraft',
      {
        schoolId: SCOPE.currentSchoolId,
        audioTicketId: ticket.ticketId,
        title: '一段夜话',
        description: '',
        speakerName: '主讲老师',
        speakerTitle: '',
        visibility: 'school',
        classIds: [],
      },
      parseManagedAudio,
    );
  };
  return {
    repository,
    storage,
    call,
    value,
    prepare,
    confirm,
    draft,
    advance: (seconds: number) => {
      current = new Date(current.getTime() + seconds * 1000);
    },
  };
}

describe('TASK-300 visible audio and pagination', () => {
  it.each([
    { status: 'draft' as const },
    { status: 'offline' as const },
    { status: 'deleted' as const },
    { deletedAt: NOW },
    { schoolId: 'other' },
    { visibility: 'classes' as const, classIds: ['other_class'] },
  ])('excludes and refuses unavailable audio %j', async (override) => {
    const { repository, call, value, storage } = setup();
    repository.audios.set('audio_a', audio(override));
    expect((await value('audioApi', 'list', {}, parseAudioPage)).items).toEqual([]);
    expect(
      await call('audioApi', 'detail', { audioId: 'audio_a', includeMedia: true }),
    ).toMatchObject({ success: false, error: { code: 'AUDIO_NOT_FOUND' } });
    expect(storage.temporaryUrl).not.toHaveBeenCalled();
  });
  it('uses timestamp + ID pagination, a fixed snapshot and a trusted scope-bound cursor', async () => {
    const { repository, value, call, advance } = setup();
    for (const id of ['a', 'b', 'c']) repository.audios.set(id, audio({ _id: id }));
    const first = await value('audioApi', 'list', { pageSize: 2 }, parseAudioPage);
    expect(first.items.map((item) => item._id)).toEqual(['c', 'b']);
    expect(first.nextCursor).toBeTruthy();
    advance(10);
    repository.audios.set(
      'new',
      audio({ _id: 'new', publishedAt: new Date(NOW.getTime() + 10000) }),
    );
    expect(
      (
        await value('audioApi', 'list', { pageSize: 2, cursor: first.nextCursor }, parseAudioPage)
      ).items.map((item) => item._id),
    ).toEqual(['a']);
    repository.classes.set('other_class', classroom({ _id: 'other_class' }));
    repository.users.set('test_user', user({ ...SCOPE, currentClassId: 'other_class' }));
    expect(await call('audioApi', 'list', { cursor: first.nextCursor })).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
  });
  it('provides compact summaries and private URLs only on demand, plus visible adjacent audio', async () => {
    const { repository, value, storage } = setup();
    for (const id of ['a', 'b', 'c']) repository.audios.set(id, audio({ _id: id }));
    const summary = (await value('audioApi', 'list', {}, parseAudioPage)).items[0];
    expect(summary).not.toHaveProperty('audioFileId');
    expect(summary).not.toHaveProperty('description');
    const plain = await value('audioApi', 'detail', { audioId: 'b' }, parseAudioDetail);
    expect(plain).toMatchObject({ previousAudioId: 'c', nextAudioId: 'a' });
    expect(plain.mediaUrl).toBeUndefined();
    expect(storage.temporaryUrl).not.toHaveBeenCalled();
    expect(
      await value('audioApi', 'detail', { audioId: 'b', includeMedia: true }, parseAudioDetail),
    ).toMatchObject({
      mediaUrl: expect.stringContaining('https://'),
      mediaExpiresAt: new Date(NOW.getTime() + 600000).toISOString(),
    });
  });
  it('allows disabled read-only accounts but refuses writes, deleted accounts, or an invalid selected class', async () => {
    const { repository, call } = setup();
    repository.audios.set('audio_a', audio());
    repository.users.set('test_user', user({ ...SCOPE, status: 'disabled' }));
    expect(await call('audioApi', 'list')).toMatchObject({ success: true });
    expect(
      await call('audioApi', 'saveProgress', { audioId: 'audio_a', currentTime: 10 }),
    ).toMatchObject({ success: false, error: { code: 'USER_DISABLED' } });
    repository.users.set('test_user', user({ ...SCOPE, status: 'deleted' }));
    expect(await call('audioApi', 'detail', { audioId: 'audio_a' })).toMatchObject({
      success: false,
      error: { code: 'USER_DELETED' },
    });
    repository.users.set('test_user', user({ ...SCOPE }));
    repository.classes.set('test_class_a', classroom({ status: 'graduated' }));
    expect(await call('audioApi', 'list')).toMatchObject({
      success: false,
      error: { code: 'CLASS_NOT_AVAILABLE' },
    });
  });
  it.each([
    { schoolId: 'evil' },
    { classId: 'evil' },
    { role: 'admin' },
    { cursor: 'invalid' },
    { pageSize: 101 },
  ])('rejects forged query fields %j', async (payload) => {
    expect(await setup().call('audioApi', 'list', payload)).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
  });
});

describe('TASK-303 progress, history and favorites', () => {
  it('validates trusted duration, throttles changes, allows identical retries, and retains completion', async () => {
    const { repository, value, call, advance } = setup();
    repository.audios.set('audio_a', audio());
    expect(
      await value(
        'audioApi',
        'saveProgress',
        { audioId: 'audio_a', currentTime: 95 },
        parseAudioProgress,
      ),
    ).toMatchObject({ completed: true, duration: 100 });
    expect(
      await call('audioApi', 'saveProgress', { audioId: 'audio_a', currentTime: 95 }),
    ).toMatchObject({ success: true });
    expect(
      await call('audioApi', 'saveProgress', { audioId: 'audio_a', currentTime: 96 }),
    ).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
    advance(5);
    expect(
      await value(
        'audioApi',
        'saveProgress',
        { audioId: 'audio_a', currentTime: 10 },
        parseAudioProgress,
      ),
    ).toMatchObject({ currentTime: 10, completed: true });
    for (const payload of [
      { currentTime: -1 },
      { currentTime: 101 },
      { currentTime: NaN },
      { currentTime: 90, duration: 999 },
    ])
      expect(
        await call('audioApi', 'saveProgress', { audioId: 'audio_a', ...payload }),
      ).toMatchObject({ success: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(repository.progresses.size).toBe(1);
  });
  it('makes concurrent desired-state favorites unique and removes offline records from history and collections', async () => {
    const { repository, call, value } = setup();
    repository.audios.set('audio_a', audio());
    expect(
      (
        await Promise.all([
          call('audioApi', 'toggleFavorite', { audioId: 'audio_a', favorite: true }),
          call('audioApi', 'toggleFavorite', { audioId: 'audio_a', favorite: true }),
        ])
      ).every((result) => result.success),
    ).toBe(true);
    await call('audioApi', 'saveProgress', { audioId: 'audio_a', currentTime: 30 });
    expect(repository.favorites.size).toBe(1);
    const item = (await value('audioApi', 'listFavorites', {}, parseAudioPage)).items[0];
    expect(item).toMatchObject({ favorite: true, progress: { currentTime: 30 } });
    repository.audios.set('audio_a', audio({ status: 'offline' }));
    expect((await value('audioApi', 'history', {}, parseAudioPage)).items).toEqual([]);
    expect((await value('audioApi', 'listFavorites', {}, parseAudioPage)).items).toEqual([]);
    expect(repository.progresses.size).toBe(1);
    expect(repository.favorites.size).toBe(1);
  });
  it('supports idempotent removal and restoring a soft-deleted favorite', async () => {
    const { repository, call } = setup();
    repository.audios.set('audio_a', audio());
    for (const favorite of [false, true, true, false, false])
      expect(
        await call('audioApi', 'toggleFavorite', { audioId: 'audio_a', favorite }),
      ).toMatchObject({ success: true, data: { favorite } });
    expect(repository.favorites.get(relationId('test_user', 'audio_a'))?.deletedAt).toEqual(NOW);
    expect(await call('audioApi', 'toggleFavorite', { audioId: 'audio_a' })).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
  });
  it('re-reads status and visibility inside the transaction', async () => {
    const { repository, call } = setup();
    repository.audios.set('audio_a', audio());
    repository.beforeTransaction = () =>
      repository.users.set('test_user', user({ ...SCOPE, status: 'disabled' }));
    expect(
      await call('audioApi', 'saveProgress', { audioId: 'audio_a', currentTime: 5 }),
    ).toMatchObject({ success: false, error: { code: 'USER_DISABLED' } });
    expect(repository.progresses.size).toBe(0);
  });
});

describe('TASK-304/305 upload ownership, atomic binding and publication', () => {
  it('runs real handlers through prepare/confirm/draft/publish/read/offline/delete with audit and cleanup', async () => {
    const { repository, call, value, draft, storage, advance } = setup(true);
    const saved = await draft();
    expect(saved.status).toBe('draft');
    expect((await value('audioApi', 'list', {}, parseAudioPage)).items).toEqual([]);
    expect(
      (
        await value(
          'adminAudioApi',
          'listManage',
          { schoolId: SCOPE.currentSchoolId, status: 'draft' },
          parseManagedAudioPage,
        )
      ).items,
    ).toHaveLength(1);
    expect(
      await value('adminAudioApi', 'publish', { audioId: saved._id }, parseManagedAudio),
    ).toMatchObject({ status: 'published' });
    expect((await value('audioApi', 'list', {}, parseAudioPage)).items).toHaveLength(1);
    expect(
      await call('adminAudioApi', 'updateDraft', {
        audioId: saved._id,
        title: 'changed',
        description: '',
        speakerName: 'name',
        speakerTitle: '',
        visibility: 'school',
        classIds: [],
      }),
    ).toMatchObject({ success: false, error: { code: 'AUDIO_STATE_CONFLICT' } });
    await call('adminAudioApi', 'offline', { audioId: saved._id });
    expect(
      await call('audioApi', 'detail', { audioId: saved._id, includeMedia: true }),
    ).toMatchObject({ success: false, error: { code: 'AUDIO_NOT_FOUND' } });
    await call('adminAudioApi', 'delete', { audioId: saved._id });
    expect(repository.audios.get(saved._id)?.deletedAt).toEqual(NOW);
    advance(40 * 60);
    expect(
      await call('adminAudioApi', 'cleanupUploads', { schoolId: SCOPE.currentSchoolId }),
    ).toMatchObject({ success: true, data: { cleaned: 1, failed: 0 } });
    expect(storage.deleted[0]).toHaveLength(2);
    expect(repository.audits.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        'audio_upload_prepare',
        'audio_upload_confirm',
        'audio_upload_bind',
        'audio_create',
        'audio_publish',
        'audio_offline',
        'audio_delete',
        'audio_upload_cleanup',
      ]),
    );
    expect(JSON.stringify(repository.audits)).not.toContain('test-path-only-signature');
  });
  it('prevents forged privileged writes and cross-school resource management despite self-selected class', async () => {
    const normal = setup();
    expect(
      await normal.call('adminAudioApi', 'prepareUpload', {
        schoolId: SCOPE.currentSchoolId,
        kind: 'audio',
        fileName: 'x.mp3',
        fileSize: 1,
      }),
    ).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
    const { repository, call, draft } = setup(true);
    const saved = await draft();
    repository.audios.set(saved._id, {
      ...repository.audios.get(saved._id)!,
      schoolId: 'other_school',
    });
    repository.schools.set('other_school', school({ _id: 'other_school' }));
    expect(await call('adminAudioApi', 'publish', { audioId: saved._id })).toMatchObject({
      success: false,
      error: { code: 'SCHOOL_SCOPE_DENIED' },
    });
  });
  it('binds a random server path and refuses wrong owner/kind and arbitrary file IDs', async () => {
    const { repository, prepare, confirm, call, storage } = setup(true);
    const ticket = await prepare();
    await confirm(ticket.ticketId);
    expect(storage.prepared[0]).toMatch(
      /^audio-quarantine\/test_school_a\/2026\/[0-9a-f-]{36}\.mp3$/,
    );
    expect(storage.prepared[0]).not.toContain('本地测试');
    const body = {
      schoolId: SCOPE.currentSchoolId,
      title: '一段夜话',
      description: '',
      speakerName: '老师',
      speakerTitle: '',
      visibility: 'school',
      classIds: [],
      audioTicketId: ticket.ticketId,
    };
    expect(
      await call('adminAudioApi', 'createDraft', { ...body, audioFileId: 'cloud://forged/file' }),
    ).toMatchObject({ success: false, error: { code: 'INVALID_ARGUMENT' } });
    const upload = repository.uploads.get(ticket.ticketId)!;
    repository.uploads.set(ticket.ticketId, { ...upload, userId: 'other_user' });
    expect(await call('adminAudioApi', 'createDraft', body)).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
    repository.uploads.set(ticket.ticketId, { ...upload, kind: 'cover' });
    expect(await call('adminAudioApi', 'createDraft', body)).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });
  it('rolls back binding and record creation when audit fails, then safely retries the same draft', async () => {
    const { repository, prepare, confirm, call } = setup(true);
    const ticket = await prepare();
    await confirm(ticket.ticketId);
    const body = {
      schoolId: SCOPE.currentSchoolId,
      title: '测试',
      description: '',
      speakerName: '老师',
      speakerTitle: '',
      visibility: 'school',
      classIds: [],
      audioTicketId: ticket.ticketId,
    };
    repository.failAudit = true;
    expect(await call('adminAudioApi', 'createDraft', body)).toMatchObject({ success: false });
    expect(repository.audios.size).toBe(0);
    expect(repository.uploads.get(ticket.ticketId)?.status).toBe('confirmed');
    repository.failAudit = false;
    expect(await call('adminAudioApi', 'createDraft', body)).toMatchObject({ success: true });
    expect(await call('adminAudioApi', 'createDraft', body)).toMatchObject({ success: true });
    expect(repository.audios.size).toBe(1);
  });
  it('has a transactional three-ticket quota and rejects expired, cancelled and invalid-size uploads', async () => {
    const { prepare, call, advance } = setup(true);
    const tickets = await Promise.all([prepare(), prepare(), prepare()]);
    expect(
      await call('adminAudioApi', 'prepareUpload', {
        schoolId: SCOPE.currentSchoolId,
        kind: 'audio',
        fileName: 'x.mp3',
        fileSize: 1000,
      }),
    ).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
    await call('adminAudioApi', 'cancelUpload', { ticketId: tickets[0]!.ticketId });
    expect(
      await call('adminAudioApi', 'confirmUpload', { ticketId: tickets[0]!.ticketId }),
    ).toMatchObject({ success: false, error: { code: 'UPLOAD_EXPIRED' } });
    advance(21 * 60);
    expect(
      await call('adminAudioApi', 'confirmUpload', { ticketId: tickets[1]!.ticketId }),
    ).toMatchObject({ success: false, error: { code: 'UPLOAD_EXPIRED' } });
    for (const fileSize of [0, 0.1, 50 * 1024 * 1024 + 1])
      expect(
        await call('adminAudioApi', 'prepareUpload', {
          schoolId: SCOPE.currentSchoolId,
          kind: 'audio',
          fileName: 'x.mp3',
          fileSize,
        }),
      ).toMatchObject({ success: false, error: { code: 'INVALID_ARGUMENT' } });
  });
  it('makes validation exclusive and never retries an immutable seal after failure', async () => {
    const { prepare, call, storage, repository } = setup(true);
    const ticket = await prepare();
    let release = () => {};
    let entered = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    storage.sealHook = async () => {
      entered();
      await gate;
    };
    const first = call('adminAudioApi', 'confirmUpload', { ticketId: ticket.ticketId });
    await started;
    expect(
      await call('adminAudioApi', 'confirmUpload', { ticketId: ticket.ticketId }),
    ).toMatchObject({ success: false, error: { code: 'DUPLICATE_REQUEST' } });
    storage.failSeal = true;
    release();
    expect(await first).toMatchObject({ success: false });
    expect(repository.uploads.get(ticket.ticketId)?.status).toBe('cancelled');
    expect(
      await call('adminAudioApi', 'confirmUpload', { ticketId: ticket.ticketId }),
    ).toMatchObject({ success: false, error: { code: 'UPLOAD_EXPIRED' } });
  });
  it('refuses publication if a target class became inactive or privileges were revoked in the transaction', async () => {
    const { repository, draft, call } = setup(true);
    const saved = await draft();
    repository.audios.set(saved._id, {
      ...repository.audios.get(saved._id)!,
      visibility: 'classes',
      classIds: ['test_class_a'],
    });
    repository.classes.set('test_class_a', classroom({ status: 'disabled' }));
    expect(await call('adminAudioApi', 'publish', { audioId: saved._id })).toMatchObject({
      success: false,
      error: { code: 'CLASS_NOT_AVAILABLE' },
    });
    repository.beforeTransaction = () => repository.users.set('test_user', user({ ...SCOPE }));
    expect(await call('adminAudioApi', 'publish', { audioId: saved._id })).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });
  it('cleans only quarantine for a bound draft, waits for signature expiry, and retries failed deletion', async () => {
    const { draft, call, storage, advance, repository } = setup(true);
    const saved = await draft();
    expect(
      await call('adminAudioApi', 'cleanupUploads', { schoolId: SCOPE.currentSchoolId }),
    ).toMatchObject({ success: true, data: { cleaned: 0 } });
    advance(40 * 60);
    storage.failDelete = true;
    expect(
      await call('adminAudioApi', 'cleanupUploads', { schoolId: SCOPE.currentSchoolId }),
    ).toMatchObject({ success: true, data: { cleaned: 0, failed: 1 } });
    storage.failDelete = false;
    expect(
      await call('adminAudioApi', 'cleanupUploads', { schoolId: SCOPE.currentSchoolId }),
    ).toMatchObject({ success: true, data: { cleaned: 1, failed: 0 } });
    expect(storage.deleted[0]).toHaveLength(1);
    expect(storage.deleted[0]![0]).toContain('audio-quarantine/');
    expect(repository.audios.get(saved._id)?.status).toBe('draft');
    expect(
      await call('adminAudioApi', 'cleanupUploads', { schoolId: SCOPE.currentSchoolId }),
    ).toMatchObject({ success: true, data: { cleaned: 0 } });
  });
});
