import type { AdminLog, Class, ClassMembership, Grade, School, User } from '../../shared';

export type UserPatch = Partial<
  Pick<
    User,
    | 'identity'
    | 'nickname'
    | 'avatarPreset'
    | 'currentSchoolId'
    | 'currentGradeId'
    | 'currentClassId'
  >
> & { updatedAt: Date };
export interface DirectoryQuery {
  afterId?: string;
  limit: number;
  schoolId?: string;
  gradeId?: string;
}
export interface OrganizationReader {
  findSchool(id: string): Promise<School | undefined>;
  findGrade(id: string): Promise<Grade | undefined>;
  findClass(id: string): Promise<Class | undefined>;
}
export interface TransactionRepository extends OrganizationReader {
  findUser(id: string): Promise<User | undefined>;
  patchUser(id: string, patch: UserPatch): Promise<void>;
  findMembership(id: string): Promise<ClassMembership | undefined>;
  saveMembership(membership: ClassMembership, exists: boolean): Promise<void>;
  appendAudit(entry: Omit<AdminLog, '_id'>): Promise<void>;
}

/** Injectable persistence boundary. Production is always CloudRepository. */
export interface Repository extends OrganizationReader {
  findUserByOpenid(openid: string): Promise<User | undefined>;
  /** Atomic insert only: never use set/upsert for login. */
  insertUser(user: User): Promise<void>;
  listSchools(query: DirectoryQuery): Promise<School[]>;
  listGrades(query: DirectoryQuery): Promise<Grade[]>;
  listClasses(query: DirectoryQuery): Promise<Class[]>;
  runTransaction<T>(work: (transaction: TransactionRepository) => Promise<T>): Promise<T>;
  appendAudit(entry: Omit<AdminLog, '_id'>): Promise<void>;
  checkDatabase(): Promise<void>;
}
