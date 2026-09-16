import { describe, expect, it } from 'vitest';
import {
  assertDevTarget,
  BOOTSTRAP_RECEIPT_ID,
  bootstrapSuperAdmin,
  developmentSeeds,
  initializeDatabase,
  seedDevelopmentData,
  type DataPort,
  type DevTarget,
  type DocumentData,
  type ManagementPort,
  type TransactionPort,
} from '../../scripts/database/core';
import { DATABASE_MANIFEST, type IndexDefinition } from '../../scripts/database/manifest';

const target: DevTarget = {
  stage: 'dev',
  environmentId: 'fictional-dev-env',
  devEnvironmentId: 'fictional-dev-env',
  otherEnvironmentIds: ['fictional-prod-env'],
};

/** A serial, rollback-capable in-memory transaction port; it is not CloudBase evidence. */
class MemoryData implements DataPort {
  records = new Map<string, DocumentData>();
  beforeCommit?: () => void;
  private queue: Promise<void> = Promise.resolve();

  serverDate(): unknown {
    return { serverTimestamp: true };
  }

  async findUsers(filter: DocumentData): Promise<readonly DocumentData[]> {
    return [...this.records.entries()]
      .filter(
        ([key, value]) =>
          key.startsWith('users/') &&
          Object.entries(filter).every(([field, wanted]) => value[field] === wanted),
      )
      .map(([, value]) => structuredClone(value))
      .slice(0, 2);
  }

  async transaction<T>(work: (transaction: TransactionPort) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = structuredClone(this.records);
    try {
      const result = await work({
        get: (collection, id) => Promise.resolve(snapshot.get(`${collection}/${id}`) ?? null),
        set: (collection, id, data) => {
          snapshot.set(`${collection}/${id}`, { ...data, _id: id });
          return Promise.resolve();
        },
        update: (collection, id, data) => {
          const key = `${collection}/${id}`;
          const current = snapshot.get(key);
          if (!current) throw new Error('Missing record');
          snapshot.set(key, { ...current, ...data });
          return Promise.resolve();
        },
      });
      this.beforeCommit?.();
      this.records = snapshot;
      return result;
    } finally {
      release();
    }
  }

  user(id = 'user-1', openid = 'fictional_openid_1', role = 'user'): void {
    this.records.set(`users/${id}`, {
      _id: id,
      openid,
      role,
      status: 'active',
      currentSchoolId: 'selected-school',
    });
  }
}

class MemoryManagement implements ManagementPort {
  collections = new Map<string, IndexDefinition[]>();
  events: string[] = [];

  listCollectionNames(): Promise<readonly string[]> {
    return Promise.resolve([...this.collections.keys()]);
  }
  createCollection(name: string): Promise<void> {
    this.events.push(`collection:${name}`);
    this.collections.set(name, []);
    return Promise.resolve();
  }
  denyStorageAccess(): Promise<void> {
    this.events.push('deny:storage');
    return Promise.resolve();
  }
  denyCollectionAccess(name: string): Promise<void> {
    this.events.push(`deny:${name}`);
    return Promise.resolve();
  }
  getIndexes(name: string): Promise<readonly IndexDefinition[]> {
    return Promise.resolve(this.collections.get(name) ?? []);
  }
  createIndex(collection: string, index: IndexDefinition): Promise<void> {
    this.events.push(`index:${collection}`);
    this.collections.get(collection)?.push(index);
    return Promise.resolve();
  }
}

describe('TASK-102 manifest and initialization', () => {
  it('defines 16 distinct collections and required uniqueness constraints', () => {
    expect(new Set(DATABASE_MANIFEST.map((collection) => collection.name)).size).toBe(16);
    for (const [collection, fields] of [
      ['users', ['openid']],
      ['favorites', ['userId', 'audioId']],
      ['play_progress', ['userId', 'audioId']],
    ] as const) {
      expect(
        DATABASE_MANIFEST.find((item) => item.name === collection)?.indexes.some(
          (index) =>
            index.unique &&
            JSON.stringify(index.keys.map((key) => key.name)) === JSON.stringify(fields),
        ),
      ).toBe(true);
    }
    for (const collection of DATABASE_MANIFEST) {
      expect(new Set(collection.indexes.map((index) => index.name)).size).toBe(
        collection.indexes.length,
      );
    }
  });

  it('initializes twice with no duplicate indexes or seed records, denying before indexing', async () => {
    const management = new MemoryManagement();
    const data = new MemoryData();
    const first = await initializeDatabase(target, management, data);
    expect(first.collectionsCreated).toBe(DATABASE_MANIFEST.length);
    expect(first.indexesCreated).toBeGreaterThan(15);
    expect(first.seedsCreated).toBe(8);
    expect(management.events[0]).toBe('deny:storage');
    const firstIndex = management.events.findIndex((event) => event.startsWith('index:'));
    expect(
      management.events.slice(0, firstIndex).filter((event) => event.startsWith('deny:')),
    ).toHaveLength(DATABASE_MANIFEST.length + 1);
    expect(await initializeDatabase(target, management, data)).toEqual({
      collectionsCreated: 0,
      indexesCreated: 0,
      seedsCreated: 0,
    });
    expect(data.records.size).toBe(8);
  });

  it('fails on a conflicting named index without replacing it or writing seeds', async () => {
    const management = new MemoryManagement();
    const data = new MemoryData();
    management.collections.set('users', [
      { name: 'openid_unique', unique: false, keys: [{ name: 'openid', direction: '1' }] },
    ]);
    await expect(initializeDatabase(target, management, data)).rejects.toThrow(
      'INDEX_DEFINITION_CONFLICT',
    );
    expect(management.collections.get('users')?.[0]?.unique).toBe(false);
    expect(data.records.size).toBe(0);
  });

  it('does not seed when rules fail', async () => {
    const management = new MemoryManagement();
    management.denyCollectionAccess = () => Promise.reject(new Error('rules unavailable'));
    const data = new MemoryData();
    await expect(initializeDatabase(target, management, data)).rejects.toThrow('rules unavailable');
    expect(data.records.size).toBe(0);
  });

  it.each(['prod', 'test', ''])('rejects stage %s before cloud operations', async (stage) => {
    const management = new MemoryManagement();
    await expect(
      initializeDatabase({ ...target, stage }, management, new MemoryData()),
    ).rejects.toThrow('DEV_ONLY');
    expect(management.events).toEqual([]);
  });

  it('rejects mismatched and aliased production environments', () => {
    expect(() => assertDevTarget({ ...target, environmentId: 'fictional-prod-env' })).toThrow(
      'DEV_ENVIRONMENT_MISMATCH',
    );
    expect(() =>
      assertDevTarget({ ...target, otherEnvironmentIds: [target.environmentId] }),
    ).toThrow('ENVIRONMENTS_NOT_ISOLATED');
  });

  it('uses the config storage envelope and never seeds users', () => {
    const seeds = developmentSeeds('server-time-placeholder');
    expect(seeds.some((seed) => seed.collection === 'users')).toBe(false);
    expect(seeds.find((seed) => seed.id === 'app:global')?.data).toMatchObject({
      key: 'app',
      value: {
        enableLetterImages: true,
        maxLetterImages: 3,
        enableComments: false,
        enablePayment: false,
        enablePrivateMessage: false,
      },
    });
  });

  it('preserves all existing config, school, user and business documents', async () => {
    const data = new MemoryData();
    await seedDevelopmentData(target, data);
    const configured = { key: 'app', value: { maintenanceMode: true } };
    data.records.set('system_configs/app:global', configured);
    data.records.set('schools/dev-school-shixue', { status: 'disabled', name: 'edited school' });
    data.records.set('letters/business-letter', {
      content: 'test business record',
      reviewStatus: 'draft',
    });
    data.user('user-1', 'fictional_openid_1', 'admin');
    const before = structuredClone(data.records);
    expect(await seedDevelopmentData(target, data)).toBe(0);
    expect(data.records).toEqual(before);
  });
});

describe('first super admin bootstrap', () => {
  it('rejects an absent user and never creates one', async () => {
    const data = new MemoryData();
    await expect(
      bootstrapSuperAdmin(target, 'fictional_openid_1', 'request-1', data),
    ).rejects.toThrow('EXISTING_USER_REQUIRED');
    expect(data.records.size).toBe(0);
  });

  it('grants once with a permanent atomic audit receipt and no raw OpenID', async () => {
    const data = new MemoryData();
    data.user();
    expect(await bootstrapSuperAdmin(target, 'fictional_openid_1', 'request-1', data)).toBe(
      'granted',
    );
    expect(await bootstrapSuperAdmin(target, 'fictional_openid_1', 'request-2', data)).toBe(
      'already-granted',
    );
    expect(data.records.get('users/user-1')).toMatchObject({
      role: 'super_admin',
      currentSchoolId: 'selected-school',
    });
    const receipt = data.records.get(`admin_logs/${BOOTSTRAP_RECEIPT_ID}`);
    expect(receipt).toMatchObject({
      requestId: 'request-1',
      targetId: 'user-1',
      after: { role: 'super_admin' },
    });
    expect(JSON.stringify(receipt)).not.toContain('fictional_openid_1');
    expect(data.records.size).toBe(2);
  });

  it('cannot promote another user or regrant revoked privileges after consumption', async () => {
    const data = new MemoryData();
    data.user();
    data.user('user-2', 'fictional_openid_2');
    await bootstrapSuperAdmin(target, 'fictional_openid_1', 'request-1', data);
    await expect(
      bootstrapSuperAdmin(target, 'fictional_openid_2', 'request-2', data),
    ).rejects.toThrow('BOOTSTRAP_ALREADY_CONSUMED');
    data.user(); // Simulate a later authorized revocation; keep the permanent receipt.
    await expect(
      bootstrapSuperAdmin(target, 'fictional_openid_1', 'request-3', data),
    ).rejects.toThrow('BOOTSTRAP_ALREADY_CONSUMED');
  });

  it('refuses any pre-existing super admin even without a bootstrap receipt', async () => {
    const data = new MemoryData();
    data.user();
    data.user('user-2', 'fictional_openid_2', 'super_admin');
    await expect(
      bootstrapSuperAdmin(target, 'fictional_openid_1', 'request-1', data),
    ).rejects.toThrow('FIRST_SUPER_ADMIN_ONLY');
    expect(data.records.get('users/user-1')?.role).toBe('user');
  });

  it('concurrent bootstrap candidates only promote one user', async () => {
    const data = new MemoryData();
    data.user();
    data.user('user-2', 'fictional_openid_2');
    const results = await Promise.allSettled([
      bootstrapSuperAdmin(target, 'fictional_openid_1', 'request-1', data),
      bootstrapSuperAdmin(target, 'fictional_openid_2', 'request-2', data),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await data.findUsers({ role: 'super_admin' })).toHaveLength(1);
  });

  it('rolls back role changes if the audit transaction cannot commit', async () => {
    const data = new MemoryData();
    data.user();
    data.beforeCommit = () => {
      throw new Error('commit failed');
    };
    await expect(
      bootstrapSuperAdmin(target, 'fictional_openid_1', 'request-1', data),
    ).rejects.toThrow('commit failed');
    expect(data.records.get('users/user-1')?.role).toBe('user');
    expect(data.records.has(`admin_logs/${BOOTSTRAP_RECEIPT_ID}`)).toBe(false);
  });

  it.each(['disabled', 'deleted'])('rejects %s users', async (status) => {
    const data = new MemoryData();
    data.user();
    const user = data.records.get('users/user-1');
    if (user) user.status = status;
    await expect(
      bootstrapSuperAdmin(target, 'fictional_openid_1', 'request-1', data),
    ).rejects.toThrow('ACTIVE_TRUSTED_USER_REQUIRED');
  });

  it.each([new Date('2026-09-15T00:00:00.000Z'), false, 0, ''])(
    'rejects every non-null soft-delete marker without granting: %j',
    async (deletedAt) => {
      const data = new MemoryData();
      data.user();
      const user = data.records.get('users/user-1');
      if (user) user.deletedAt = deletedAt;
      await expect(
        bootstrapSuperAdmin(target, 'fictional_openid_1', 'request-1', data),
      ).rejects.toThrow('ACTIVE_TRUSTED_USER_REQUIRED');
      expect(data.records.get('users/user-1')?.role).toBe('user');
      expect(data.records.has(`admin_logs/${BOOTSTRAP_RECEIPT_ID}`)).toBe(false);
    },
  );

  it('rejects production without searching users', async () => {
    const data = new MemoryData();
    data.findUsers = () => {
      throw new Error('must not contact cloud');
    };
    await expect(
      bootstrapSuperAdmin({ ...target, stage: 'prod' }, 'fictional_openid_1', 'request-1', data),
    ).rejects.toThrow('DEV_ONLY');
  });
});
