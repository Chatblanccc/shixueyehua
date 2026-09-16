import { afterEach, describe, expect, it, vi } from 'vitest';
import cloud from 'wx-server-sdk';
import { cloudPermissions } from '../../scripts/cloud-permissions';
import {
  assertSafetyQueueAdmission,
  createContentSafety,
  publicSafetyFeedback,
  safetyChecksPassed,
  safetyTextChunks,
} from '../../cloudfunctions/_shared/content-safety';
import { createWechatSafetyPlatform } from '../../cloudfunctions/_shared/wechat-content-safety';
import type { ResolvedSafetyImage } from '../../cloudfunctions/_shared/content-safety';

const actor = { openid: 'trusted_openid' };
const input = {
  title: '一封家书',
  content: '感谢你一直以来的关心和鼓励，希望未来我们都能成为更好的自己。',
};
const now = new Date('2026-09-16T04:00:00Z');
function response(suggest = 'pass', label = 100): unknown {
  return { errCode: 0, traceId: 'trace-1', result: { suggest, label } };
}
function setup() {
  const platform = {
    text: vi.fn(async (): Promise<unknown> => response()),
    image: vi.fn(async (): Promise<unknown> => ({ errCode: 0, traceId: 'image-1' })),
  };
  const resolveImage = vi.fn(async (): Promise<ResolvedSafetyImage> => ({
    url: 'https://storage.example.test/immutable.jpg?signature=private',
    size: 100,
    mimeType: 'image/jpeg',
  }));
  const safety = createContentSafety({ platform, resolveImage, now: () => now, timeoutMs: 100 });
  return { safety, platform, resolveImage };
}
afterEach(() => vi.useRealTimers());

describe('TASK-600 content safety', () => {
  it.each([
    ['pass', 'pass'],
    ['review', 'review'],
    ['risky', 'reject'],
  ])('maps %s to %s', async (suggest, decision) => {
    const { safety, platform } = setup();
    platform.text.mockResolvedValue(response(suggest));
    const result = await safety.checkText(actor, input);
    expect(result).toMatchObject({
      decision,
      status: 'complete',
      checkedAt: now,
      provider: 'wechat-v2',
      traceIds: ['trace-1'],
    });
    expect(platform.text).toHaveBeenCalledWith({
      ...input,
      openid: actor.openid,
      scene: 3,
      version: 2,
    });
    expect(safetyChecksPassed([result])).toBe(decision === 'pass');
  });
  it('accepts official snake-case receipts', async () => {
    const { safety, platform } = setup();
    platform.text.mockResolvedValue({
      errcode: 0,
      trace_id: 'snake-1',
      result: { suggest: 'pass', label: 100 },
    });
    expect(await safety.checkText(actor, input)).toMatchObject({
      status: 'complete',
      decision: 'pass',
    });
  });
  it.each([
    null,
    {},
    { errCode: 0 },
    { errCode: 0, traceId: 'trace-1' },
    { errCode: 0, errcode: -1, traceId: 'trace-1', result: { suggest: 'pass', label: 100 } },
    { errCode: 0, traceId: 'a', trace_id: 'b', result: { suggest: 'pass', label: 100 } },
    { errCode: 0, traceId: 'trace-1', result: { suggest: 'unknown', label: 100 } },
    { errCode: 0, traceId: 'trace-1', result: { suggest: 'pass', label: '100' } },
    { errCode: 0, traceId: 'trace-1', result: { suggest: 'pass', label: 100 }, detail: [{}] },
    { errCode: 0, traceId: 'trace-1', result: { suggest: 'pass', label: 100 }, detail: 'pass' },
  ])('fails closed on malformed result %#', async (raw) => {
    const { safety, platform } = setup();
    platform.text.mockResolvedValue(raw);
    const result = await safety.checkText(actor, input);
    expect(result.status).toBe('unavailable');
    expect(() => assertSafetyQueueAdmission([result])).toThrow('暂时无法完成内容检查');
    expect(safetyChecksPassed([result])).toBe(false);
  });
  it('checks all 3000 Unicode characters with overlapping chunks and repeated title', async () => {
    const { safety, platform } = setup();
    const content = '😀'.repeat(2400) + '末'.repeat(600);
    const chunks = safetyTextChunks(content);
    expect(chunks.map((s) => Array.from(s).length)).toEqual([2400, 700]);
    expect(
      chunks[0] +
        Array.from(chunks[1] ?? '')
          .slice(100)
          .join(''),
    ).toBe(content);
    platform.text.mockResolvedValueOnce(response()).mockResolvedValueOnce(response('risky', 20006));
    expect(await safety.checkText(actor, { ...input, content })).toMatchObject({
      decision: 'reject',
      status: 'complete',
    });
    expect(platform.text).toHaveBeenCalledTimes(2);
    expect(platform.text.mock.calls[1]).toEqual([
      { ...input, content: chunks[1], openid: actor.openid, scene: 3, version: 2 },
    ]);
  });
  it('does not downgrade detail risk when aggregate is pass', async () => {
    const { safety, platform } = setup();
    platform.text.mockResolvedValue({
      errCode: 0,
      traceId: 'trace-1',
      result: { suggest: 'pass', label: 100 },
      detail: [{ errCode: 0, suggest: 'risky', label: 20006, keyword: 'private words' }],
    });
    const result = await safety.checkText(actor, input);
    expect(result).toMatchObject({ decision: 'reject', labels: [100, 20006] });
    expect(JSON.stringify(result)).not.toContain('private words');
  });
  it('does not leak exceptions and only permits explicit manual queue fallback', async () => {
    const { safety, platform } = setup();
    platform.text.mockRejectedValue(new Error('secret credentials and family text'));
    const result = await safety.checkText(actor, input);
    expect(result.status).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(() => assertSafetyQueueAdmission([result])).toThrow();
    expect(() => assertSafetyQueueAdmission([result], 'manual_review')).not.toThrow();
    expect(safetyChecksPassed([result])).toBe(false);
    expect(() => assertSafetyQueueAdmission([])).toThrow();
    expect(safetyChecksPassed([])).toBe(false);
  });
  it('bounds time and ignores a late response without sending the next chunk', async () => {
    vi.useFakeTimers();
    const { safety, platform } = setup();
    let resolve!: (value: unknown) => void;
    platform.text.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const waiting = safety.checkText(actor, { ...input, content: '字'.repeat(3000) });
    await vi.advanceTimersByTimeAsync(101);
    const result = await waiting;
    expect(result).toMatchObject({ decision: 'review', status: 'unavailable', labels: [] });
    resolve(response('pass'));
    await vi.advanceTimersByTimeAsync(1);
    expect(platform.text).toHaveBeenCalledTimes(1);
    expect(result.labels).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('marks accepted image jobs pending even if the receipt contains a pass result', async () => {
    const { safety, platform, resolveImage } = setup();
    platform.image.mockResolvedValue(response());
    const result = await safety.checkImage(actor, 'cloud://private/letter.jpg');
    expect(resolveImage).toHaveBeenCalledWith(actor, 'cloud://private/letter.jpg');
    expect(platform.image).toHaveBeenCalledWith({
      openid: actor.openid,
      version: 2,
      scene: 3,
      mediaType: 2,
      mediaUrl: 'https://storage.example.test/immutable.jpg?signature=private',
    });
    expect(result).toMatchObject({ decision: 'review', status: 'pending' });
    expect(() => assertSafetyQueueAdmission([result], 'manual_review')).toThrow('图片正在检查中');
    expect(safetyChecksPassed([result])).toBe(false);
  });
  it('refuses image calls without an ownership resolver', async () => {
    const { platform } = setup();
    const safety = createContentSafety({ platform });
    expect(await safety.checkImage(actor, 'cloud://private/letter.jpg')).toMatchObject({
      status: 'unavailable',
    });
    expect(platform.image).not.toHaveBeenCalled();
  });
  it.each([{ errCode: -1 }, { errCode: 0 }, { errCode: 0, traceId: '' }])(
    'keeps invalid image receipt unavailable %#',
    async (raw) => {
      const { safety, platform } = setup();
      platform.image.mockResolvedValue(raw);
      expect(await safety.checkImage(actor, 'cloud://private/letter.jpg')).toMatchObject({
        status: 'unavailable',
      });
    },
  );
  it('does not send image jobs after ownership lookup times out', async () => {
    vi.useFakeTimers();
    const { safety, platform, resolveImage } = setup();
    let resolve!: (image: ResolvedSafetyImage) => void;
    resolveImage.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const waiting = safety.checkImage(actor, 'cloud://private/letter.jpg');
    await vi.advanceTimersByTimeAsync(101);
    expect(await waiting).toMatchObject({ status: 'unavailable' });
    resolve({ url: 'https://storage.example.test/image.jpg', size: 100, mimeType: 'image/jpeg' });
    await vi.advanceTimersByTimeAsync(1);
    expect(platform.image).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects oversized resolved images before platform transmission', async () => {
    const { safety, platform, resolveImage } = setup();
    resolveImage.mockResolvedValue({
      url: 'https://storage.example.test/image.jpg',
      size: 10 * 1024 * 1024 + 1,
      mimeType: 'image/jpeg',
    });
    expect(await safety.checkImage(actor, 'cloud://private/letter.jpg')).toMatchObject({
      status: 'unavailable',
    });
    expect(platform.image).not.toHaveBeenCalled();
  });
  it('does not call platform after denied ownership', async () => {
    const { safety, platform, resolveImage } = setup();
    resolveImage.mockRejectedValue(new Error('not your file'));
    expect(await safety.checkImage(actor, 'cloud://other/letter.jpg')).toMatchObject({
      status: 'unavailable',
    });
    expect(platform.image).not.toHaveBeenCalled();
  });
  it.each(['http://example.test/image.jpg', 'https://user:password@example.test/image.jpg'])(
    'refuses unsafe media URL %s',
    async (url) => {
      const { safety, platform, resolveImage } = setup();
      resolveImage.mockResolvedValue({ url, size: 100, mimeType: 'image/jpeg' });
      expect(await safety.checkImage(actor, 'cloud://private/letter.jpg')).toMatchObject({
        status: 'unavailable',
      });
      expect(platform.image).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid input before platform calls', async () => {
    const { safety, platform } = setup();
    await expect(safety.checkText({ openid: '' }, input)).rejects.toThrow('登录状态');
    await expect(safety.checkText(actor, { ...input, content: '字'.repeat(3001) })).rejects.toThrow(
      '请检查',
    );
    await expect(safety.checkImage(actor, 'https://untrusted.example/image.jpg')).rejects.toThrow(
      '请检查',
    );
    expect(platform.text).not.toHaveBeenCalled();
    expect(platform.image).not.toHaveBeenCalled();
  });
  it('projects only generic author feedback', async () => {
    const { safety, platform } = setup();
    platform.text.mockResolvedValue(response('risky', 20006));
    expect(publicSafetyFeedback(await safety.checkText(actor, input))).toEqual({
      decision: 'reject',
      status: 'complete',
      source: 'wechat',
      message: '内容暂时无法提交，请修改后重试',
    });
  });
});

describe('WeChat SDK boundary', () => {
  it('grants safety APIs only to the letter domain', () => {
    expect(cloudPermissions('letterApi')).toEqual([
      'security.msgSecCheck',
      'security.mediaCheckAsync',
    ]);
    for (const name of ['authApi', 'audioApi', 'adminAudioApi', 'adminApi', 'classApi', 'unknown'])
      expect(cloudPermissions(name)).toEqual([]);
  });
  it('supports the locked SDK callable proxy shape without calling cloud', () => {
    expect(typeof cloud.openapi).toBe('function');
    const security: unknown = Reflect.get(cloud.openapi, 'security');
    expect(typeof security).toBe('function');
  });
  it('invokes callable proxies with their receiver and narrow payload', async () => {
    const text = vi.fn(async () => response());
    const image = vi.fn(async () => response());
    const security = Object.assign(() => undefined, { msgSecCheck: text, mediaCheckAsync: image });
    const openapi = Object.assign(() => undefined, { security });
    const adapter = createWechatSafetyPlatform(() => openapi);
    await adapter.text({ ...input, openid: actor.openid, version: 2, scene: 3 });
    expect(text.mock.contexts[0]).toBe(security);
    await adapter.image({
      openid: actor.openid,
      version: 2,
      scene: 3,
      mediaType: 2,
      mediaUrl: 'https://example.test/image.jpg',
    });
    expect(image).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { security: {} }])('rejects unavailable SDK surfaces %#', async (api) => {
    const adapter = createWechatSafetyPlatform(() => api);
    await expect(
      adapter.text({ ...input, openid: actor.openid, version: 2, scene: 3 }),
    ).rejects.toThrow('Safety API unavailable');
  });
});
