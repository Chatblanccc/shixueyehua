import { describe, expect, it, vi } from 'vitest';
import { createLetterImages } from '../../cloudfunctions/letterApi/images';
import { letterAction } from '../../cloudfunctions/letterApi/letters';
import { parseOwnLetter, isRecord } from '../../shared';
import { MemoryRepository, user, NOW } from './fixtures';
import type { AudioStoragePort } from '../../cloudfunctions/_shared/audio-storage-port';
import type { SafetyResult, ContentSafetyPort } from '../../cloudfunctions/_shared/content-safety';
const content = {
  title: '一封图文家书',
  content: '愿我们一直保持好奇与勇气，认真度过每一个普通而珍贵的日子。',
};
async function setup() {
  const actor = user({
    identity: 'parent',
    currentSchoolId: 'test_school_a',
    currentGradeId: 'test_grade_a',
    currentClassId: 'test_class_a',
  });
  const repo = new MemoryRepository([actor]);
  const result: SafetyResult = {
    provider: 'wechat-v2',
    status: 'complete',
    decision: 'pass',
    checkedAt: NOW,
    labels: [100],
    traceIds: ['text'],
  };
  const safety: ContentSafetyPort = { checkText: vi.fn(async () => result), checkImage: vi.fn() };
  const check = vi.fn(async () => [{ ...result, traceIds: ['image'] }]);
  const call = (action: string, payload: Record<string, unknown>) =>
    letterAction(repo, safety, actor.openid, action, payload, NOW, { check });
  const draft = parseOwnLetter(await call('createDraft', { requestKey: 'image-test', ...content }));
  const storage: AudioStoragePort = {
    prepare: vi.fn(async (path: string) => ({
      fileId: `cloud://env.bucket/${path}`,
      uploadUrl: 'https://bucket.myqcloud.com/upload',
      method: 'PUT' as const,
      headers: {},
      expiresAt: new Date(NOW.getTime() + 600000),
    })),
    inspectAndSeal: vi.fn(async (v: Parameters<AudioStoragePort['inspectAndSeal']>[0]) => ({
      fileId: `cloud://env.bucket/${v.finalPath}`,
      fileSize: v.expectedBytes,
      mimeType: 'image/png',
    })),
    temporaryUrl: vi.fn(async () => 'https://bucket.myqcloud.com/image'),
    deleteFiles: vi.fn(async () => undefined),
  };
  const images = createLetterImages(repo, storage);
  const image = (action: string, p: Record<string, unknown>, now = NOW) =>
    images.action(actor.openid, action, { letterId: draft._id, ...p }, now);
  const upload = async () => {
    const ticket = await image('prepareImage', {
      revision: 1,
      fileName: 'letter.png',
      fileSize: 64,
    });
    if (!isRecord(ticket)) throw Error('ticket');
    const confirmed = await image('confirmImage', { ticketId: ticket.ticketId });
    if (!isRecord(confirmed) || typeof confirmed.fileId !== 'string') throw Error('receipt');
    return { ticketId: ticket.ticketId, fileId: confirmed.fileId };
  };
  return { actor, repo, storage, call, image, images, draft, check, upload };
}
describe('author-bound letter image flow', () => {
  it('seals a file, binds it to a draft, resolves privately, and submits checked evidence', async () => {
    const f = await setup();
    const upload = await f.upload();
    const draft = parseOwnLetter(
      await f.call('updateDraft', {
        letterId: f.draft._id,
        revision: 1,
        imageFileIds: [upload.fileId],
      }),
    );
    expect(await f.images.resolve(f.actor.openid, upload.fileId)).toMatchObject({
      size: 64,
      mimeType: 'image/png',
    });
    const submitted = await f.call('submit', { letterId: draft._id, revision: 2 });
    expect(submitted).toMatchObject({ reviewStatus: 'pending' });
    expect(submitted).not.toHaveProperty('imageUploads');
    expect(f.repo.letters.get(draft._id)?.safety?.traceIds).toEqual(['text', 'image']);
  });
  it('refuses foreign images, unconfirmed files and duplicate image references', async () => {
    const f = await setup();
    const u = await f.upload();
    for (const imageFileIds of [['cloud://foreign/image'], [u.fileId, u.fileId]])
      await expect(
        f.call('updateDraft', { letterId: f.draft._id, revision: 1, imageFileIds }),
      ).rejects.toThrow();
    await f.image('cancelImage', { ticketId: u.ticketId });
    await expect(
      f.call('updateDraft', { letterId: f.draft._id, revision: 1, imageFileIds: [u.fileId] }),
    ).rejects.toThrow();
  });
  it('does not expose another author upload, preview or resolver', async () => {
    const f = await setup();
    const u = await f.upload();
    f.repo.users.set('other', user({ _id: 'other', openid: 'other' }));
    for (const action of ['confirmImage', 'cancelImage', 'imageUrls', 'cleanupImages'])
      await expect(
        f.images.action(
          'other',
          action,
          {
            letterId: f.draft._id,
            ...(action === 'imageUrls'
              ? { fileIds: [u.fileId] }
              : action === 'cleanupImages'
                ? {}
                : { ticketId: u.ticketId }),
          },
          NOW,
        ),
      ).rejects.toThrow();
    await expect(f.images.resolve('other', u.fileId)).rejects.toThrow();
  });
  it('cannot submit while any image check is pending', async () => {
    const f = await setup();
    const u = await f.upload();
    await f.call('updateDraft', { letterId: f.draft._id, revision: 1, imageFileIds: [u.fileId] });
    f.check.mockResolvedValue([
      {
        provider: 'wechat-v2',
        status: 'pending',
        decision: 'review',
        checkedAt: NOW,
        labels: [],
        traceIds: ['image'],
      },
    ]);
    await expect(f.call('submit', { letterId: f.draft._id, revision: 2 })).rejects.toMatchObject({
      code: 'CONTENT_CHECK_PENDING',
    });
    expect(f.repo.letters.get(f.draft._id)?.reviewStatus).toBe('draft');
    f.check.mockResolvedValue([]);
    await expect(f.call('submit', { letterId: f.draft._id, revision: 2 })).rejects.toMatchObject({
      code: 'CONTENT_CHECK_UNAVAILABLE',
    });
  });
  it('rejects bad bytes and never retries immutable sealing on the same ticket', async () => {
    const f = await setup();
    vi.mocked(f.storage.inspectAndSeal).mockResolvedValue({
      fileId: 'cloud://wrong',
      fileSize: 64,
      mimeType: 'image/png',
    });
    await expect(f.upload()).rejects.toThrow();
    const ticket = f.repo.letters.get(f.draft._id)?.imageUploads?.[0];
    expect(ticket?.status).toBe('cancelled');
    await expect(f.image('confirmImage', { ticketId: ticket?._id })).rejects.toThrow();
    expect(f.storage.inspectAndSeal).toHaveBeenCalledTimes(1);
  });
  it('retains referenced final images during cleanup and deletes unbound files after expiry', async () => {
    const f = await setup();
    const a = await f.upload();
    const b = await f.upload();
    await f.call('updateDraft', { letterId: f.draft._id, revision: 1, imageFileIds: [a.fileId] });
    await f.image('cleanupImages', {}, new Date(NOW.getTime() + 31 * 60000));
    const removed = vi.mocked(f.storage.deleteFiles).mock.calls.flatMap((v) => v[0]);
    expect(removed).toContain(b.fileId);
    expect(removed).not.toContain(a.fileId);
    await expect(f.image('cancelImage', { ticketId: a.ticketId })).rejects.toThrow();
  });
  it('obeys disabled image configuration on preparation and final submission', async () => {
    const f = await setup();
    const u = await f.upload();
    await f.call('updateDraft', { letterId: f.draft._id, revision: 1, imageFileIds: [u.fileId] });
    vi.spyOn(f.repo, 'letterImageLimit').mockResolvedValue(0);
    await expect(
      f.image('prepareImage', { revision: 2, fileName: 'letter.png', fileSize: 64 }),
    ).rejects.toThrow();
    await expect(f.call('submit', { letterId: f.draft._id, revision: 2 })).rejects.toMatchObject({
      code: 'CONTENT_CHECK_UNAVAILABLE',
    });
  });
  it.each(['letter.mp3', 'letter.webp', 'letter.svg'])(
    'refuses unsupported %s before signing',
    async (fileName) => {
      const f = await setup();
      await expect(
        f.image('prepareImage', { revision: 1, fileName, fileSize: 64 }),
      ).rejects.toThrow();
      expect(f.storage.prepare).not.toHaveBeenCalled();
    },
  );
});
