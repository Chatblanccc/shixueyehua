import { isRecord } from '../../shared';
import type { User } from '../../shared';
import { AppError } from './errors';
import type { Repository } from './repository';

/** The caller passes only SDK getWXContext(), never event or client payload. */
export function trustedOpenid(context: unknown): string {
  if (
    !isRecord(context) ||
    typeof context.OPENID !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(context.OPENID)
  ) {
    throw new AppError('UNAUTHORIZED');
  }
  return context.OPENID;
}

export function assertNotDeleted(user: User): void {
  if (user.status === 'deleted' || user.deletedAt != null) throw new AppError('USER_DELETED');
}

export async function requireLogin(repository: Repository, openid: string): Promise<User> {
  const user = await repository.findUserByOpenid(openid);
  if (!user) throw new AppError('UNAUTHORIZED');
  assertNotDeleted(user);
  return user;
}

export async function requireActiveUser(repository: Repository, openid: string): Promise<User> {
  const user = await requireLogin(repository, openid);
  if (user.status !== 'active') throw new AppError('USER_DISABLED');
  return user;
}

export function assertSameSchool(actor: User, resourceSchoolId: string): void {
  if (actor.role === 'super_admin') return;
  if (actor.role !== 'admin' || !actor.adminSchoolId) throw new AppError('FORBIDDEN');
  if (actor.adminSchoolId !== resourceSchoolId) throw new AppError('SCHOOL_SCOPE_DENIED');
}

export async function assertSchoolAvailable(
  repository: Repository,
  schoolId: string,
): Promise<void> {
  const school = await repository.findSchool(schoolId);
  if (!school || school.status !== 'active' || school.deletedAt != null) {
    throw new AppError('SCHOOL_NOT_AVAILABLE');
  }
}

/** Always re-read role: authorization is deliberately never cached across requests. */
export async function requireAdmin(
  repository: Repository,
  openid: string,
  schoolId?: string,
): Promise<User> {
  const actor = await requireActiveUser(repository, openid);
  if (actor.role !== 'admin' && actor.role !== 'super_admin') throw new AppError('FORBIDDEN');
  if (actor.role === 'admin') {
    if (!actor.adminSchoolId) throw new AppError('FORBIDDEN');
    assertSameSchool(actor, schoolId ?? actor.adminSchoolId);
    await assertSchoolAvailable(repository, actor.adminSchoolId);
  } else if (schoolId) {
    await assertSchoolAvailable(repository, schoolId);
  }
  return actor;
}

export async function requireSuperAdmin(repository: Repository, openid: string): Promise<User> {
  const actor = await requireActiveUser(repository, openid);
  if (actor.role !== 'super_admin') throw new AppError('FORBIDDEN');
  return actor;
}
