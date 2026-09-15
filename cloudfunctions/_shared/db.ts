import { isRecord, parseUserProfile, readEnum, readString } from '../../shared';
import type {
  AdminLog,
  Class,
  ClassMembership,
  Grade,
  RecordDates,
  School,
  User,
} from '../../shared';
import type { DirectoryQuery, Repository, TransactionRepository, UserPatch } from './repository';

/** Narrow, structural subset of wx-server-sdk's database API for adapter tests. */
export interface CloudDatabasePort {
  command?: { gt(value: unknown): unknown };
  runTransaction?(callback: (transaction: unknown) => Promise<unknown>): unknown;
  collection(name: string): {
    where(query: Record<string, unknown>): {
      // The SDK declaration includes callback overload returns; await + validation narrows it.
      limit(count: number): { get(): unknown };
      orderBy?(
        field: string,
        direction: 'asc' | 'desc',
      ): { limit(count: number): { get(): unknown } };
    };
    add(options: { data: object }): unknown;
  };
}

function date(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new Error('Invalid database date');
  return value;
}

function rows(result: unknown): unknown[] {
  const response = sdkResponse(result);
  if (!Array.isArray(response.data)) throw new Error('Invalid database response');
  return response.data as unknown[];
}

function sdkResponse(result: unknown): Record<string, unknown> {
  if (
    !isRecord(result) ||
    result.code ||
    result.Error ||
    (result.errCode !== undefined && result.errCode !== 0) ||
    (result.errMsg !== undefined &&
      (typeof result.errMsg !== 'string' || !result.errMsg.endsWith(':ok')))
  ) {
    throw new Error('Invalid database response');
  }
  return result;
}

function insertedId(result: unknown): string {
  return readString(sdkResponse(result)._id);
}

export function parseUserDocument(value: unknown): User {
  if (!isRecord(value)) throw new Error('Invalid user document');
  const createdAt = date(value.createdAt);
  const updatedAt = date(value.updatedAt);
  const profile = parseUserProfile({
    ...value,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  });
  const user: User = { ...profile, openid: readString(value.openid), createdAt, updatedAt };
  if (value.deletedAt === null) user.deletedAt = null;
  else if (value.deletedAt !== undefined) user.deletedAt = date(value.deletedAt);
  return user;
}

function parseSchoolDocument(value: unknown): School {
  if (!isRecord(value)) throw new Error('Invalid school document');
  const school: School = {
    _id: readString(value._id),
    name: readString(value.name, 120),
    status: readEnum(value.status, ['active', 'disabled']),
    createdAt: date(value.createdAt),
    updatedAt: date(value.updatedAt),
  };
  if (value.deletedAt === null) school.deletedAt = null;
  else if (value.deletedAt !== undefined) school.deletedAt = date(value.deletedAt);
  return school;
}

function recordDates(value: Record<string, unknown>): RecordDates {
  const result: RecordDates = {
    createdAt: date(value.createdAt),
    updatedAt: date(value.updatedAt),
  };
  if (value.deletedAt === null) result.deletedAt = null;
  else if (value.deletedAt !== undefined) result.deletedAt = date(value.deletedAt);
  return result;
}
function parseGradeDocument(value: unknown): Grade {
  if (!isRecord(value) || typeof value.sortOrder !== 'number' || !Number.isFinite(value.sortOrder))
    throw new Error('Invalid grade document');
  return {
    ...recordDates(value),
    _id: readString(value._id),
    name: readString(value.name, 120),
    schoolId: readString(value.schoolId),
    sortOrder: value.sortOrder,
    status: readEnum(value.status, ['active', 'disabled']),
  };
}
function parseClassDocument(value: unknown): Class {
  if (!isRecord(value)) throw new Error('Invalid class document');
  return {
    ...recordDates(value),
    _id: readString(value._id),
    name: readString(value.name, 120),
    schoolId: readString(value.schoolId),
    gradeId: readString(value.gradeId),
    joinMode: readEnum(value.joinMode, ['free', 'code', 'approval']),
    status: readEnum(value.status, ['active', 'disabled', 'graduated']),
  };
}
function parseMembershipDocument(value: unknown): ClassMembership {
  if (!isRecord(value)) throw new Error('Invalid membership document');
  return {
    ...recordDates(value),
    _id: readString(value._id),
    userId: readString(value.userId),
    schoolId: readString(value.schoolId),
    classId: readString(value.classId),
    identity: readEnum(value.identity, ['student', 'parent', 'teacher']),
    status: readEnum(value.status, ['active', 'left']),
  };
}

/** wx-server-sdk declares transactions as any. Validate every callable and response at this boundary. */
function call(target: unknown, name: string, ...args: unknown[]): unknown {
  if (!isRecord(target) || typeof target[name] !== 'function')
    throw new Error('Invalid database API');
  return Reflect.apply(target[name], target, args);
}
function updated(result: unknown): void {
  const response = sdkResponse(result);
  if (!isRecord(response.stats) || response.stats.updated !== 1)
    throw new Error('Document update was not acknowledged');
}
class CloudTransactionRepository implements TransactionRepository {
  constructor(private readonly transaction: unknown) {}
  private collection(name: string): unknown {
    return call(this.transaction, 'collection', name);
  }
  private async find<T extends { _id: string }>(
    collection: string,
    id: string,
    parse: (value: unknown) => T,
  ): Promise<T | undefined> {
    const document = call(this.collection(collection), 'doc', id);
    const response = sdkResponse(await call(document, 'get'));
    if (response.data === null) return undefined;
    const value = parse(response.data);
    if (value._id !== id) throw new Error('Transaction document mismatch');
    return value;
  }
  findUser(id: string): Promise<User | undefined> {
    return this.find('users', id, parseUserDocument);
  }
  findSchool(id: string): Promise<School | undefined> {
    return this.find('schools', id, parseSchoolDocument);
  }
  findGrade(id: string): Promise<Grade | undefined> {
    return this.find('grades', id, parseGradeDocument);
  }
  findClass(id: string): Promise<Class | undefined> {
    return this.find('classes', id, parseClassDocument);
  }
  findMembership(id: string): Promise<ClassMembership | undefined> {
    return this.find('class_memberships', id, parseMembershipDocument);
  }
  async patchUser(id: string, patch: UserPatch): Promise<void> {
    updated(await call(call(this.collection('users'), 'doc', id), 'update', { data: patch }));
  }
  async saveMembership(membership: ClassMembership, exists: boolean): Promise<void> {
    const collection = this.collection('class_memberships');
    if (exists) {
      // Patch established membership fields; do not replace unknown future metadata.
      const { _id, ...data } = membership;
      updated(await call(call(collection, 'doc', _id), 'update', { data }));
    } else if (insertedId(await call(collection, 'add', { data: membership })) !== membership._id)
      throw new Error('Membership insert was not acknowledged');
  }
  async appendAudit(entry: Omit<AdminLog, '_id'>): Promise<void> {
    insertedId(await call(this.collection('admin_logs'), 'add', { data: entry }));
  }
}

/** wx-server-sdk only at this adapter boundary; external documents start as unknown. */
export class CloudRepository implements Repository {
  constructor(private readonly database: () => CloudDatabasePort) {}

  async findUserByOpenid(openid: string): Promise<User | undefined> {
    const result: unknown = await this.database()
      .collection('users')
      .where({ openid })
      .limit(2)
      .get();
    const data = rows(result);
    if (data.length > 1) throw new Error('User uniqueness invariant failed');
    if (data.length === 0) return undefined;
    const user = parseUserDocument(data[0]);
    if (user.openid !== openid) throw new Error('Identity query mismatch');
    return user;
  }

  async insertUser(user: User): Promise<void> {
    const result: unknown = await this.database().collection('users').add({ data: user });
    if (insertedId(result) !== user._id) throw new Error('User insert was not acknowledged');
  }

  async findSchool(id: string): Promise<School | undefined> {
    const result: unknown = await this.database()
      .collection('schools')
      .where({ _id: id })
      .limit(1)
      .get();
    const data = rows(result);
    if (data.length === 0) return undefined;
    const school = parseSchoolDocument(data[0]);
    if (school._id !== id) throw new Error('School query mismatch');
    return school;
  }

  private async findOrganization<T extends { _id: string }>(
    collection: string,
    id: string,
    parse: (value: unknown) => T,
  ): Promise<T | undefined> {
    const data = rows(
      await this.database().collection(collection).where({ _id: id }).limit(1).get(),
    );
    if (data.length === 0) return undefined;
    const value = parse(data[0]);
    if (value._id !== id) throw new Error('Organization query mismatch');
    return value;
  }
  findGrade(id: string): Promise<Grade | undefined> {
    return this.findOrganization('grades', id, parseGradeDocument);
  }
  findClass(id: string): Promise<Class | undefined> {
    return this.findOrganization('classes', id, parseClassDocument);
  }
  private async list<T extends School | Grade | Class>(
    collection: string,
    query: DirectoryQuery,
    parse: (value: unknown) => T,
  ): Promise<T[]> {
    const db = this.database();
    const filter: Record<string, unknown> = { status: 'active', deletedAt: null };
    if (query.schoolId !== undefined) filter.schoolId = query.schoolId;
    if (query.gradeId !== undefined) filter.gradeId = query.gradeId;
    if (collection === 'classes') filter.joinMode = 'free';
    if (query.afterId !== undefined) {
      if (!db.command) throw new Error('Missing database command API');
      filter._id = db.command.gt(query.afterId);
    }
    const selection = db.collection(collection).where(filter);
    if (!selection.orderBy) throw new Error('Missing database order API');
    const result = rows(await selection.orderBy('_id', 'asc').limit(query.limit).get()).map(parse);
    if (result.length > query.limit) throw new Error('Invalid directory response size');
    let previous = query.afterId;
    for (const item of result) {
      if (
        item.status !== 'active' ||
        item.deletedAt != null ||
        (previous !== undefined && item._id <= previous) ||
        (query.schoolId !== undefined &&
          (!('schoolId' in item) || item.schoolId !== query.schoolId)) ||
        (query.gradeId !== undefined && (!('gradeId' in item) || item.gradeId !== query.gradeId)) ||
        (collection === 'classes' && (!('joinMode' in item) || item.joinMode !== 'free'))
      )
        throw new Error('Directory query mismatch');
      previous = item._id;
    }
    return result;
  }
  listSchools(query: DirectoryQuery): Promise<School[]> {
    return this.list('schools', query, parseSchoolDocument);
  }
  listGrades(query: DirectoryQuery): Promise<Grade[]> {
    return this.list('grades', query, parseGradeDocument);
  }
  listClasses(query: DirectoryQuery): Promise<Class[]> {
    return this.list('classes', query, parseClassDocument);
  }
  async runTransaction<T>(work: (transaction: TransactionRepository) => Promise<T>): Promise<T> {
    const db = this.database();
    if (!db.runTransaction) throw new Error('Missing database transaction API');
    let completed: { value: T } | undefined;
    const response: unknown = await db.runTransaction(async (transaction) => {
      const value = await work(new CloudTransactionRepository(transaction));
      completed = { value };
      return completed;
    });
    // The real SDK returns the callback result only after commit. Never treat undefined as success.
    if (!completed || response !== completed)
      throw new Error('Transaction commit was not acknowledged');
    return completed.value;
  }

  async appendAudit(entry: Omit<AdminLog, '_id'>): Promise<void> {
    const result: unknown = await this.database().collection('admin_logs').add({ data: entry });
    insertedId(result);
  }

  async checkDatabase(): Promise<void> {
    // Configuration connectivity only; never return collection contents from health.
    const result: unknown = await this.database()
      .collection('system_configs')
      .where({ _id: 'app:global' })
      .limit(1)
      .get();
    rows(result);
  }
}
