import { describe, expect, it, vi } from 'vitest';
import type { ClassOption, CurrentClass, CursorPage, GradeOption, UserProfile } from '../../shared';
import { ProfileController } from '../../miniprogram/services/profile-controller';
import type { ProfileSnapshot } from '../../miniprogram/services/profile-controller';
import { ClassSelectionController } from '../../miniprogram/services/class-selection-controller';
import type {
  ClassSelectionPort,
  ClassSelectionSnapshot,
} from '../../miniprogram/services/class-selection-controller';
import { CloudClientError } from '../../miniprogram/services/cloud-client';

const profile: UserProfile = {
  _id: 'test_user',
  nickname: '听友',
  role: 'user',
  status: 'active',
  identity: 'student',
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
};
const schools = [
  { _id: 'school_a', name: '测试甲校' },
  { _id: 'school_b', name: '测试乙校' },
];
const grade = (schoolId: string): GradeOption => ({
  _id: `grade_${schoolId}`,
  name: '七年级',
  schoolId,
});
const klass = (schoolId: string): ClassOption => ({
  _id: `class_${schoolId}`,
  name: '一班',
  schoolId,
  gradeId: grade(schoolId)._id,
  joinMode: 'free',
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function classPort(overrides: Partial<ClassSelectionPort> = {}): ClassSelectionPort {
  return {
    previewMode: false,
    getUser: () => profile,
    ensureUser: async () => true,
    listSchools: async () => ({ items: schools }),
    listGrades: async (schoolId) => ({ items: [grade(schoolId)] }),
    listClasses: async (schoolId) => ({ items: [klass(schoolId)] }),
    getCurrentClass: async (): Promise<CurrentClass | null> => null,
    selectClass: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('身份资料表单', () => {
  it('未选身份不能提交，空昵称按白名单提交且重复点击只保存一次', async () => {
    const pending = deferred<void>();
    const save = vi.fn(() => pending.promise);
    const editor = new ProfileController(
      {
        getUser: () => ({ ...profile, identity: undefined }),
        previewMode: false,
        ensureUser: async () => true,
        save,
      },
      new Map(),
    );
    let state!: ProfileSnapshot;
    editor.subscribe((value) => {
      state = value;
    });
    await editor.load();
    expect(await editor.submit()).toBe(false);
    expect(save).not.toHaveBeenCalled();
    editor.setIdentity('parent');
    editor.setNickname('   ');
    editor.setAvatarPreset('book');
    const first = editor.submit();
    expect(await editor.submit()).toBe(false);
    expect(state.saving).toBe(true);
    expect(save).toHaveBeenCalledWith({ identity: 'parent', nickname: '', avatarPreset: 'book' });
    pending.resolve();
    expect(await first).toBe(true);
    expect(state.saving).toBe(false);
  });
  it('返回资料页保留未保存草稿，其他账号不读取原账号草稿', async () => {
    const drafts = new Map();
    const ports = {
      getUser: () => profile,
      previewMode: false,
      ensureUser: async () => true,
      save: vi.fn(),
    };
    const original = new ProfileController(ports, drafts);
    await original.load();
    original.setNickname('尚未提交');
    original.setIdentity('teacher');
    original.dispose();
    const back = new ProfileController(ports, drafts);
    let state!: ProfileSnapshot;
    back.subscribe((value) => {
      state = value;
    });
    await back.load();
    expect(state.nickname).toBe('尚未提交');
    expect(state.identity).toBe('teacher');
    const other = new ProfileController(
      { ...ports, getUser: () => ({ ...profile, _id: 'another' }) },
      drafts,
    );
    other.subscribe((value) => {
      state = value;
    });
    await other.load();
    expect(state.nickname).toBe('听友');
  });
  it('无云预览可填写但不保存账号，失败仍保留输入', async () => {
    const save = vi.fn().mockRejectedValue(new CloudClientError('TIMEOUT', 'test'));
    const preview = new ProfileController(
      { getUser: () => null, previewMode: true, ensureUser: vi.fn(), save },
      new Map(),
    );
    await preview.load();
    preview.setIdentity('student');
    expect(await preview.submit()).toBe(false);
    expect(save).not.toHaveBeenCalled();
    const real = new ProfileController(
      { getUser: () => profile, previewMode: false, ensureUser: async () => true, save },
      new Map(),
    );
    let state!: ProfileSnapshot;
    real.subscribe((value) => {
      state = value;
    });
    await real.load();
    real.setNickname('保存失败也保留');
    expect(await real.submit()).toBe(false);
    expect(state.nickname).toBe('保存失败也保留');
    expect(state.errorMessage).toContain('超时');
  });
  it('账号切换或页面销毁后不能误报保存成功', async () => {
    let current = profile;
    const pending = deferred<void>();
    const save = vi.fn(() => pending.promise);
    const editor = new ProfileController(
      { getUser: () => current, previewMode: false, ensureUser: async () => true, save },
      new Map(),
    );
    await editor.load();
    current = { ...profile, _id: 'another' };
    expect(await editor.submit()).toBe(false);
    expect(save).not.toHaveBeenCalled();
    current = profile;
    const sending = editor.submit();
    editor.dispose();
    pending.resolve();
    expect(await sending).toBe(false);
  });
});

describe('三级班级选择', () => {
  it('真实选择逐级加载，只提交三个ID且防止重复保存', async () => {
    const pending = deferred<void>();
    const selectClass = vi.fn(() => pending.promise);
    const controller = new ClassSelectionController(classPort({ selectClass }));
    await controller.load();
    expect(await controller.submit()).toBe(false);
    await controller.chooseSchool('school_a');
    await controller.chooseGrade(grade('school_a')._id);
    controller.chooseClass(klass('school_a')._id);
    const sending = controller.submit();
    expect(await controller.submit()).toBe(false);
    expect(selectClass).toHaveBeenCalledWith({
      schoolId: 'school_a',
      gradeId: grade('school_a')._id,
      classId: klass('school_a')._id,
    });
    pending.resolve();
    expect(await sending).toBe(true);
  });
  it('切换学校立即清空下级，迟到的旧学校结果不能覆盖新结果', async () => {
    const old = deferred<CursorPage<GradeOption>>();
    const controller = new ClassSelectionController(
      classPort({
        listGrades: async (id) => (id === 'school_a' ? old.promise : { items: [grade(id)] }),
      }),
    );
    let state!: ClassSelectionSnapshot;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.load();
    const first = controller.chooseSchool('school_a');
    await controller.chooseSchool('school_b');
    expect(state.selectedGrade).toBeNull();
    expect(state.selectedClass).toBeNull();
    old.resolve({ items: [grade('school_a')] });
    await first;
    expect(state.grades.items).toEqual([grade('school_b')]);
    expect(state.grades.loading).toBe(false);
  });
  it('班级分页追加去重，失败重试保留已有选项', async () => {
    const listSchools = vi
      .fn()
      .mockResolvedValueOnce({ items: [schools[0]], nextCursor: 'school_a' })
      .mockRejectedValueOnce(new CloudClientError('NETWORK_ERROR', 'test'))
      .mockResolvedValueOnce({ items: schools });
    const controller = new ClassSelectionController(classPort({ listSchools }));
    let state!: ClassSelectionSnapshot;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.load();
    await controller.loadMore('schools');
    expect(state.schools.items).toEqual([schools[0]]);
    expect(state.schools.errorMessage).toBeTruthy();
    await controller.retry('schools');
    expect(state.schools.items).toEqual(schools);
    expect(state.schools.hasMore).toBe(false);
  });
  it('错误父级、重复游标、未开放的入班方式不成为可选数据', async () => {
    const controller = new ClassSelectionController(
      classPort({ listGrades: async () => ({ items: [grade('school_b')] }) }),
    );
    let state!: ClassSelectionSnapshot;
    controller.subscribe((value) => {
      state = value;
    });
    await controller.load();
    await controller.chooseSchool('school_a');
    expect(state.grades.items).toEqual([]);
    expect(state.grades.errorMessage).toBeTruthy();
    const loop = new ClassSelectionController(
      classPort({ listSchools: async () => ({ items: schools, nextCursor: 'repeat' }) }),
    );
    loop.subscribe((value) => {
      state = value;
    });
    await loop.load();
    await loop.loadMore('schools');
    expect(state.schools.errorMessage).toBeTruthy();
  });
  it('无云模式不请求目录或提交；卸载后迟到响应不通知页面', async () => {
    const listSchools = vi.fn().mockResolvedValue({ items: schools });
    const selectClass = vi.fn();
    const preview = new ClassSelectionController(
      classPort({ previewMode: true, listSchools, selectClass }),
    );
    await preview.load();
    expect(await preview.submit()).toBe(false);
    expect(listSchools).not.toHaveBeenCalled();
    expect(selectClass).not.toHaveBeenCalled();
    const pending = deferred<CursorPage<(typeof schools)[number]>>();
    const controller = new ClassSelectionController(
      classPort({ listSchools: () => pending.promise }),
    );
    const observe = vi.fn();
    controller.subscribe(observe);
    const loading = controller.load();
    await Promise.resolve();
    controller.dispose();
    const count = observe.mock.calls.length;
    pending.resolve({ items: schools });
    await loading;
    expect(observe).toHaveBeenCalledTimes(count);
  });
});
