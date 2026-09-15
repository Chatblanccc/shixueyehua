import { createHash } from 'node:crypto';
import type {
  Class,
  ClassMembership,
  ClassOption,
  ClassSelectionInput,
  CurrentClass,
  CursorPage,
  Grade,
  GradeOption,
  LoginResult,
  School,
  SchoolOption,
} from '../../shared';
import { isRecord } from '../../shared';
import { requireActiveUser, requireLogin } from '../_shared/auth';
import { writeAudit } from '../_shared/audit';
import { AppError } from '../_shared/errors';
import type { DirectoryQuery, OrganizationReader, Repository } from '../_shared/repository';
import { transactionUser } from '../_shared/user-transaction';
import { identifier } from '../_shared/validate';
import { loginResult } from '../authApi/login';

const schoolOption = (entry: School): SchoolOption => ({ _id: entry._id, name: entry.name });
const gradeOption = (entry: Grade): GradeOption => ({
  _id: entry._id,
  name: entry.name,
  schoolId: entry.schoolId,
});
const classOption = (entry: Class): ClassOption => ({
  _id: entry._id,
  name: entry.name,
  schoolId: entry.schoolId,
  gradeId: entry.gradeId,
  joinMode: 'free',
});
const active = (entry: School | Grade | Class | undefined): boolean =>
  !!entry && entry.status === 'active' && entry.deletedAt == null;

function keys(payload: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(payload).some((key) => !allowed.includes(key)))
    throw new AppError('INVALID_ARGUMENT');
}
function directoryQuery(payload: Record<string, unknown>, scope: string): DirectoryQuery {
  const pageSize = payload.pageSize ?? 20;
  if (typeof pageSize !== 'number' || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new AppError('INVALID_ARGUMENT');
  const query: DirectoryQuery = { limit: pageSize + 1 };
  if (payload.cursor !== undefined) {
    try {
      if (
        typeof payload.cursor !== 'string' ||
        payload.cursor.length > 1024 ||
        !/^[A-Za-z0-9_-]+$/.test(payload.cursor)
      )
        throw new Error('cursor');
      const decoded = Buffer.from(payload.cursor, 'base64url');
      if (decoded.toString('base64url') !== payload.cursor) throw new Error('cursor');
      const cursor: unknown = JSON.parse(decoded.toString('utf8'));
      if (
        !isRecord(cursor) ||
        cursor.v !== 1 ||
        cursor.scope !== scope ||
        Object.keys(cursor).length !== 3
      )
        throw new Error('cursor');
      query.afterId = identifier(cursor.id);
    } catch {
      throw new AppError('INVALID_ARGUMENT');
    }
  }
  return query;
}
function page<T extends { _id: string }, U>(
  entries: T[],
  query: DirectoryQuery,
  scope: string,
  dto: (entry: T) => U,
): CursorPage<U> {
  const size = query.limit - 1;
  const visible = entries.slice(0, size);
  const result: CursorPage<U> = { items: visible.map(dto) };
  if (entries.length > size)
    result.nextCursor = Buffer.from(
      JSON.stringify({ v: 1, scope, id: visible.at(-1)?._id }),
    ).toString('base64url');
  return result;
}
export async function listSchools(
  repository: Repository,
  openid: string,
  payload: Record<string, unknown>,
): Promise<CursorPage<SchoolOption>> {
  keys(payload, ['pageSize', 'cursor']);
  await requireLogin(repository, openid);
  const query = directoryQuery(payload, 'schools');
  return page(await repository.listSchools(query), query, 'schools', schoolOption);
}
export async function listGrades(
  repository: Repository,
  openid: string,
  payload: Record<string, unknown>,
): Promise<CursorPage<GradeOption>> {
  keys(payload, ['schoolId', 'pageSize', 'cursor']);
  await requireLogin(repository, openid);
  const schoolId = identifier(payload.schoolId);
  if (!active(await repository.findSchool(schoolId))) throw new AppError('SCHOOL_NOT_AVAILABLE');
  const scope = JSON.stringify(['grades', schoolId]);
  const query = { ...directoryQuery(payload, scope), schoolId };
  return page(await repository.listGrades(query), query, scope, gradeOption);
}
export async function listClasses(
  repository: Repository,
  openid: string,
  payload: Record<string, unknown>,
): Promise<CursorPage<ClassOption>> {
  keys(payload, ['schoolId', 'gradeId', 'pageSize', 'cursor']);
  await requireLogin(repository, openid);
  const schoolId = identifier(payload.schoolId);
  const gradeId = identifier(payload.gradeId);
  if (!active(await repository.findSchool(schoolId))) throw new AppError('SCHOOL_NOT_AVAILABLE');
  const grade = await repository.findGrade(gradeId);
  if (!active(grade) || grade?.schoolId !== schoolId) throw new AppError('CLASS_NOT_AVAILABLE');
  const scope = JSON.stringify(['classes', schoolId, gradeId]);
  const query = { ...directoryQuery(payload, scope), schoolId, gradeId };
  return page(await repository.listClasses(query), query, scope, classOption);
}
export function membershipId(userId: string, classId: string): string {
  return `mem_${createHash('sha256')
    .update(JSON.stringify([userId, classId]))
    .digest('hex')}`;
}
export async function hierarchy(
  reader: OrganizationReader,
  input: ClassSelectionInput,
): Promise<CurrentClass | null> {
  const school = await reader.findSchool(input.schoolId);
  const grade = await reader.findGrade(input.gradeId);
  const selected = await reader.findClass(input.classId);
  if (
    !school ||
    !grade ||
    !selected ||
    !active(school) ||
    !active(grade) ||
    !active(selected) ||
    grade.schoolId !== school._id ||
    selected.schoolId !== school._id ||
    selected.gradeId !== grade._id ||
    selected.joinMode !== 'free'
  )
    return null;
  return { school: schoolOption(school), grade: gradeOption(grade), class: classOption(selected) };
}
export async function getCurrentClass(
  repository: Repository,
  openid: string,
  payload: Record<string, unknown>,
): Promise<CurrentClass | null> {
  keys(payload, []);
  const actor = await requireLogin(repository, openid);
  if (!actor.currentSchoolId || !actor.currentGradeId || !actor.currentClassId) return null;
  return hierarchy(repository, {
    schoolId: actor.currentSchoolId,
    gradeId: actor.currentGradeId,
    classId: actor.currentClassId,
  });
}
export async function selectClass(
  repository: Repository,
  openid: string,
  payload: Record<string, unknown>,
  now: Date,
  requestId: string,
): Promise<LoginResult> {
  keys(payload, ['schoolId', 'gradeId', 'classId']);
  const input: ClassSelectionInput = {
    schoolId: identifier(payload.schoolId),
    gradeId: identifier(payload.gradeId),
    classId: identifier(payload.classId),
  };
  const initial = await requireActiveUser(repository, openid);
  return repository.runTransaction(async (transaction) => {
    const actor = await transactionUser(transaction, initial._id, openid);
    if (!actor.identity) throw new AppError('INVALID_ARGUMENT');
    if (!(await hierarchy(transaction, input))) throw new AppError('CLASS_NOT_AVAILABLE');
    const id = membershipId(actor._id, input.classId);
    const existing = await transaction.findMembership(id);
    if (
      existing &&
      (existing.userId !== actor._id ||
        existing.classId !== input.classId ||
        existing.schoolId !== input.schoolId)
    )
      throw new Error('Membership identity mismatch');
    const sameClass =
      actor.currentSchoolId === input.schoolId &&
      actor.currentGradeId === input.gradeId &&
      actor.currentClassId === input.classId;
    const memberCurrent =
      existing?.status === 'active' &&
      existing.deletedAt == null &&
      existing.identity === actor.identity;
    if (!memberCurrent) {
      const member: ClassMembership = {
        _id: id,
        userId: actor._id,
        schoolId: input.schoolId,
        classId: input.classId,
        identity: actor.identity,
        status: 'active',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      };
      await transaction.saveMembership(member, !!existing);
    }
    if (sameClass) return loginResult(actor);
    const patch = {
      currentSchoolId: input.schoolId,
      currentGradeId: input.gradeId,
      currentClassId: input.classId,
      updatedAt: now,
    };
    await transaction.patchUser(actor._id, patch);
    await writeAudit(transaction, {
      actor,
      schoolId: input.schoolId,
      action: 'class_switch',
      targetType: 'user',
      targetId: actor._id,
      before: actor,
      after: patch,
      requestId,
      now,
    });
    return loginResult({ ...actor, ...patch });
  });
}
