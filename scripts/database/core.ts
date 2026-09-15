import { developmentSeeds } from './seed-dev-data';
export { developmentSeeds, SEED_SCHOOL_ID } from './seed-dev-data';
import { DATABASE_MANIFEST, sameIndex, type IndexDefinition } from './manifest';

export type DocumentData = Record<string, unknown>;

export class DatabaseScriptError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'DatabaseScriptError';
  }
}

export function isRecord(value: unknown): value is DocumentData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface DevTarget {
  stage: string;
  environmentId: string;
  devEnvironmentId: string;
  otherEnvironmentIds?: readonly string[];
}

export function assertDevTarget(target: DevTarget): void {
  if (target.stage !== 'dev') throw new DatabaseScriptError('DEV_ONLY');
  if (
    !target.devEnvironmentId ||
    !target.environmentId ||
    target.environmentId !== target.devEnvironmentId ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{3,127}$/.test(target.environmentId)
  ) {
    throw new DatabaseScriptError('DEV_ENVIRONMENT_MISMATCH');
  }
  if (target.otherEnvironmentIds?.includes(target.environmentId)) {
    throw new DatabaseScriptError('ENVIRONMENTS_NOT_ISOLATED');
  }
}

export interface TransactionPort {
  get(collection: string, id: string): Promise<DocumentData | null>;
  set(collection: string, id: string, data: DocumentData): Promise<void>;
  update(collection: string, id: string, data: DocumentData): Promise<void>;
}

export interface DataPort {
  transaction<T>(work: (transaction: TransactionPort) => Promise<T>): Promise<T>;
  findUsers(filter: DocumentData): Promise<readonly DocumentData[]>;
  serverDate(): unknown;
}

export interface ManagementPort {
  listCollectionNames(): Promise<readonly string[]>;
  createCollection(name: string): Promise<void>;
  denyStorageAccess(): Promise<void>;
  denyCollectionAccess(name: string): Promise<void>;
  getIndexes(name: string): Promise<readonly IndexDefinition[]>;
  createIndex(collection: string, index: IndexDefinition): Promise<void>;
}

export async function initializeDatabase(
  target: DevTarget,
  management: ManagementPort,
  data: DataPort,
): Promise<{ collectionsCreated: number; indexesCreated: number; seedsCreated: number }> {
  assertDevTarget(target);
  // Restrict storage first; no seed data is written until all rules and indexes succeed.
  await management.denyStorageAccess();
  const existing = new Set(await management.listCollectionNames());
  let collectionsCreated = 0;
  let indexesCreated = 0;
  for (const collection of DATABASE_MANIFEST) {
    if (!existing.has(collection.name)) {
      await management.createCollection(collection.name);
      collectionsCreated += 1;
    }
    await management.denyCollectionAccess(collection.name);
  }
  for (const collection of DATABASE_MANIFEST) {
    const indexes = await management.getIndexes(collection.name);
    for (const wanted of collection.indexes) {
      const named = indexes.find((current) => current.name === wanted.name);
      if (named && !sameIndex(named, wanted)) {
        throw new DatabaseScriptError('INDEX_DEFINITION_CONFLICT');
      }
      if (named || indexes.some((current) => sameIndex(current, wanted))) continue;
      await management.createIndex(collection.name, wanted);
      // Do not report a successful index merely because the mutation request returned.
      const verified = await management.getIndexes(collection.name);
      if (!verified.some((current) => sameIndex(current, wanted))) {
        throw new DatabaseScriptError('INDEX_NOT_READY');
      }
      indexesCreated += 1;
    }
  }
  return {
    collectionsCreated,
    indexesCreated,
    seedsCreated: await seedDevelopmentData(target, data),
  };
}

export async function seedDevelopmentData(target: DevTarget, data: DataPort): Promise<number> {
  assertDevTarget(target);
  return data.transaction(async (transaction) => {
    let created = 0;
    for (const seed of developmentSeeds(data.serverDate())) {
      if (await transaction.get(seed.collection, seed.id)) continue;
      await transaction.set(seed.collection, seed.id, seed.data);
      created += 1;
    }
    return created;
  });
}

export const BOOTSTRAP_RECEIPT_ID = 'bootstrap:first-super-admin';

/** The permanent receipt serializes all invocations and prevents later re-elevation. */
export async function bootstrapSuperAdmin(
  target: DevTarget,
  trustedOpenId: string,
  requestId: string,
  data: DataPort,
): Promise<'granted' | 'already-granted'> {
  assertDevTarget(target);
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(trustedOpenId)) {
    throw new DatabaseScriptError('INVALID_TRUSTED_OPENID');
  }
  const matches = await data.findUsers({ openid: trustedOpenId });
  if (matches.length !== 1 || typeof matches[0]?._id !== 'string') {
    throw new DatabaseScriptError('EXISTING_USER_REQUIRED');
  }
  const userId = matches[0]._id;
  // The SDK supports only doc reads in transactions. The receipt, not this query,
  // is the synchronization point for concurrent bootstrap calls.
  const superAdmins = await data.findUsers({ role: 'super_admin' });
  return data.transaction(async (transaction) => {
    const receipt = await transaction.get('admin_logs', BOOTSTRAP_RECEIPT_ID);
    const user = await transaction.get('users', userId);
    if (
      !user ||
      user.openid !== trustedOpenId ||
      user.status !== 'active' ||
      user.deletedAt != null
    ) {
      throw new DatabaseScriptError('ACTIVE_TRUSTED_USER_REQUIRED');
    }
    if (receipt) {
      if (receipt.targetId === userId && user.role === 'super_admin') return 'already-granted';
      throw new DatabaseScriptError('BOOTSTRAP_ALREADY_CONSUMED');
    }
    if (superAdmins.length > 0 || user.role !== 'user') {
      throw new DatabaseScriptError('FIRST_SUPER_ADMIN_ONLY');
    }
    const timestamp = data.serverDate();
    await transaction.update('users', userId, { role: 'super_admin', updatedAt: timestamp });
    await transaction.set('admin_logs', BOOTSTRAP_RECEIPT_ID, {
      operatorId: 'system:bootstrap',
      operatorOpenid: 'system:bootstrap',
      action: 'bootstrap.super_admin',
      targetType: 'user',
      targetId: userId,
      before: { role: 'user' },
      after: { role: 'super_admin' },
      requestId,
      createdAt: timestamp,
    });
    return 'granted';
  });
}
