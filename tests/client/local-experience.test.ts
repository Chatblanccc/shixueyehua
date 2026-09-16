import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  LocalRepository,
  SAMPLE_PATH,
  SAMPLE_DURATION,
} from '../../miniprogram/services/local-repository';
import { createCloudClient } from '../../miniprogram/services/cloud-client';
import {
  parseAudioPage,
  parseAudioDetail,
  parseAudioProgress,
  parseFavoriteResult,
  parseLoginResult,
  parseCurrentClass,
  parseManagedAudio,
  parseManagedAudioPage,
} from '../../shared';
import {
  allowsLocalMode,
  localModeAvailable,
  localModeEnabled,
} from '../../miniprogram/services/local-mode';
function fixture() {
  let saved: unknown;
  const port = {
    now: () => Date.parse('2026-09-16T04:00:00.000Z'),
    read: () => structuredClone(saved),
    write: (v: unknown) => {
      saved = structuredClone(v);
    },
  };
  const repository = new LocalRepository(port);
  return { repository, port, call: createCloudClient((r) => repository.invoke(r)) };
}
const draft = {
  schoolId: 'demo-school',
  title: '新的校园夜话',
  speakerName: '测试主讲人',
  speakerTitle: '',
  description: '本地验收样例',
  visibility: 'classes',
  classIds: ['demo-class-1'],
  audioTicketId: 'local-ticket',
  localPath: SAMPLE_PATH,
  localDuration: SAMPLE_DURATION,
  localBytes: 196018,
};
afterEach(() => vi.unstubAllGlobals());
describe('无云本地体验与正式 DTO 共用', () => {
  it('test、prod 或配置云环境时一律不能启用本地体验', () => {
    for (const environment of ['test', 'prod'])
      expect(allowsLocalMode({ environment, cloudConfigured: false, envId: '' })).toBe(false);
    expect(allowsLocalMode({ environment: 'dev', cloudConfigured: true, envId: '' })).toBe(false);
    expect(allowsLocalMode({ environment: 'dev', cloudConfigured: false, envId: 'real-env' })).toBe(
      false,
    );
  });
  it('同一草稿创建重试幂等，存储损坏时不会覆盖已有体验数据', async () => {
    const f = fixture();
    f.repository.setRole('admin');
    const first = await f.call('adminAudioApi', 'createDraft', parseManagedAudio, draft);
    const second = await f.call('adminAudioApi', 'createDraft', parseManagedAudio, draft);
    expect(first._id).toBe(second._id);
    expect(
      (await f.call('adminAudioApi', 'listManage', parseManagedAudioPage, { status: 'draft' }))
        .items,
    ).toHaveLength(1);
    const write = vi.fn();
    const repo = new LocalRepository({ read: () => ({ version: 999 }), write, now: Date.now });
    const call = createCloudClient((r) => repo.invoke(r));
    await expect(call('authApi', 'login', parseLoginResult)).rejects.toBeDefined();
    expect(write).not.toHaveBeenCalled();
  });
  it('必须显式启用，不将缺失或非布尔配置当作开启', () => {
    expect(localModeAvailable()).toBe(true);
    for (const value of [undefined, false, 'true', 1]) {
      vi.stubGlobal('wx', { getStorageSync: () => value });
      expect(localModeEnabled()).toBe(false);
    }
    vi.stubGlobal('wx', { getStorageSync: () => true });
    expect(localModeEnabled()).toBe(true);
  });
  it('首次提供完整听众资料、学校班级和可解析节目，播放地址只映射内置媒体', async () => {
    const f = fixture();
    const login = await f.call('authApi', 'login', parseLoginResult);
    expect(login.onboardingStep).toBe('ready');
    expect(login.user.role).toBe('user');
    expect((await f.call('classApi', 'getCurrentClass', parseCurrentClass))?.class._id).toBe(
      'demo-class-1',
    );
    const list = await f.call('audioApi', 'list', parseAudioPage);
    expect(list.items).toHaveLength(3);
    const audio = await f.call('audioApi', 'detail', parseAudioDetail, {
      audioId: list.items[0]!._id,
      includeMedia: true,
    });
    expect(f.repository.media(audio.mediaUrl!)).toBe(SAMPLE_PATH);
    expect(() => f.repository.media('https://untrusted.test/a')).toThrow();
  });
  it('普通听众不能通过请求角色、学校或管理 action 提权', async () => {
    const f = fixture();
    await expect(
      f.call('adminAudioApi', 'createDraft', parseManagedAudio, draft),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      f.call('authApi', 'updateProfile', parseLoginResult, { identity: 'teacher', role: 'admin' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect((await f.call('authApi', 'login', parseLoginResult)).user.role).toBe('user');
  });
  it('收藏和播放进度在创建新 repository 后仍保留，重复收藏不重复', async () => {
    const f = fixture();
    const audioId = 'demo-audio-1';
    for (let i = 0; i < 3; i++)
      await f.call('audioApi', 'toggleFavorite', parseFavoriteResult, { audioId, favorite: true });
    await f.call('audioApi', 'saveProgress', parseAudioProgress, { audioId, currentTime: 10 });
    const call = createCloudClient((r) => new LocalRepository(f.port).invoke(r));
    expect((await call('audioApi', 'listFavorites', parseAudioPage)).items).toHaveLength(1);
    expect(
      (await call('audioApi', 'history', parseAudioPage)).items[0]?.progress?.currentTime,
    ).toBe(10);
    await expect(
      call('audioApi', 'saveProgress', parseAudioProgress, { audioId, currentTime: 10000 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
  it('管理员保存草稿、发布、班级隔离、下架和删除形成完整可操作流程', async () => {
    const f = fixture();
    f.repository.setRole('admin');
    const created = await f.call('adminAudioApi', 'createDraft', parseManagedAudio, draft);
    expect(
      (await f.call('audioApi', 'list', parseAudioPage)).items.some((a) => a._id === created._id),
    ).toBe(false);
    expect(
      (await f.call('adminAudioApi', 'listManage', parseManagedAudioPage, { status: 'draft' }))
        .items,
    ).toHaveLength(1);
    await f.call('adminAudioApi', 'publish', parseManagedAudio, { audioId: created._id });
    expect(
      (await f.call('audioApi', 'list', parseAudioPage)).items.some((a) => a._id === created._id),
    ).toBe(true);
    await f.call('classApi', 'selectClass', parseLoginResult, {
      schoolId: 'demo-school',
      gradeId: 'demo-grade',
      classId: 'demo-class-2',
    });
    expect(
      (await f.call('audioApi', 'list', parseAudioPage)).items.some((a) => a._id === created._id),
    ).toBe(false);
    expect((await f.call('authApi', 'getProfile', parseLoginResult)).user.adminSchoolId).toBe(
      'demo-school',
    );
    await f.call('adminAudioApi', 'offline', parseManagedAudio, { audioId: created._id });
    await expect(
      f.call('audioApi', 'detail', parseAudioDetail, { audioId: created._id }),
    ).rejects.toMatchObject({ code: 'AUDIO_NOT_FOUND' });
    await f.call('adminAudioApi', 'delete', parseManagedAudio, { audioId: created._id });
    expect((await f.call('adminAudioApi', 'listManage', parseManagedAudioPage)).items).toHaveLength(
      3,
    );
  });
  it('已发布内容不能直接编辑，撤回管理员后不能写入', async () => {
    const f = fixture();
    f.repository.setRole('admin');
    await expect(
      f.call('adminAudioApi', 'updateDraft', parseManagedAudio, {
        ...draft,
        audioId: 'demo-audio-1',
      }),
    ).rejects.toMatchObject({ code: 'AUDIO_STATE_CONFLICT' });
    f.repository.setRole('user');
    await expect(
      f.call('adminAudioApi', 'publish', parseManagedAudio, { audioId: 'demo-audio-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('本地存储写入失败不返回成功，也不把未完成家书接口冒充为成功', async () => {
    const f = fixture();
    await f.call('authApi', 'login', parseLoginResult);
    await expect(f.call('letterApi', 'listPublic', (v) => v)).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
    f.port.write = () => {
      throw new Error('quota exceeded');
    };
    await expect(
      f.call('audioApi', 'toggleFavorite', parseFavoriteResult, {
        audioId: 'demo-audio-1',
        favorite: true,
      }),
    ).rejects.toBeDefined();
    const call = createCloudClient((r) =>
      new LocalRepository({ ...f.port, write: () => undefined }).invoke(r),
    );
    expect((await call('audioApi', 'listFavorites', parseAudioPage)).items).toHaveLength(0);
  });
  it('重置仅恢复示例数据库，删除的节目不会再次被读取', async () => {
    const f = fixture();
    f.repository.setRole('admin');
    await f.call('adminAudioApi', 'delete', parseManagedAudio, { audioId: 'demo-audio-1' });
    expect(() => f.repository.media('https://local.shixue.invalid/demo-audio-1')).toThrow();
    f.repository.reset();
    expect((await f.call('audioApi', 'list', parseAudioPage)).items).toHaveLength(3);
    expect((await f.call('authApi', 'login', parseLoginResult)).user.role).toBe('user');
  });
});
