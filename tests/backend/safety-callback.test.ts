import { createCipheriv, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createSafetyCallback } from '../../cloudfunctions/_shared/safety-callback';
import type {
  MediaSafetyEvent,
  SafetyCallbackRequest,
} from '../../cloudfunctions/_shared/safety-callback';
import { createMediaSafetySink } from '../../cloudfunctions/_shared/safety-jobs';
import type {
  MediaSafetyJob,
  SafetyDraftSnapshot,
  SafetyJobStore,
} from '../../cloudfunctions/_shared/safety-jobs';

// Public documentation example credentials; never used as runtime defaults.
const config = { appId: 'wxba5fad812f8e6fb9', token: 'AAAAA', encodingAESKey: 'A'.repeat(43) };
const now = new Date('2026-09-16T06:00:00Z');
const timestamp = String(now.getTime() / 1000);
const nonce = '415670741';
function sign(...parts: string[]) {
  return createHash('sha1').update(parts.sort().join('')).digest('hex');
}
function payload() {
  return {
    MsgType: 'event',
    Event: 'wxa_media_check',
    appid: config.appId,
    version: 2,
    trace_id: 'trace-1',
    CreateTime: Number(timestamp),
    errcode: 0,
    result: { suggest: 'pass', label: 100 },
  };
}
function encrypt(value: unknown, appId = config.appId) {
  const message = Buffer.from(JSON.stringify(value));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(message.length);
  const plain = Buffer.concat([Buffer.alloc(16, 7), len, message, Buffer.from(appId)]);
  const pad = 32 - (plain.length % 32);
  const key = Buffer.alloc(32);
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([
    cipher.update(Buffer.concat([plain, Buffer.alloc(pad, pad)])),
    cipher.final(),
  ]).toString('base64');
}
function request(value: unknown = payload(), appId = config.appId): SafetyCallbackRequest {
  const Encrypt = encrypt(value, appId);
  return {
    method: 'POST',
    query: {
      timestamp,
      nonce,
      encrypt_type: 'aes',
      msg_signature: sign(config.token, timestamp, nonce, Encrypt),
    },
    body: JSON.stringify({ Encrypt }),
  };
}
function setup() {
  const accept = vi.fn(async (_event: MediaSafetyEvent) => undefined);
  return { accept, handle: createSafetyCallback(config, { accept }, () => now) };
}
describe('encrypted WeChat media callback', () => {
  it('validates the official URL challenge signature vector', async () => {
    const accept = vi.fn();
    const handle = createSafetyCallback(config, { accept }, () => new Date(1714036504000));
    expect(
      await handle({
        method: 'GET',
        query: {
          timestamp: '1714036504',
          nonce: '1514711492',
          signature: 'f464b24fc39322e44b38aa78f5edd27bd1441696',
          echostr: '4375120948345356249',
        },
      }),
    ).toEqual({ statusCode: 200, body: '4375120948345356249' });
    expect(accept).not.toHaveBeenCalled();
  });
  it('verifies, decrypts and strips nonessential fields', async () => {
    const { handle, accept } = setup();
    expect(
      await handle(
        request({ ...payload(), keyword: 'private words', openid: 'not authoritative' }),
      ),
    ).toEqual({ statusCode: 200, body: 'success' });
    expect(accept).toHaveBeenCalledWith({
      appId: config.appId,
      traceId: 'trace-1',
      createdAt: now,
      result: {
        provider: 'wechat-v2',
        checkedAt: now,
        traceIds: ['trace-1'],
        labels: [100],
        decision: 'pass',
        status: 'complete',
      },
    });
  });
  it.each([
    ['risky', 'reject'],
    ['review', 'review'],
  ])('maps %s to %s', async (suggest, decision) => {
    const { handle, accept } = setup();
    await handle(request({ ...payload(), result: { suggest, label: 20006 } }));
    expect(accept.mock.calls[0]?.[0].result.decision).toBe(decision);
  });
  it('records download errors as unavailable rather than pass', async () => {
    const { handle, accept } = setup();
    await handle(request({ ...payload(), errcode: -1008 }));
    expect(accept.mock.calls[0]?.[0].result.status).toBe('unavailable');
  });
  it.each([
    { ...payload(), appid: 'wx0000000000000000' },
    { ...payload(), version: 1 },
    { ...payload(), Event: 'debug_demo' },
    { ...payload(), result: { suggest: 'unknown', label: 100 } },
    { ...payload(), detail: [{ errcode: -1, suggest: 'pass', label: 100 }] },
  ])('rejects malformed or wrong-domain event %#', async (body) => {
    const { handle, accept } = setup();
    expect((await handle(request(body))).statusCode).toBe(403);
    expect(accept).not.toHaveBeenCalled();
  });
  it('rejects an encrypted trailer for another AppID', async () => {
    const { handle, accept } = setup();
    expect((await handle(request(payload(), 'wx0000000000000000'))).statusCode).toBe(403);
    expect(accept).not.toHaveBeenCalled();
  });
  it.each([
    { timestamp, nonce, encrypt_type: 'aes', msg_signature: '0'.repeat(40) },
    { timestamp, nonce, encrypt_type: 'raw' },
    {
      timestamp: String(Number(timestamp) - 301),
      nonce,
      encrypt_type: 'aes',
      msg_signature: '0'.repeat(40),
    },
    { timestamp: [timestamp], nonce },
  ])('rejects forged, expired, plaintext or duplicate query fields %#', async (query) => {
    const { handle, accept } = setup();
    expect((await handle({ ...request(), query })).statusCode).toBe(403);
    expect(accept).not.toHaveBeenCalled();
  });
  it('never accepts the ordinary signature in place of the body signature', async () => {
    const { handle, accept } = setup();
    expect(
      (
        await handle({
          ...request(),
          query: {
            timestamp,
            nonce,
            encrypt_type: 'aes',
            signature: sign(config.token, timestamp, nonce),
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(accept).not.toHaveBeenCalled();
  });
  it('returns retry when storage fails, without leaking errors', async () => {
    const { handle, accept } = setup();
    accept.mockRejectedValue(new Error('private database failure'));
    expect(await handle(request())).toEqual({ statusCode: 503, body: 'retry' });
  });
  it('rejects oversized bodies', async () => {
    const { handle } = setup();
    expect((await handle({ ...request(), body: ' '.repeat(65537) })).statusCode).toBe(403);
  });
  it('fails closed on missing configuration', () => {
    expect(() => createSafetyCallback({ ...config, token: '' }, { accept: vi.fn() })).toThrow(
      'configuration',
    );
  });
});

function jobFixture() {
  let job: MediaSafetyJob | undefined = {
    appId: config.appId,
    traceId: 'trace-1',
    authorId: 'author-1',
    letterId: 'letter-1',
    revision: 1,
    contentHash: 'a'.repeat(64),
    fileId: 'cloud://image',
    requestedAt: new Date(now.getTime() - 1000),
    expiresAt: new Date(now.getTime() + 1800000),
  };
  let draft: SafetyDraftSnapshot = {
    authorId: 'author-1',
    revision: 1,
    contentHash: 'a'.repeat(64),
    imageFileIds: ['cloud://image'],
    reviewStatus: 'draft',
    deleted: false,
  };
  const save = vi.fn(async (value: MediaSafetyJob) => {
    job = structuredClone(value);
  });
  // Serial transaction fixture. The production implementation must enforce equivalent isolation.
  let tail = Promise.resolve();
  const store: SafetyJobStore = {
    runTransaction(work) {
      const task = tail.then(() =>
        work({ findJob: async () => job, findDraft: async () => draft, saveJob: save }),
      );
      tail = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
  };
  const handle = createSafetyCallback(config, createMediaSafetySink(store), () => now);
  return {
    handle,
    save,
    getJob: () => job,
    patch: (change: Partial<SafetyDraftSnapshot>) => {
      draft = { ...draft, ...change };
    },
    clear: () => {
      job = undefined;
    },
    expire: () => {
      if (job) job.expiresAt = new Date(now.getTime() - 1);
    },
  };
}
describe('image result binding and idempotency', () => {
  it('persists only the matching job and never changes letter state', async () => {
    const { handle, save, getJob } = jobFixture();
    expect((await handle(request())).statusCode).toBe(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(getJob()?.result?.decision).toBe('pass');
    expect(getJob()).not.toHaveProperty('reviewStatus');
  });
  it('concurrent duplicates write exactly once', async () => {
    const { handle, save } = jobFixture();
    const responses = await Promise.all([handle(request()), handle(request())]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('rejects conflicting replay without replacing the first result', async () => {
    const { handle, save } = jobFixture();
    await handle(request());
    expect(
      (await handle(request({ ...payload(), result: { suggest: 'risky', label: 20006 } })))
        .statusCode,
    ).toBe(503);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it.each([
    { revision: 2 },
    { authorId: 'other' },
    { contentHash: 'b'.repeat(64) },
    { imageFileIds: [] },
    { deleted: true },
    { reviewStatus: 'approved' },
  ])('ignores stale or no longer applicable callback %#', async (change) => {
    const { handle, save, patch } = jobFixture();
    patch(change);
    expect((await handle(request())).statusCode).toBe(200);
    expect(save).not.toHaveBeenCalled();
  });
  it('retries early callbacks until trace receipt is persisted', async () => {
    const { handle, clear } = jobFixture();
    clear();
    expect((await handle(request())).statusCode).toBe(503);
  });
  it('ignores expired jobs', async () => {
    const { handle, expire, save } = jobFixture();
    expire();
    expect((await handle(request())).statusCode).toBe(200);
    expect(save).not.toHaveBeenCalled();
  });
});
