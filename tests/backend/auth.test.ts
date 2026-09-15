import { describe, expect, it, vi } from 'vitest';
import { getOnboardingStep, parseLoginResult, parseUserProfile } from '../../shared';
import {
  login,
  getProfile,
  toUserProfile,
  userDocumentId,
} from '../../cloudfunctions/authApi/login';
import {
  requireActiveUser,
  requireAdmin,
  requireLogin,
  requireSuperAdmin,
} from '../../cloudfunctions/_shared/auth';
import { MemoryRepository, NOW, school, user } from './fixtures';

describe('TASK-103 atomic login and safe profiles', () => {
  it('creates one ordinary user across simultaneous and repeat logins', async () => {
    const repository = new MemoryRepository();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => login(repository, 'test_openid_parallel', NOW)),
    );
    expect(repository.users.size).toBe(1);
    expect(repository.insertCount).toBe(1);
    expect(new Set(results.map((result) => result.user._id)).size).toBe(1);
    expect(results[0]?.user).toMatchObject({
      role: 'user',
      status: 'active',
      nickname: '夜话听友',
    });
    expect(results[0]?.onboardingStep).toBe('identity');
    expect(await login(repository, 'test_openid_parallel', NOW)).toEqual(results[0]);
  });

  it('never overwrites an existing administrator, including legacy non-deterministic IDs', async () => {
    const existing = user({ role: 'admin', adminSchoolId: 'test_school_a', identity: 'teacher' });
    const repository = new MemoryRepository([existing]);
    const result = await login(repository, existing.openid, new Date());
    expect(result.user).toMatchObject({
      _id: existing._id,
      role: 'admin',
      adminSchoolId: 'test_school_a',
    });
    expect(repository.insertCount).toBe(0);
    expect(repository.users.get(existing._id)).toEqual(existing);
  });

  it('recovers when the insert commits but its transport response fails', async () => {
    const repository = new MemoryRepository();
    const insert = repository.insertUser.bind(repository);
    vi.spyOn(repository, 'insertUser').mockImplementation(async (entry) => {
      await insert(entry);
      throw new Error('response dropped after write');
    });
    const result = await login(repository, 'test_openid_transport', NOW);
    expect(result.user._id).toBe(userDocumentId('test_openid_transport'));
    expect(repository.users.size).toBe(1);
  });

  it('fails a real insert error when there is no existing persisted user', async () => {
    const repository = new MemoryRepository();
    vi.spyOn(repository, 'insertUser').mockRejectedValue(new Error('database unavailable'));
    await expect(login(repository, 'test_openid_failure', NOW)).rejects.toThrow(
      'database unavailable',
    );
    expect(repository.users.size).toBe(0);
  });

  it('returns a whitelist profile with ISO timestamps, without OpenID or internal fields', () => {
    const result = toUserProfile(user({ deletedBy: 'test_operator' }));
    expect(result.createdAt).toBe(NOW.toISOString());
    expect(result).not.toHaveProperty('openid');
    expect(result).not.toHaveProperty('deletedBy');
    expect(
      parseUserProfile({ ...result, openid: 'test_secret', injectedField: 'untrusted' }),
    ).toEqual(result);
  });

  it('derives identity, class, and ready using every required selection field', () => {
    const initial = toUserProfile(user());
    expect(getOnboardingStep(initial)).toBe('identity');
    expect(getOnboardingStep({ ...initial, identity: 'student' })).toBe('class');
    expect(
      getOnboardingStep({
        ...initial,
        identity: 'student',
        currentSchoolId: 's',
        currentClassId: 'c',
      }),
    ).toBe('class');
    expect(
      getOnboardingStep({
        ...initial,
        identity: 'student',
        currentSchoolId: 's',
        currentGradeId: 'g',
        currentClassId: 'c',
      }),
    ).toBe('ready');
  });

  it('validates unknown API data and rejects inconsistent onboarding or invalid dates/roles', () => {
    const profile = toUserProfile(user());
    expect(parseLoginResult({ user: profile, onboardingStep: 'identity' }).user).toEqual(profile);
    expect(() => parseLoginResult({ user: profile, onboardingStep: 'ready' })).toThrow();
    expect(() => parseUserProfile({ ...profile, createdAt: 'yesterday' })).toThrow();
    expect(() => parseUserProfile({ ...profile, role: 'owner' })).toThrow();
    expect(() => parseLoginResult(null)).toThrow();
  });

  it('allows disabled login/profile while refusing active-user writes', async () => {
    const disabled = user({ status: 'disabled' });
    const repository = new MemoryRepository([disabled]);
    expect((await login(repository, disabled.openid, NOW)).user.status).toBe('disabled');
    expect((await getProfile(repository, disabled.openid)).user.status).toBe('disabled');
    await expect(requireActiveUser(repository, disabled.openid)).rejects.toMatchObject({
      code: 'USER_DISABLED',
    });
  });

  it.each([user({ status: 'deleted' }), user({ deletedAt: NOW })])(
    'refuses deleted accounts without creating replacements',
    async (deleted) => {
      const repository = new MemoryRepository([deleted]);
      await expect(login(repository, deleted.openid, NOW)).rejects.toMatchObject({
        code: 'USER_DELETED',
      });
      expect(repository.users.size).toBe(1);
      expect(repository.insertCount).toBe(0);
    },
  );
});

describe('TASK-101 current authorization and school separation', () => {
  it('requires an existing user and rejects ordinary management users', async () => {
    const repository = new MemoryRepository([user()]);
    await expect(requireLogin(repository, 'test_unknown')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(requireAdmin(repository, user().openid, 'test_school_a')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(requireSuperAdmin(repository, user().openid)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('bases authority on adminSchoolId, regardless of currentSchoolId', async () => {
    const admin = user({
      role: 'admin',
      adminSchoolId: 'test_school_a',
      currentSchoolId: 'test_school_b',
    });
    const repository = new MemoryRepository([admin]);
    repository.schools.set('test_school_b', school({ _id: 'test_school_b' }));
    expect(await requireAdmin(repository, admin.openid, 'test_school_a')).toEqual(admin);
    await expect(requireAdmin(repository, admin.openid, 'test_school_b')).rejects.toMatchObject({
      code: 'SCHOOL_SCOPE_DENIED',
    });
    repository.users.set(admin._id, { ...admin, adminSchoolId: undefined });
    await expect(requireAdmin(repository, admin.openid)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('re-reads role so revocation takes effect on the next operation', async () => {
    const admin = user({ role: 'admin', adminSchoolId: 'test_school_a' });
    const repository = new MemoryRepository([admin]);
    await requireAdmin(repository, admin.openid);
    repository.users.set(admin._id, { ...admin, role: 'user', adminSchoolId: undefined });
    await expect(requireAdmin(repository, admin.openid)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it.each(['disabled', 'deleted'] as const)('refuses %s managers', async (status) => {
    const admin = user({ role: 'super_admin', status });
    const repository = new MemoryRepository([admin]);
    await expect(requireAdmin(repository, admin.openid, 'test_school_a')).rejects.toMatchObject({
      code: status === 'deleted' ? 'USER_DELETED' : 'USER_DISABLED',
    });
  });

  it('checks target school existence/status even for super administrators', async () => {
    const admin = user({ role: 'super_admin' });
    const repository = new MemoryRepository([admin]);
    await expect(
      requireAdmin(repository, admin.openid, 'test_unknown_school'),
    ).rejects.toMatchObject({ code: 'SCHOOL_NOT_AVAILABLE' });
    repository.schools.set('test_school_a', school({ status: 'disabled' }));
    await expect(requireAdmin(repository, admin.openid, 'test_school_a')).rejects.toMatchObject({
      code: 'SCHOOL_NOT_AVAILABLE',
    });
    repository.schools.set('test_school_a', school({ deletedAt: NOW }));
    await expect(requireAdmin(repository, admin.openid, 'test_school_a')).rejects.toMatchObject({
      code: 'SCHOOL_NOT_AVAILABLE',
    });
  });
});
