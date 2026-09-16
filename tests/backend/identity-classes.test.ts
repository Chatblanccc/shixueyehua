import { describe, expect, it } from 'vitest';
import {
  parseClassPage,
  parseCurrentClass,
  parseGradePage,
  parseLoginResult,
  parseSchoolPage,
} from '../../shared';
import { createHandler } from '../../cloudfunctions/_shared/handler';
import type { Domain } from '../../cloudfunctions/_shared/handler';
import { membershipId } from '../../cloudfunctions/classApi/classes';
import { classroom, grade, MemoryRepository, NOW, school, user } from './fixtures';

const selection = { schoolId: 'test_school_a', gradeId: 'test_grade_a', classId: 'test_class_a' };
function setup(initial = user({ identity: 'parent' })) {
  const repository = new MemoryRepository([initial]);
  const call = (domain: Domain, action: string, payload: Record<string, unknown> = {}) =>
    createHandler(domain, {
      repository,
      getContext: () => ({ OPENID: initial.openid }),
      getEnvironment: () => 'test',
      logger: { write: () => {} },
      now: () => NOW,
    })({ action, payload });
  return { repository, call };
}
function secondClass(repository: MemoryRepository) {
  repository.schools.set('test_school_b', school({ _id: 'test_school_b' }));
  repository.grades.set('test_grade_b', grade({ _id: 'test_grade_b', schoolId: 'test_school_b' }));
  repository.classes.set(
    'test_class_b',
    classroom({ _id: 'test_class_b', schoolId: 'test_school_b', gradeId: 'test_grade_b' }),
  );
  return { schoolId: 'test_school_b', gradeId: 'test_grade_b', classId: 'test_class_b' };
}

describe('TASK-200 profile mutation', () => {
  it('stores identity, trimmed/default nickname and built-in avatar, returning a public LoginResult', async () => {
    const { repository, call } = setup(user({ avatarFileId: 'cloud://existing-avatar' }));
    const result = await call('authApi', 'updateProfile', {
      identity: 'teacher',
      nickname: '   ',
      avatarPreset: 'bamboo',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const parsed = parseLoginResult(result.data);
    expect(parsed.onboardingStep).toBe('class');
    expect(parsed.user).toMatchObject({
      identity: 'teacher',
      nickname: '夜话听友',
      avatarPreset: 'bamboo',
      avatarFileId: 'cloud://existing-avatar',
      role: 'user',
    });
    expect(parsed.user).not.toHaveProperty('openid');
    expect(repository.audits).toHaveLength(1);
    expect(repository.audits[0]?.action).toBe('profile_update');
    expect(JSON.stringify(repository.audits[0])).not.toContain('夜话听友');
  });
  it.each([
    'role',
    'status',
    'schoolId',
    'adminSchoolId',
    'currentSchoolId',
    'currentGradeId',
    'currentClassId',
    'openid',
    'avatarFileId',
    'deletedAt',
  ])('rejects additional client field %s without changing records', async (field) => {
    const { repository, call } = setup();
    const response = await call('authApi', 'updateProfile', {
      identity: 'teacher',
      [field]: 'admin',
    });
    expect(response).toMatchObject({ success: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(repository.users.get('test_user')).toEqual(user({ identity: 'parent' }));
    expect(repository.audits).toHaveLength(0);
  });
  it.each([
    {},
    { identity: 'admin' },
    { identity: null },
    { identity: 'parent', nickname: 23 },
    { identity: 'parent', nickname: 'a'.repeat(81) },
    { identity: 'parent', nickname: 'text\u0000' },
    { identity: 'parent', avatarPreset: 'https://external' },
  ])('rejects invalid profile %j', async (payload) => {
    expect(await setup().call('authApi', 'updateProfile', payload)).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
  });
  it('patches only chosen profile fields and retains role, scope, class and prior optional fields', async () => {
    const initial = user({
      identity: 'parent',
      role: 'admin',
      adminSchoolId: 'test_school_a',
      currentSchoolId: 'test_school_b',
      currentGradeId: 'test_grade_b',
      currentClassId: 'test_class_b',
      avatarPreset: 'moon',
    });
    const { repository, call } = setup(initial);
    await call('authApi', 'updateProfile', { identity: 'teacher', nickname: '  新听友  ' });
    expect(repository.users.get(initial._id)).toEqual({
      ...initial,
      identity: 'teacher',
      nickname: '新听友',
    });
  });
  it('synchronizes current membership identity atomically while preserving historical class identity', async () => {
    const { repository, call } = setup();
    const second = secondClass(repository);
    await call('classApi', 'selectClass', selection);
    await call('classApi', 'selectClass', second);
    expect((await call('authApi', 'updateProfile', { identity: 'teacher' })).success).toBe(true);
    expect(repository.memberships.get(membershipId('test_user', second.classId))?.identity).toBe(
      'teacher',
    );
    expect(repository.memberships.get(membershipId('test_user', selection.classId))?.identity).toBe(
      'parent',
    );
    repository.failAudit = true;
    expect(await call('authApi', 'updateProfile', { identity: 'student' })).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(repository.users.get('test_user')?.identity).toBe('teacher');
    expect(repository.memberships.get(membershipId('test_user', second.classId))?.identity).toBe(
      'teacher',
    );
  });
  it('does not invent a membership or rewrite a historical member for an invalid current class', async () => {
    const { repository, call } = setup(
      user({
        identity: 'parent',
        currentSchoolId: selection.schoolId,
        currentGradeId: selection.gradeId,
        currentClassId: selection.classId,
      }),
    );
    await call('authApi', 'updateProfile', { identity: 'teacher' });
    expect(repository.memberships.size).toBe(0);
    await call('classApi', 'selectClass', selection);
    repository.classes.set(selection.classId, classroom({ status: 'graduated' }));
    await call('authApi', 'updateProfile', { identity: 'student' });
    expect(repository.memberships.get(membershipId('test_user', selection.classId))?.identity).toBe(
      'teacher',
    );
  });
  it('does not write redundant logs when profile values are unchanged', async () => {
    const { repository, call } = setup();
    await call('authApi', 'updateProfile', { identity: 'parent' });
    expect(repository.audits).toHaveLength(0);
  });
  it('rolls profile change back when the audit fails', async () => {
    const { repository, call } = setup();
    repository.failAudit = true;
    expect(
      await call('authApi', 'updateProfile', { identity: 'teacher', nickname: 'hidden text' }),
    ).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR' } });
    expect(repository.users.get('test_user')).toEqual(user({ identity: 'parent' }));
    expect(repository.audits).toHaveLength(0);
  });
});

describe('TASK-201 directory and class transactions', () => {
  it('returns minimal active/free DTOs with ID-ordered pages and no hidden fields', async () => {
    const { repository, call } = setup();
    repository.schools.set(
      'test_school_b',
      school({ _id: 'test_school_b', logoFileId: 'private' }),
    );
    repository.schools.set('test_school_c', school({ _id: 'test_school_c', status: 'disabled' }));
    repository.schools.set('test_school_d', school({ _id: 'test_school_d', deletedAt: NOW }));
    repository.classes.set(
      'test_code_class',
      classroom({ _id: 'test_code_class', joinMode: 'code' }),
    );
    repository.classes.set(
      'test_approval_class',
      classroom({ _id: 'test_approval_class', joinMode: 'approval' }),
    );
    repository.classes.set(
      'test_graduated_class',
      classroom({ _id: 'test_graduated_class', status: 'graduated' }),
    );
    const first = await call('classApi', 'listSchools', { pageSize: 1 });
    expect(first.success).toBe(true);
    if (!first.success) return;
    const firstPage = parseSchoolPage(first.data);
    expect(firstPage.items).toEqual([{ _id: 'test_school_a', name: '测试学校' }]);
    expect(firstPage.nextCursor).toBeDefined();
    const second = await call('classApi', 'listSchools', {
      pageSize: 1,
      cursor: firstPage.nextCursor,
    });
    if (!second.success) throw Error('page failed');
    expect(parseSchoolPage(second.data)).toEqual({
      items: [{ _id: 'test_school_b', name: '测试学校' }],
    });
    const grades = await call('classApi', 'listGrades', { schoolId: selection.schoolId });
    if (!grades.success) throw Error('grade failed');
    expect(parseGradePage(grades.data)).toEqual({
      items: [{ _id: 'test_grade_a', schoolId: 'test_school_a', name: '七年级' }],
    });
    const classes = await call('classApi', 'listClasses', {
      schoolId: selection.schoolId,
      gradeId: selection.gradeId,
    });
    if (!classes.success) throw Error('class failed');
    expect(parseClassPage(classes.data)).toEqual({
      items: [
        {
          _id: 'test_class_a',
          name: '一班',
          schoolId: 'test_school_a',
          gradeId: 'test_grade_a',
          joinMode: 'free',
        },
      ],
    });
  });
  it('defaults to twenty rows and allows a maximum of one hundred', async () => {
    const { repository, call } = setup();
    repository.schools.clear();
    for (let index = 0; index < 105; index++)
      repository.schools.set(
        `school_${String(index).padStart(3, '0')}`,
        school({ _id: `school_${String(index).padStart(3, '0')}` }),
      );
    const first = await call('classApi', 'listSchools');
    if (!first.success) throw Error('page failed');
    expect(parseSchoolPage(first.data).items).toHaveLength(20);
    const large = await call('classApi', 'listSchools', { pageSize: 100 });
    if (!large.success) throw Error('page failed');
    expect(parseSchoolPage(large.data).items).toHaveLength(100);
    expect(parseSchoolPage(large.data).nextCursor).toBeDefined();
  });
  it.each([
    { pageSize: 0 },
    { pageSize: 101 },
    { pageSize: 1.5 },
    { pageSize: '20' },
    { cursor: '' },
    { cursor: 'not-json' },
    { cursor: 'x'.repeat(1025) },
    {
      cursor: Buffer.from(JSON.stringify({ v: 1, scope: 'schools', id: 'bad/id' })).toString(
        'base64url',
      ),
    },
  ])('rejects invalid pagination %j', async (payload) => {
    expect(await setup().call('classApi', 'listSchools', payload)).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
  });
  it('rejects a valid cursor copied to another parent scope', async () => {
    const { repository, call } = setup();
    secondClass(repository);
    repository.grades.set('test_grade_a2', grade({ _id: 'test_grade_a2' }));
    const response = await call('classApi', 'listGrades', {
      schoolId: 'test_school_a',
      pageSize: 1,
    });
    if (!response.success) throw Error('grade failed');
    expect(
      await call('classApi', 'listGrades', {
        schoolId: 'test_school_b',
        cursor: parseGradePage(response.data).nextCursor,
      }),
    ).toMatchObject({ success: false, error: { code: 'INVALID_ARGUMENT' } });
  });
  it('checks active parent hierarchy even with a syntactically valid cursor', async () => {
    const { repository, call } = setup();
    secondClass(repository);
    expect(
      await call('classApi', 'listClasses', { schoolId: 'test_school_a', gradeId: 'test_grade_b' }),
    ).toMatchObject({ success: false, error: { code: 'CLASS_NOT_AVAILABLE' } });
    repository.schools.set('test_school_a', school({ status: 'disabled' }));
    expect(await call('classApi', 'listGrades', { schoolId: 'test_school_a' })).toMatchObject({
      success: false,
      error: { code: 'SCHOOL_NOT_AVAILABLE' },
    });
  });
  it.each([
    'missingSchool',
    'missingGrade',
    'missingClass',
    'wrongSchool',
    'wrongGrade',
    'disabledSchool',
    'deletedSchool',
    'disabledGrade',
    'deletedGrade',
    'disabledClass',
    'deletedClass',
    'graduated',
    'code',
    'approval',
  ])('refuses unavailable or mismatched selection: %s', async (kind) => {
    const { repository, call } = setup();
    secondClass(repository);
    const input = { ...selection };
    if (kind === 'missingSchool') input.schoolId = 'absent';
    if (kind === 'missingGrade') input.gradeId = 'absent';
    if (kind === 'missingClass') input.classId = 'absent';
    if (kind === 'wrongSchool') input.schoolId = 'test_school_b';
    if (kind === 'wrongGrade') input.gradeId = 'test_grade_b';
    if (kind === 'disabledSchool')
      repository.schools.set(selection.schoolId, school({ status: 'disabled' }));
    if (kind === 'deletedSchool')
      repository.schools.set(selection.schoolId, school({ deletedAt: NOW }));
    if (kind === 'disabledGrade')
      repository.grades.set(selection.gradeId, grade({ status: 'disabled' }));
    if (kind === 'deletedGrade')
      repository.grades.set(selection.gradeId, grade({ deletedAt: NOW }));
    if (kind === 'disabledClass')
      repository.classes.set(selection.classId, classroom({ status: 'disabled' }));
    if (kind === 'deletedClass')
      repository.classes.set(selection.classId, classroom({ deletedAt: NOW }));
    if (kind === 'graduated')
      repository.classes.set(selection.classId, classroom({ status: 'graduated' }));
    if (kind === 'code' || kind === 'approval')
      repository.classes.set(selection.classId, classroom({ joinMode: kind }));
    expect(await call('classApi', 'selectClass', input)).toMatchObject({
      success: false,
      error: { code: 'CLASS_NOT_AVAILABLE' },
    });
    expect(repository.memberships.size).toBe(0);
    expect(repository.audits).toHaveLength(0);
  });
  it('requires identity, rejects spoofed fields and will not invent a current selection', async () => {
    const { call } = setup(user());
    expect(await call('classApi', 'selectClass', selection)).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(
      await setup().call('classApi', 'selectClass', { ...selection, role: 'admin' }),
    ).toMatchObject({ success: false, error: { code: 'INVALID_ARGUMENT' } });
    const current = await call('classApi', 'getCurrentClass');
    expect(current).toMatchObject({ success: true, data: null });
  });
  it('selects atomically, keeps historical membership, and repeats idempotently under concurrency', async () => {
    const { repository, call } = setup();
    const second = secondClass(repository);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => call('classApi', 'selectClass', selection)),
    );
    for (const result of results) {
      expect(result.success).toBe(true);
      if (result.success) expect(parseLoginResult(result.data).onboardingStep).toBe('ready');
    }
    expect(repository.memberships.size).toBe(1);
    expect(repository.audits).toHaveLength(1);
    const selected = await call('classApi', 'selectClass', second);
    expect(selected.success).toBe(true);
    expect(repository.memberships.size).toBe(2);
    expect(repository.audits).toHaveLength(2);
    expect(repository.memberships.get(membershipId('test_user', 'test_class_a'))?.status).toBe(
      'active',
    );
    const current = await call('classApi', 'getCurrentClass');
    if (!current.success) throw Error('current failed');
    expect(parseCurrentClass(current.data)?.class._id).toBe(second.classId);
  });
  it('repairs a left/deleted membership without adding a redundant same-class log', async () => {
    const { repository, call } = setup();
    await call('classApi', 'selectClass', selection);
    const id = membershipId('test_user', selection.classId);
    const old = repository.memberships.get(id);
    if (!old) throw Error('membership missing');
    repository.memberships.set(id, { ...old, status: 'left', deletedAt: NOW });
    await call('classApi', 'selectClass', selection);
    expect(repository.memberships.get(id)).toMatchObject({
      status: 'active',
      deletedAt: null,
      createdAt: NOW,
    });
    expect(repository.audits).toHaveLength(1);
  });
  it('rolls user and membership back when the audit write fails', async () => {
    const { repository, call } = setup();
    repository.failAudit = true;
    expect(await call('classApi', 'selectClass', selection)).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(repository.users.get('test_user')).not.toHaveProperty('currentClassId');
    expect(repository.memberships.size).toBe(0);
    expect(repository.audits).toHaveLength(0);
  });
  it.each(['disabled', 'deleted'] as const)(
    'rechecks user %s state inside the transaction',
    async (status) => {
      const { repository, call } = setup();
      repository.beforeTransaction = () => {
        repository.users.set('test_user', user({ identity: 'parent', status }));
      };
      expect(await call('classApi', 'selectClass', selection)).toMatchObject({
        success: false,
        error: { code: status === 'disabled' ? 'USER_DISABLED' : 'USER_DELETED' },
      });
      expect(await call('authApi', 'updateProfile', { identity: 'teacher' })).toMatchObject({
        success: false,
        error: { code: status === 'disabled' ? 'USER_DISABLED' : 'USER_DELETED' },
      });
      expect(repository.memberships.size).toBe(0);
    },
  );
  it('checks profile status and OpenID again inside the transaction', async () => {
    for (const state of ['disabled', 'deleted', 'rebound'] as const) {
      const { repository, call } = setup();
      repository.beforeTransaction = () => {
        repository.users.set(
          'test_user',
          state === 'rebound'
            ? user({ openid: 'different_trusted_user', identity: 'parent' })
            : user({ identity: 'parent', status: state }),
        );
      };
      expect(await call('authApi', 'updateProfile', { identity: 'teacher' })).toMatchObject({
        success: false,
        error: {
          code:
            state === 'disabled'
              ? 'USER_DISABLED'
              : state === 'deleted'
                ? 'USER_DELETED'
                : 'UNAUTHORIZED',
        },
      });
      expect(repository.audits).toHaveLength(0);
    }
  });
  it('rechecks a school disabled between initial user lookup and transaction', async () => {
    const { repository, call } = setup();
    repository.beforeTransaction = () => {
      repository.schools.set(selection.schoolId, school({ status: 'disabled' }));
    };
    expect(await call('classApi', 'selectClass', selection)).toMatchObject({
      success: false,
      error: { code: 'CLASS_NOT_AVAILABLE' },
    });
  });
  it('preserves concurrent profile and class updates without replacing roles', async () => {
    const { repository, call } = setup(
      user({ identity: 'parent', role: 'admin', adminSchoolId: selection.schoolId }),
    );
    const results = await Promise.all([
      call('authApi', 'updateProfile', { identity: 'teacher', nickname: '新昵称' }),
      call('classApi', 'selectClass', selection),
    ]);
    expect(results.every((result) => result.success)).toBe(true);
    expect(repository.users.get('test_user')).toMatchObject({
      nickname: '新昵称',
      identity: 'teacher',
      currentClassId: selection.classId,
      role: 'admin',
      adminSchoolId: selection.schoolId,
    });
  });
  it.each(['disabled', 'deleted', 'graduated', 'mismatch'])(
    'returns null for stale current selection: %s',
    async (kind) => {
      const { repository, call } = setup();
      await call('classApi', 'selectClass', selection);
      if (kind === 'disabled')
        repository.schools.set(selection.schoolId, school({ status: 'disabled' }));
      if (kind === 'deleted') repository.grades.set(selection.gradeId, grade({ deletedAt: NOW }));
      if (kind === 'graduated')
        repository.classes.set(selection.classId, classroom({ status: 'graduated' }));
      if (kind === 'mismatch')
        repository.classes.set(selection.classId, classroom({ schoolId: 'another-school' }));
      expect(await call('classApi', 'getCurrentClass')).toMatchObject({
        success: true,
        data: null,
      });
    },
  );
});

describe('TASK-202 trusted administration after onboarding', () => {
  it('allows an administrator to join another school as a listener without expanding administrative scope', async () => {
    const { repository, call } = setup(
      user({ role: 'admin', adminSchoolId: selection.schoolId, identity: 'teacher' }),
    );
    const second = secondClass(repository);
    expect((await call('classApi', 'selectClass', second)).success).toBe(true);
    expect(repository.users.get('test_user')?.adminSchoolId).toBe(selection.schoolId);
    expect(await call('adminApi', 'getConfig', { schoolId: second.schoolId })).toMatchObject({
      success: false,
      error: { code: 'SCHOOL_SCOPE_DENIED' },
    });
    expect(
      await call('adminAudioApi', 'listManage', { schoolId: selection.schoolId }),
    ).toMatchObject({ success: true, data: { items: [] } });
    repository.users.set('test_user', user({ identity: 'teacher', role: 'user' }));
    expect(
      await call('adminApi', 'getConfig', { schoolId: selection.schoolId, role: 'admin' }),
    ).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });
});
