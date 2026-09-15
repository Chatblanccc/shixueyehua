import { describe, expect, it, vi } from 'vitest';
import { createHandler } from '../../cloudfunctions/_shared/handler';
import type { Domain } from '../../cloudfunctions/_shared/handler';
import { classroom, grade, MemoryRepository, NOW, school, user } from '../backend/fixtures';
import {
  parseClassPage,
  parseCurrentClass,
  parseGradePage,
  parseLoginResult,
  parseSchoolPage,
} from '../../shared';
import type { ClassSelectionInput, UpdateProfileInput } from '../../shared';
import { createCloudClient } from '../../miniprogram/services/cloud-client';
import { SessionController } from '../../miniprogram/services/session-controller';
import { ProfileController } from '../../miniprogram/services/profile-controller';
import { ClassSelectionController } from '../../miniprogram/services/class-selection-controller';
import { ClassSummaryController } from '../../miniprogram/services/class-summary.service';
import { AdminPageGuard } from '../../miniprogram/services/admin-guard';
import { createUserStore } from '../../miniprogram/stores/user.store';

/** Real client parsers/controllers and real handlers. Only persistence/WeChat transport are test ports. */
function harness(initial = new MemoryRepository()) {
  const handlers = new Map<Domain, ReturnType<typeof createHandler>>();
  for (const name of ['authApi', 'classApi', 'adminApi'] as const)
    handlers.set(
      name,
      createHandler(name, {
        repository: initial,
        getContext: () => ({ OPENID: 'test_trusted_openid', ENV: 'test_integration' }),
        getEnvironment: () => 'dev',
        logger: { write() {} },
        now: () => NOW,
      }),
    );
  const call = createCloudClient(async (request) => {
    const handler = handlers.get(request.name as Domain);
    if (!handler) throw new Error('Unknown test domain');
    const result = await handler(JSON.parse(JSON.stringify(request.data)) as unknown);
    return JSON.parse(JSON.stringify(result)) as unknown;
  });
  const store = createUserStore();
  const navigate = vi.fn().mockResolvedValue(undefined);
  const session = new SessionController(
    store,
    () => call('authApi', 'login', parseLoginResult),
    navigate,
  );
  const saveProfile = (payload: UpdateProfileInput) =>
    session.mutate(() => call('authApi', 'updateProfile', parseLoginResult, payload));
  const classes = () =>
    new ClassSelectionController({
      previewMode: false,
      getUser: () => store.user,
      ensureUser: () => session.ensureUser(),
      listSchools: (cursor) => call('classApi', 'listSchools', parseSchoolPage, { cursor }),
      listGrades: (schoolId, cursor) =>
        call('classApi', 'listGrades', parseGradePage, { schoolId, cursor }),
      listClasses: (schoolId, gradeId, cursor) =>
        call('classApi', 'listClasses', parseClassPage, { schoolId, gradeId, cursor }),
      getCurrentClass: () => call('classApi', 'getCurrentClass', parseCurrentClass),
      selectClass: (payload: ClassSelectionInput) =>
        session.mutate(() => call('classApi', 'selectClass', parseLoginResult, payload)),
    });
  return { repository: initial, call, store, session, navigate, saveProfile, classes };
}

describe('阶段2客户端到服务端完整本地流程', () => {
  it('新用户登录→身份与头像→三级选班→当前班级→切班，成员和日志一致', async () => {
    const h = harness();
    await h.session.start();
    expect(h.store.onboardingStep).toBe('identity');
    const profile = new ProfileController(
      {
        getUser: () => h.store.user,
        previewMode: false,
        ensureUser: () => h.session.ensureUser(),
        save: h.saveProfile,
      },
      new Map(),
    );
    await profile.load();
    profile.setIdentity('parent');
    profile.setNickname('');
    profile.setAvatarPreset('bamboo');
    expect(await profile.submit()).toBe(true);
    expect(h.store.user).toMatchObject({
      identity: 'parent',
      nickname: '夜话听友',
      avatarPreset: 'bamboo',
      role: 'user',
    });
    expect(h.store.onboardingStep).toBe('class');
    expect(h.store.user).not.toHaveProperty('openid');
    const select = h.classes();
    await select.load();
    await select.chooseSchool('test_school_a');
    await select.chooseGrade('test_grade_a');
    select.chooseClass('test_class_a');
    expect(await select.submit()).toBe(true);
    expect(h.store.isOnboarded).toBe(true);
    const summary = new ClassSummaryController(h.store, () =>
      h.call('classApi', 'getCurrentClass', parseCurrentClass),
    );
    await summary.refresh();
    expect(h.store.currentClass?.class.name).toBe('一班');
    h.repository.schools.set(
      'test_school_b',
      school({ _id: 'test_school_b', name: '第二测试学校' }),
    );
    h.repository.grades.set(
      'test_grade_b',
      grade({ _id: 'test_grade_b', schoolId: 'test_school_b' }),
    );
    h.repository.classes.set(
      'test_class_b',
      classroom({
        _id: 'test_class_b',
        schoolId: 'test_school_b',
        gradeId: 'test_grade_b',
        name: '二班',
      }),
    );
    const before = h.store.scopeRevision;
    const next = h.classes();
    await next.load();
    await next.chooseSchool('test_school_b');
    await next.chooseGrade('test_grade_b');
    next.chooseClass('test_class_b');
    expect(await next.submit()).toBe(true);
    expect(h.store.currentClass).toBeNull();
    expect(h.store.scopeRevision).toBe(before + 1);
    await summary.refresh();
    expect(h.store.currentClass).toMatchObject({
      school: { name: '第二测试学校' },
      class: { name: '二班' },
    });
    expect(h.repository.memberships.size).toBe(2);
    expect(h.repository.audits.filter((row) => row.action === 'class_switch')).toHaveLength(2);
    const again = await next.submit();
    expect(again).toBe(true);
    expect(h.repository.audits.filter((row) => row.action === 'class_switch')).toHaveLength(2);
    await h.saveProfile({ identity: 'teacher' });
    expect(
      [...h.repository.memberships.values()].find((row) => row.classId === 'test_class_b')
        ?.identity,
    ).toBe('teacher');
  });

  it('日志写入失败会回滚班级和成员，客户端仍处于选班步骤并能重试', async () => {
    const h = harness(new MemoryRepository([user({ identity: 'student' })]));
    await h.session.start();
    const select = h.classes();
    await select.load();
    await select.chooseSchool('test_school_a');
    await select.chooseGrade('test_grade_a');
    select.chooseClass('test_class_a');
    h.repository.failAudit = true;
    expect(await select.submit()).toBe(false);
    expect(h.store.onboardingStep).toBe('class');
    expect(h.repository.memberships.size).toBe(0);
    expect(h.repository.users.get('test_user')?.currentClassId).toBeUndefined();
    h.repository.failAudit = false;
    expect(await select.submit()).toBe(true);
    expect(h.store.isOnboarded).toBe(true);
  });

  it('绕过UI提交role被服务端拒绝；管理页操作期间被撤权后失败并退出', async () => {
    const repository = new MemoryRepository([
      user({
        identity: 'teacher',
        role: 'admin',
        adminSchoolId: 'test_school_a',
        currentSchoolId: 'test_school_a',
        currentGradeId: 'test_grade_a',
        currentClassId: 'test_class_a',
      }),
    ]);
    const h = harness(repository);
    await h.session.start();
    await expect(
      h.call('authApi', 'updateProfile', parseLoginResult, {
        identity: 'teacher',
        role: 'super_admin',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const clearPage = vi.fn();
    const commit = vi.fn();
    const guard = new AdminPageGuard({
      requireAdminSession: () => h.session.requireAdminSession(),
      recoverAdminSession: () => h.session.recoverAdminSession(),
      clearPage,
      allowPage: vi.fn(),
      showError: vi.fn(),
    });
    expect(await guard.requireAdminPage()).toBe(true);
    const result = await guard.wrapAdminAction(async () => {
      const current = repository.users.get('test_user');
      if (!current) throw new Error('Missing test user');
      repository.users.set(current._id, { ...current, role: 'user', adminSchoolId: undefined });
      return h.call('adminApi', 'setConfig', (value) => value, { schoolId: 'test_school_a' });
    }, commit);
    expect(result).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(clearPage).toHaveBeenLastCalledWith(false);
    expect(h.store.isAdmin).toBe(false);
    expect(h.navigate).toHaveBeenLastCalledWith('ready');
  });
});
