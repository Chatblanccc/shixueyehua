import type { AdminLog, School, User } from '../../shared';

/** Injectable persistence boundary. Production is always CloudRepository. */
export interface Repository {
  findUserByOpenid(openid: string): Promise<User | undefined>;
  /** Atomic insert only: never use set/upsert for login. */
  insertUser(user: User): Promise<void>;
  findSchool(id: string): Promise<School | undefined>;
  appendAudit(entry: Omit<AdminLog, '_id'>): Promise<void>;
  checkDatabase(): Promise<void>;
}
