import type { AdminLog, Class, ClassMembership, Grade, School, User } from '../../shared';
import type {
  DirectoryQuery,
  Repository,
  TransactionRepository,
} from '../../cloudfunctions/_shared/repository';

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

export function grade(overrides: Partial<Grade> = {}): Grade {
  return {
    _id: 'test_grade_a',
    schoolId: 'test_school_a',
    name: '七年级',
    sortOrder: 1,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
export function classroom(overrides: Partial<Class> = {}): Class {
  return {
    _id: 'test_class_a',
    schoolId: 'test_school_a',
    gradeId: 'test_grade_a',
    name: '一班',
    joinMode: 'free',
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
  readonly grades = new Map<string, Grade>();
  readonly classes = new Map<string, Class>();
  readonly memberships = new Map<string, ClassMembership>();
  private transactionTail: Promise<void> = Promise.resolve();
  failAudit = false;
  beforeTransaction?: () => void;
  readonly audits: Omit<AdminLog, '_id'>[] = [];
  insertCount = 0;
  healthCount = 0;

  constructor(initialUsers: User[] = []) {
    for (const entry of initialUsers) this.users.set(entry._id, entry);
    const initialSchool = school();
    this.schools.set(initialSchool._id, initialSchool);
    this.grades.set(grade()._id, grade());
    this.classes.set(classroom()._id, classroom());
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

  async findGrade(id: string): Promise<Grade | undefined> {
    return this.grades.get(id);
  }
  async findClass(id: string): Promise<Class | undefined> {
    return this.classes.get(id);
  }
  private list<T extends School | Grade | Class>(
    values: Map<string, T>,
    query: DirectoryQuery,
  ): T[] {
    return [...values.values()]
      .filter(
        (item) =>
          item.status === 'active' &&
          item.deletedAt == null &&
          (!query.afterId || item._id > query.afterId) &&
          (!query.schoolId || ('schoolId' in item && item.schoolId === query.schoolId)) &&
          (!query.gradeId || ('gradeId' in item && item.gradeId === query.gradeId)) &&
          (!('joinMode' in item) || item.joinMode === 'free'),
      )
      .sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0))
      .slice(0, query.limit);
  }
  async listSchools(query: DirectoryQuery): Promise<School[]> {
    return this.list(this.schools, query);
  }
  async listGrades(query: DirectoryQuery): Promise<Grade[]> {
    return this.list(this.grades, query);
  }
  async listClasses(query: DirectoryQuery): Promise<Class[]> {
    return this.list(this.classes, query);
  }
  async runTransaction<T>(work: (transaction: TransactionRepository) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release = () => {};
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      this.beforeTransaction?.();
      const users = structuredClone(this.users);
      const schools = structuredClone(this.schools);
      const grades = structuredClone(this.grades);
      const classes = structuredClone(this.classes);
      const memberships = structuredClone(this.memberships);
      const audits: Omit<AdminLog, '_id'>[] = [];
      const transaction: TransactionRepository = {
        findUser: async (id) => users.get(id),
        findSchool: async (id) => schools.get(id),
        findGrade: async (id) => grades.get(id),
        findClass: async (id) => classes.get(id),
        findMembership: async (id) => memberships.get(id),
        patchUser: async (id, patch) => {
          const old = users.get(id);
          if (!old) throw new Error('missing user');
          users.set(id, { ...old, ...patch });
        },
        saveMembership: async (member) => {
          memberships.set(member._id, member);
        },
        appendAudit: async (entry) => {
          if (this.failAudit) throw new Error('audit failed');
          audits.push(entry);
        },
      };
      const result = await work(transaction);
      this.users.clear();
      for (const [id, value] of users) this.users.set(id, value);
      this.memberships.clear();
      for (const [id, value] of memberships) this.memberships.set(id, value);
      this.audits.push(...audits);
      return result;
    } finally {
      release();
    }
  }

  async appendAudit(entry: Omit<AdminLog, '_id'>): Promise<void> {
    this.audits.push(entry);
  }

  async checkDatabase(): Promise<void> {
    this.healthCount += 1;
  }
}
