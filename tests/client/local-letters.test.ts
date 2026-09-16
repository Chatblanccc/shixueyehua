import { describe, expect, it, vi, afterEach } from 'vitest';
import { LocalRepository } from '../../miniprogram/services/local-repository';
import { createCloudClient } from '../../miniprogram/services/cloud-client';
import { parseOwnLetter, parseOwnLetterPage, parseLoginResult, isRecord } from '../../shared';
import { readLetterEditor, saveLetterEditor } from '../../miniprogram/services/letter-editor-cache';
const fields = {
  title: '给未来的自己',
  content: '希望未来的你仍然保持好奇，珍惜陪伴我们的人，认真对待每一个平凡的日子。',
  recipientType: 'future_self' as const,
  visibility: 'private' as const,
  imageFileIds: [],
};
function setup() {
  let saved: unknown;
  const port = {
    read: () => structuredClone(saved),
    write: (v: unknown) => {
      saved = structuredClone(v);
    },
    now: () => Date.parse('2026-09-16T06:00:00Z'),
  };
  let repo = new LocalRepository(port);
  const call = createCloudClient((r) => repo.invoke(r));
  return {
    call,
    port,
    reopen: () => {
      repo = new LocalRepository(port);
    },
    data: () => saved,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('local text letter experience', () => {
  it('persists owned local attachments across reopening and submits them only in local mode', async () => {
    const { call, reopen } = setup();
    let d = await call('letterApi', 'createDraft', parseOwnLetter, {
      requestKey: 'images',
      ...fields,
    });
    const receipt = await call('letterApi', 'storeLocalImage', (v) => v, {
      letterId: d._id,
      revision: 1,
      localPath: 'http://store/saved-letter.png',
    });
    if (!isRecord(receipt)) throw Error('receipt');
    d = await call('letterApi', 'updateDraft', parseOwnLetter, {
      letterId: d._id,
      revision: 1,
      imageFileIds: [receipt.fileId],
    });
    reopen();
    expect(
      await call('letterApi', 'imageUrls', (v) => v, { letterId: d._id, fileIds: d.imageFileIds }),
    ).toEqual({ urls: ['http://store/saved-letter.png'] });
    expect(
      await call('letterApi', 'submit', parseOwnLetter, { letterId: d._id, revision: 2 }),
    ).toMatchObject({ reviewStatus: 'pending' });
    expect(d).not.toHaveProperty('images');
  });
  it('survives reopen, submits idempotently, withdraws, and deletes without touching audio', async () => {
    const { call, reopen } = setup();
    await call('authApi', 'login', parseLoginResult);
    const d = await call('letterApi', 'createDraft', parseOwnLetter, {
      requestKey: 'test',
      ...fields,
    });
    reopen();
    expect((await call('letterApi', 'listMine', parseOwnLetterPage, {})).items[0]).toEqual(d);
    const p = { letterId: d._id, revision: 1 };
    await call('letterApi', 'submit', parseOwnLetter, p);
    await call('letterApi', 'submit', parseOwnLetter, p);
    expect(await call('letterApi', 'withdraw', parseOwnLetter, p)).toMatchObject({
      revision: 2,
      reviewStatus: 'draft',
    });
    await call('letterApi', 'delete', parseOwnLetter, { ...p, revision: 2 });
    expect((await call('letterApi', 'listMine', parseOwnLetterPage, {})).items).toEqual([]);
  });
  it('rejects illegal state, image and privilege inputs', async () => {
    const { call } = setup();
    const d = await call('letterApi', 'createDraft', parseOwnLetter, {
      requestKey: 'test',
      ...fields,
    });
    const p = { letterId: d._id, revision: 1 };
    await call('letterApi', 'submit', parseOwnLetter, p);
    await expect(
      call('letterApi', 'updateDraft', parseOwnLetter, { ...p, title: '直接覆盖' }),
    ).rejects.toMatchObject({ code: 'LETTER_STATE_CONFLICT' });
    await expect(
      call('letterApi', 'createDraft', parseOwnLetter, {
        requestKey: 'image',
        ...fields,
        imageFileIds: ['cloud://unknown'],
      }),
    ).rejects.toMatchObject({ code: 'CONTENT_CHECK_UNAVAILABLE' });
    await expect(
      call('letterApi', 'createDraft', parseOwnLetter, { requestKey: 'forge', role: 'admin' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
  it('does not report success when storage fails', async () => {
    const { call, port } = setup();
    await call('authApi', 'login', parseLoginResult);
    port.write = () => {
      throw new Error('disk full');
    };
    await expect(
      call('letterApi', 'createDraft', parseOwnLetter, { requestKey: 'test', ...fields }),
    ).rejects.toThrow();
  });
  it('rejects contact information while retaining saved text', async () => {
    const { call } = setup();
    const d = await call('letterApi', 'createDraft', parseOwnLetter, {
      requestKey: 'test',
      ...fields,
      content: fields.content + ' www.example.com',
    });
    await expect(
      call('letterApi', 'submit', parseOwnLetter, { letterId: d._id, revision: 1 }),
    ).rejects.toMatchObject({ code: 'CONTENT_REJECTED' });
    expect(
      (await call('letterApi', 'detail', parseOwnLetter, { letterId: d._id })).reviewStatus,
    ).toBe('draft');
  });
  it('isolates unsaved editor caches by account and cloud/local mode', () => {
    const map = new Map<string, unknown>();
    let local = true;
    vi.stubGlobal('wx', {
      getStorageSync: (k: string) => (k === 'shixue-local-enabled-v1' ? local : map.get(k)),
      setStorageSync: (k: string, v: unknown) => map.set(k, v),
    });
    const cache = { letterId: '', revision: 0, requestKey: 'key', fields };
    saveLetterEditor('one', cache);
    expect(readLetterEditor('one')).toEqual(cache);
    expect(readLetterEditor('two')).toBeUndefined();
    local = false;
    expect(readLetterEditor('one')).toBeUndefined();
  });
});
