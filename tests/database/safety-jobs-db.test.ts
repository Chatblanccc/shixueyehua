import { describe, expect, it, vi } from 'vitest';
import {
  CloudSafetyJobStore,
  parseSafetyJob,
  safetyJobId,
} from '../../cloudfunctions/_shared/safety-jobs-db';
import { createSafetyHttpHandler } from '../../cloudfunctions/_shared/safety-http';
import { createRuntimeSafetyCallback } from '../../cloudfunctions/_shared/runtime';
import type { CloudDatabasePort } from '../../cloudfunctions/_shared/db';
import type { MediaSafetyJob } from '../../cloudfunctions/_shared/safety-jobs';

const job: MediaSafetyJob = {
  appId: 'wx0000000000000000',
  traceId: 'trace-1',
  authorId: 'user-1',
  letterId: 'letter-1',
  revision: 1,
  contentHash: 'a'.repeat(64),
  fileId: 'cloud://image',
  requestedAt: new Date('2026-09-16T00:00:00Z'),
  expiresAt: new Date('2026-09-16T01:00:00Z'),
};
function fixture() {
  const records = new Map<string, unknown>();
  const updated = vi.fn();
  let failCommit = false,
    failWrite = false;
  const database: CloudDatabasePort = {
    collection: () => {
      throw new Error('Must use transaction');
    },
    async runTransaction(work) {
      const pending = new Map(records);
      const result = await work({
        collection(name: string) {
          return {
            doc(id: string) {
              return {
                get: async () => ({ data: pending.get(`${name}/${id}`) ?? null }),
                update: async ({ data }: { data: object }) => {
                  if (failWrite) return { stats: { updated: 0 } };
                  pending.set(`${name}/${id}`, { _id: id, ...data });
                  updated();
                  return { stats: { updated: 1 } };
                },
              };
            },
            add: async ({ data }: { data: { _id: string } }) => {
              pending.set(`${name}/${data._id}`, data);
              return { _id: data._id };
            },
          };
        },
      });
      if (failCommit) return undefined;
      for (const [key, value] of pending) records.set(key, value);
      return result;
    },
  };
  return {
    store: new CloudSafetyJobStore(() => database),
    records,
    updated,
    failCommit: () => {
      failCommit = true;
    },
    failWrite: () => {
      failWrite = true;
    },
  };
}
describe('durable media safety job storage', () => {
  it('registers idempotently using deterministic app/trace identity', async () => {
    const { store, records } = fixture();
    await store.register(job);
    await store.register(job);
    expect(records.size).toBe(1);
    expect(await store.runTransaction((tx) => tx.findJob(job.appId, job.traceId))).toMatchObject(
      job,
    );
    expect(safetyJobId('ab', 'c')).not.toBe(safetyJobId('a', 'bc'));
  });
  it('refuses rebind, lifetime extension and preapproved registration', async () => {
    const { store } = fixture();
    await store.register(job);
    await expect(store.register({ ...job, authorId: 'other' })).rejects.toThrow('rebind');
    await expect(store.register({ ...job, expiresAt: new Date('2026-09-17') })).rejects.toThrow(
      'extend',
    );
    await expect(store.register({ ...job, callbackHash: 'a'.repeat(64) })).rejects.toThrow(
      'pre-approved',
    );
  });
  it('reads the exact draft snapshot in the transaction', async () => {
    const { store, records } = fixture();
    records.set('letters/letter-1', {
      _id: 'letter-1',
      authorId: 'user-1',
      revision: 1,
      contentHash: job.contentHash,
      imageFileIds: [job.fileId],
      reviewStatus: 'draft',
      deletedAt: null,
    });
    expect(await store.runTransaction((tx) => tx.findDraft('letter-1'))).toMatchObject({
      authorId: 'user-1',
      revision: 1,
      deleted: false,
    });
  });
  it('persists only acknowledged result updates', async () => {
    const { store, updated } = fixture();
    await store.register(job);
    await store.runTransaction((tx) =>
      tx.saveJob({
        ...job,
        callbackHash: 'b'.repeat(64),
        result: {
          provider: 'wechat-v2',
          decision: 'pass',
          status: 'complete',
          checkedAt: job.requestedAt,
          traceIds: [job.traceId],
          labels: [100],
        },
      }),
    );
    expect(updated).toHaveBeenCalledTimes(1);
  });
  it('rejects missing commit receipts and does not persist registration', async () => {
    const { store, failCommit, records } = fixture();
    failCommit();
    await expect(store.register(job)).rejects.toThrow('not acknowledged');
    await expect(store.runTransaction(async () => true)).rejects.toThrow('not acknowledged');
    expect(records.size).toBe(0);
  });
  it('rejects missing update receipts', async () => {
    const { store, failWrite } = fixture();
    await store.register(job);
    failWrite();
    await expect(store.runTransaction((tx) => tx.saveJob(job))).rejects.toThrow('not acknowledged');
  });
  it.each([
    { revision: 0 },
    { contentHash: '' },
    { expiresAt: '2026-09-16' },
    { callbackHash: 'a'.repeat(64) },
    { _id: 'wrong' },
  ])('rejects corrupt persisted job %#', (change) => {
    expect(() =>
      parseSafetyJob({ ...job, _id: safetyJobId(job.appId, job.traceId), ...change }),
    ).toThrow();
  });
});
describe('HTTP callback boundary', () => {
  it('does not trust source headers or payload-supplied configuration', async () => {
    const accept = vi.fn();
    const handle = createSafetyHttpHandler(() => ({ appId: '', token: '', encodingAESKey: '' }), {
      accept,
    });
    expect(
      await handle({
        httpMethod: 'POST',
        queryStringParameters: {},
        body: '{}',
        headers: { 'x-wx-source': 'trusted' },
        token: 'forged',
      }),
    ).toEqual({ statusCode: 503, body: 'unavailable' });
    expect(accept).not.toHaveBeenCalled();
  });
  it('rejects unsupported gateway encodings', async () => {
    const handle = createSafetyHttpHandler(
      () => {
        throw new Error('Not called');
      },
      { accept: vi.fn() },
    );
    expect(
      (await handle({ httpMethod: 'POST', isBase64Encoded: true, body: 'e30=' })).statusCode,
    ).toBe(400);
  });
  it('runtime remains lazy and fails closed when credentials are absent', async () => {
    vi.stubEnv('SHIXUE_CALLBACK_APP_ID', '');
    vi.stubEnv('SHIXUE_CALLBACK_TOKEN', '');
    vi.stubEnv('SHIXUE_CALLBACK_AES_KEY', '');
    try {
      expect(await createRuntimeSafetyCallback()({ httpMethod: 'POST', body: '{}' })).toEqual({
        statusCode: 503,
        body: 'unavailable',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
