import { describe, expect, it, vi } from 'vitest';
import { createImageSafetyCoordinator } from '../../cloudfunctions/_shared/safety-submission';
import {
  CloudImageCheckStore,
  parseImageCheckRequest,
} from '../../cloudfunctions/_shared/safety-submission-db';
import { CloudSafetyJobStore } from '../../cloudfunctions/_shared/safety-jobs-db';
import { createMediaSafetySink } from '../../cloudfunctions/_shared/safety-jobs';
import { assertSafetyQueueAdmission } from '../../cloudfunctions/_shared/content-safety';
import type { SafetyResult } from '../../cloudfunctions/_shared/content-safety';
import type { CloudDatabasePort } from '../../cloudfunctions/_shared/db';
import { isRecord } from '../../shared';

const appId = 'wx0000000000000000';
const input = {
  authorId: 'author',
  openid: 'private_openid',
  letterId: 'letter',
  revision: 1,
  contentHash: 'a'.repeat(64),
  imageFileIds: ['cloud://private/image-1'],
};
function setup() {
  let time = new Date('2026-09-16T00:00:00Z');
  let sequence = 0,
    failCommit = false,
    failRequestWrite = false;
  const records = new Map<string, unknown>();
  const draft = {
    _id: 'letter',
    authorId: input.authorId,
    revision: 1,
    contentHash: input.contentHash,
    imageFileIds: input.imageFileIds,
    reviewStatus: 'draft',
    deletedAt: null,
  };
  records.set('letters/letter', draft);
  let tail = Promise.resolve();
  const db: CloudDatabasePort = {
    collection: () => {
      throw new Error('Transaction required');
    },
    runTransaction(work) {
      const task = tail.then(async () => {
        const pending = structuredClone(records);
        const result = await work({
          collection(name: string) {
            return {
              doc(id: string) {
                return {
                  get: async () => ({ data: pending.get(`${name}/${id}`) ?? null }),
                  update: async ({ data }: { data: object }) => {
                    if (failRequestWrite && name === 'media_safety_submissions')
                      return { stats: { updated: 0 } };
                    pending.set(`${name}/${id}`, { _id: id, ...data });
                    return { stats: { updated: 1 } };
                  },
                };
              },
              add: async ({ data }: { data: { _id: string } }) => {
                if (pending.has(`${name}/${data._id}`)) throw new Error('duplicate');
                pending.set(`${name}/${data._id}`, data);
                return { _id: data._id };
              },
            };
          },
        });
        if (failCommit) return undefined;
        records.clear();
        for (const [k, v] of pending) records.set(k, v);
        return result;
      });
      tail = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
  };
  const checkImage = vi.fn(async (): Promise<SafetyResult> => ({
    provider: 'wechat-v2',
    decision: 'review',
    status: 'pending',
    checkedAt: time,
    labels: [],
    traceIds: [`trace-${++sequence}`],
  }));
  const coordinator = createImageSafetyCoordinator({
    appId,
    store: new CloudImageCheckStore(() => db),
    safety: { checkImage, checkText: vi.fn() },
    now: () => time,
  });
  const sink = createMediaSafetySink(new CloudSafetyJobStore(() => db));
  return {
    records,
    checkImage,
    check: () => coordinator.check(input),
    coordinator,
    advance: (ms: number) => {
      time = new Date(time.getTime() + ms);
    },
    patch: (change: object) => records.set('letters/letter', { ...draft, ...change }),
    failCommit: () => {
      failCommit = true;
    },
    failRequestWrite: () => {
      failRequestWrite = true;
    },
    async callback(decision: SafetyResult['decision'] = 'pass', traceId = 'trace-1') {
      await sink.accept({
        appId,
        traceId,
        createdAt: time,
        result: {
          provider: 'wechat-v2',
          decision,
          status: 'complete',
          checkedAt: time,
          labels: [decision === 'reject' ? 20006 : 100],
          traceIds: [traceId],
        },
      });
    },
  };
}

describe('durable image safety submission coordination', () => {
  it('registers the receipt atomically, resumes after callback, never changes review state', async () => {
    const f = setup();
    const waiting = await f.check();
    expect(waiting[0]?.status).toBe('pending');
    expect(() => assertSafetyQueueAdmission(waiting)).toThrow();
    await f.check();
    expect(f.checkImage).toHaveBeenCalledTimes(1);
    await f.callback();
    const finished = await f.check();
    expect(finished[0]?.decision).toBe('pass');
    expect(() => assertSafetyQueueAdmission(finished)).not.toThrow();
    expect(f.checkImage).toHaveBeenCalledTimes(1);
    expect(f.records.get('letters/letter')).toMatchObject({ reviewStatus: 'draft' });
    for (const [key, value] of f.records)
      if (key !== 'letters/letter') expect(JSON.stringify(value)).not.toContain(input.openid);
  });
  it('serializes concurrent callers without repeating external image checks', async () => {
    const f = setup();
    await Promise.all([f.check(), f.check(), f.check()]);
    expect(f.checkImage).toHaveBeenCalledTimes(1);
  });
  it('retains rejection rather than re-requesting a more favorable verdict', async () => {
    const f = setup();
    await f.check();
    await f.callback('reject');
    expect(() => assertSafetyQueueAdmission([])).toThrow();
    const result = await f.check();
    expect(result[0]?.decision).toBe('reject');
    expect(() => assertSafetyQueueAdmission(result)).toThrow();
    f.advance(31 * 60000);
    expect((await f.check())[0]?.decision).toBe('reject');
    expect(f.checkImage).toHaveBeenCalledTimes(1);
  });
  it('waits for every image, not just the first callback', async () => {
    const f = setup();
    const value = { ...input, imageFileIds: [...input.imageFileIds, 'cloud://private/image-2'] };
    f.patch({ imageFileIds: value.imageFileIds });
    await f.coordinator.check(value);
    await f.callback();
    expect((await f.coordinator.check(value)).map((v) => v.status)).toEqual([
      'complete',
      'pending',
    ]);
    await f.callback('review', 'trace-2');
    expect((await f.coordinator.check(value)).map((v) => v.decision)).toEqual(['pass', 'review']);
  });
  it.each([
    { revision: 2 },
    { authorId: 'other' },
    { contentHash: 'b'.repeat(64) },
    { imageFileIds: [] },
    { deletedAt: new Date() },
    { reviewStatus: 'approved' },
  ])('rejects changed draft before any request %#', async (change) => {
    const f = setup();
    f.patch(change);
    await expect(f.check()).rejects.toMatchObject({ code: 'LETTER_STATE_CONFLICT' });
    expect(f.checkImage).not.toHaveBeenCalled();
  });
  it('cannot attach a receipt when the draft changes during the network await', async () => {
    const f = setup();
    f.checkImage.mockImplementationOnce(async () => {
      f.patch({ revision: 2 });
      return {
        provider: 'wechat-v2',
        decision: 'review',
        status: 'pending',
        checkedAt: new Date(),
        labels: [],
        traceIds: ['late'],
      };
    });
    await expect(f.check()).rejects.toMatchObject({ code: 'LETTER_STATE_CONFLICT' });
    expect([...f.records.keys()].filter((k) => k.startsWith('media_safety_jobs/'))).toHaveLength(0);
  });
  it.each(['complete', 'unavailable'] as const)(
    'does not trust direct %s image response',
    async (status) => {
      const f = setup();
      f.checkImage.mockResolvedValue({
        provider: 'wechat-v2',
        decision: 'pass',
        status,
        checkedAt: new Date(),
        traceIds: ['forged'],
        labels: [],
      });
      expect((await f.check())[0]?.status).toBe('unavailable');
      expect((await f.check())[0]?.status).toBe('unavailable');
      expect(f.checkImage).toHaveBeenCalledTimes(1);
      f.advance(60001);
      await f.check();
      expect(f.checkImage).toHaveBeenCalledTimes(2);
    },
  );
  it('backs off provider failures without exposing private errors', async () => {
    const f = setup();
    f.checkImage.mockRejectedValue(new Error('private credential'));
    const result = await f.check();
    await f.check();
    expect(result[0]?.status).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('private credential');
    expect(f.checkImage).toHaveBeenCalledTimes(1);
  });
  it('does not accept a late response after its request lease expired', async () => {
    const f = setup();
    f.checkImage.mockImplementationOnce(async () => {
      f.advance(60001);
      return {
        provider: 'wechat-v2',
        decision: 'review',
        status: 'pending',
        checkedAt: new Date(),
        traceIds: ['late'],
        labels: [],
      };
    });
    expect((await f.check())[0]?.status).toBe('unavailable');
    expect([...f.records.keys()].some((k) => k.startsWith('media_safety_jobs/'))).toBe(false);
    expect((await f.check())[0]?.status).toBe('pending');
  });
  it('starts a fresh attempt for expired pending checks and ignores old callbacks', async () => {
    const f = setup();
    await f.check();
    f.advance(30 * 60000 + 1);
    expect((await f.check())[0]?.status).toBe('pending');
    await f.callback('pass', 'trace-1');
    expect((await f.check())[0]?.status).toBe('pending');
    await f.callback('pass', 'trace-2');
    expect((await f.check())[0]?.decision).toBe('pass');
    expect(f.checkImage).toHaveBeenCalledTimes(2);
  });
  it('refuses conflicting trace reuse across images', async () => {
    const f = setup();
    const value = { ...input, imageFileIds: [...input.imageFileIds, 'cloud://private/image-2'] };
    f.patch({ imageFileIds: value.imageFileIds });
    f.checkImage.mockResolvedValue({
      provider: 'wechat-v2',
      decision: 'review',
      status: 'pending',
      checkedAt: new Date(),
      labels: [],
      traceIds: ['same-trace'],
    });
    await expect(f.coordinator.check(value)).rejects.toMatchObject({
      code: 'CONTENT_CHECK_UNAVAILABLE',
    });
  });
  it('requires database commit acknowledgement before calling the provider', async () => {
    const f = setup();
    f.failCommit();
    await expect(f.check()).rejects.toThrow('not acknowledged');
    expect(f.checkImage).not.toHaveBeenCalled();
    expect(f.records.size).toBe(1);
  });
  it('rolls back job registration when updating its selected receipt fails', async () => {
    const f = setup();
    f.failRequestWrite();
    await expect(f.check()).rejects.toThrow('not acknowledged');
    expect([...f.records.keys()].some((k) => k.startsWith('media_safety_jobs/'))).toBe(false);
    expect((await f.check())[0]?.status).toBe('pending');
    expect(f.checkImage).toHaveBeenCalledTimes(1);
  });
  it.each(
    [
      [],
      ['https://attacker.test/image'],
      ['cloud://same', 'cloud://same'],
      ['cloud://1', 'cloud://2', 'cloud://3', 'cloud://4'],
    ].map((imageFileIds) => ({ imageFileIds })),
  )('rejects invalid image sets %#', async ({ imageFileIds }) => {
    const f = setup();
    await expect(f.coordinator.check({ ...input, imageFileIds })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(f.checkImage).not.toHaveBeenCalled();
  });
  it('validates durable reservation identity, dates and fields', async () => {
    const f = setup();
    await f.check();
    const row = [...f.records.entries()].find(([k]) =>
      k.startsWith('media_safety_submissions/'),
    )?.[1];
    expect(parseImageCheckRequest(row).traceId).toBe('trace-1');
    if (!isRecord(row)) throw Error('missing record');
    for (const change of [
      { _id: 'forged' },
      { revision: 0 },
      { leaseUntil: 'bad' },
      { contentHash: 'bad' },
      { failed: true },
      { fileId: 'https://bad' },
    ])
      expect(() => parseImageCheckRequest({ ...row, ...change })).toThrow();
  });
});
