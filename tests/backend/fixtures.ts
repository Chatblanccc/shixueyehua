import type { AdminLog, School, User } from '../../shared';
import type { Repository } from '../../cloudfunctions/_shared/repository';

export const NOW = new Date('2026-09-15T08:00:00.000Z');

export function user(overrides: Partial<User> = {}): User {
  return {
    _id: 'test_user',
    openid: 'test_trusted_openid',
    nickname: '测试听友',
    role: 'user',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function school(overrides: Partial<School> = {}): School {
  return {
    _id: 'test_school_a',
    name: '测试学校',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** In-memory test repository only; no production import or runtime mock switch exists. */
export class MemoryRepository implements Repository {
  readonly users = new Map<string, User>();
  readonly schools = new Map<string, School>();
  readonly audits: Omit<AdminLog, '_id'>[] = [];
  insertCount = 0;
  healthCount = 0;

  constructor(initialUsers: User[] = []) {
    for (const entry of initialUsers) this.users.set(entry._id, entry);
    const initialSchool = school();
    this.schools.set(initialSchool._id, initialSchool);
  }

  async findUserByOpenid(openid: string): Promise<User | undefined> {
    return [...this.users.values()].find((entry) => entry.openid === openid);
  }

  async insertUser(entry: User): Promise<void> {
    if (
      this.users.has(entry._id) ||
      [...this.users.values()].some((existing) => existing.openid === entry.openid)
    ) {
      throw new Error('duplicate key');
    }
    this.users.set(entry._id, entry);
    this.insertCount += 1;
  }

  async findSchool(id: string): Promise<School | undefined> {
    return this.schools.get(id);
  }

  async appendAudit(entry: Omit<AdminLog, '_id'>): Promise<void> {
    this.audits.push(entry);
  }

  async checkDatabase(): Promise<void> {
    this.healthCount += 1;
  }
}
