import { isRecord, parseUserProfile, readEnum, readString } from '../../shared';
import type { AdminLog, School, User } from '../../shared';
import type { Repository } from './repository';

/** Narrow, structural subset of wx-server-sdk's database API for adapter tests. */
export interface CloudDatabasePort {
  collection(name: string): {
    where(query: Record<string, unknown>): {
      // The SDK declaration includes callback overload returns; await + validation narrows it.
      limit(count: number): { get(): unknown };
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
