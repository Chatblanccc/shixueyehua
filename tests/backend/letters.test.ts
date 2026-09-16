import { describe, expect, it, vi } from 'vitest';
import { parseOwnLetter } from '../../shared';
import { letterAction } from '../../cloudfunctions/letterApi/letters';
import { createHandler } from '../../cloudfunctions/_shared/handler';
import type { ContentSafetyPort, SafetyResult } from '../../cloudfunctions/_shared/content-safety';
import { MemoryRepository, user, classroom, NOW } from './fixtures';
const fields = {
  title: '写给家人',
  content: '谢谢你一直以来的陪伴和鼓励，希望未来我们一起努力成长，迎接更好的明天。',
  recipientType: 'parent',
  visibility: 'private',
  imageFileIds: [],
};
function setup() {
  const actor = user({
    identity: 'parent',
    currentSchoolId: 'test_school_a',
    currentGradeId: 'test_grade_a',
    currentClassId: 'test_class_a',
  });
  const repo = new MemoryRepository([actor]);
  const safety: ContentSafetyPort = {
    checkText: vi.fn(async (): Promise<SafetyResult> => ({
      decision: 'pass',
      status: 'complete',
      provider: 'wechat-v2',
      checkedAt: NOW,
      labels: [100],
      traceIds: ['trace'],
    })),
    checkImage: vi.fn(),
  };
  const call = (action: string, p: Record<string, unknown>) =>
    letterAction(repo, safety, actor.openid, action, p, NOW);
  const create = async () =>
    parseOwnLetter(await call('createDraft', { requestKey: 'key1', ...fields }));
  return { actor, repo, safety, call, create };
}
describe('TASK-400 author letter flow', () => {
  it('persists a draft, submits once, withdraws and soft deletes', async () => {
    const { call, create, repo, safety } = setup();
    const draft = await create();
    const p = { letterId: draft._id, revision: draft.revision };
    expect(parseOwnLetter(await call('submit', p)).reviewStatus).toBe('pending');
    expect(parseOwnLetter(await call('submit', p)).reviewStatus).toBe('pending');
    expect(safety.checkText).toHaveBeenCalledTimes(1);
    const restored = parseOwnLetter(await call('withdraw', p));
    expect(restored.revision).toBe(2);
    await call('delete', { ...p, revision: 2 });
    expect(repo.letters.get(draft._id)?.deletedAt).toEqual(NOW);
    expect(await call('listMine', {})).toEqual({ items: [] });
  });
  it('allows unfinished drafts and idempotent creation, not short submission', async () => {
    const { call, repo } = setup();
    const p = { requestKey: 'blank' };
    const a = parseOwnLetter(await call('createDraft', p));
    await call('createDraft', p);
    expect(repo.letters.size).toBe(1);
    await expect(call('submit', { letterId: a._id, revision: 1 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
  it('uses trusted identity and rejects forged owner/school/status fields', async () => {
    const { call, create, actor, repo } = setup();
    await expect(
      call('createDraft', { requestKey: 'key', ...fields, schoolId: 'forged' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const dto = await create();
    expect(repo.letters.get(dto._id)?.authorId).toBe(actor._id);
    expect(dto).not.toHaveProperty('authorId');
    expect(dto).not.toHaveProperty('safety');
  });
  it('prevents other authors from reading and editing', async () => {
    const { create, repo, safety } = setup();
    const d = await create();
    const other = user({ _id: 'other', openid: 'other_openid' });
    repo.users.set(other._id, other);
    for (const action of ['detail', 'updateDraft', 'submit', 'withdraw', 'delete'])
      await expect(
        letterAction(
          repo,
          safety,
          other.openid,
          action,
          { letterId: d._id, ...(action === 'detail' ? {} : { revision: 1 }) },
          NOW,
        ),
      ).rejects.toMatchObject({ code: 'LETTER_NOT_FOUND' });
  });
  it.each(['approved', 'pending', 'hidden'] as const)(
    'refuses direct editing of %s',
    async (reviewStatus) => {
      const { create, repo, call } = setup();
      const d = await create();
      const old = repo.letters.get(d._id)!;
      repo.letters.set(d._id, { ...old, reviewStatus });
      await expect(
        call('updateDraft', { letterId: d._id, revision: 1, title: '替换标题' }),
      ).rejects.toMatchObject({ code: 'LETTER_STATE_CONFLICT' });
    },
  );
  it('clears rejected reasons and increments revision when editing', async () => {
    const { create, repo, call } = setup();
    const d = await create();
    repo.letters.set(d._id, {
      ...repo.letters.get(d._id)!,
      reviewStatus: 'rejected',
      reviewReason: '请修改',
    });
    expect(
      await call('updateDraft', { letterId: d._id, revision: 1, title: '新的标题' }),
    ).toMatchObject({ revision: 2, reviewStatus: 'draft', reviewReason: '' });
    await expect(call('submit', { letterId: d._id, revision: 1 })).rejects.toMatchObject({
      code: 'LETTER_STATE_CONFLICT',
    });
  });
  it.each(['unavailable', 'pending'] as const)('preserves draft on safety %s', async (status) => {
    const { create, call, safety, repo } = setup();
    const d = await create();
    vi.mocked(safety.checkText).mockResolvedValue({
      decision: 'review',
      status,
      provider: 'wechat-v2',
      checkedAt: NOW,
      labels: [],
      traceIds: [],
    });
    await expect(call('submit', { letterId: d._id, revision: 1 })).rejects.toThrow();
    expect(repo.letters.get(d._id)?.reviewStatus).toBe('draft');
  });
  it('rejects risky content and obvious contact information', async () => {
    const { create, call, safety } = setup();
    const d = await create();
    vi.mocked(safety.checkText).mockResolvedValue({
      decision: 'reject',
      status: 'complete',
      provider: 'wechat-v2',
      checkedAt: NOW,
      labels: [20006],
      traceIds: ['t'],
    });
    await expect(call('submit', { letterId: d._id, revision: 1 })).rejects.toMatchObject({
      code: 'CONTENT_REJECTED',
    });
    await call('updateDraft', {
      letterId: d._id,
      revision: 1,
      content: fields.content + ' https://example.com',
    });
    await expect(call('submit', { letterId: d._id, revision: 2 })).rejects.toMatchObject({
      code: 'CONTENT_REJECTED',
    });
  });
  it('rechecks version after safety awaits and cannot submit changed text', async () => {
    const { create, call, safety, repo } = setup();
    const d = await create();
    vi.mocked(safety.checkText).mockImplementation(async () => {
      await call('updateDraft', {
        letterId: d._id,
        revision: 1,
        content: '修改之后的全新正文，需要重新执行内容安全检查，不能套用旧的结果。',
      });
      return {
        decision: 'pass',
        status: 'complete',
        provider: 'wechat-v2',
        checkedAt: NOW,
        labels: [],
        traceIds: [],
      };
    });
    await expect(call('submit', { letterId: d._id, revision: 1 })).rejects.toMatchObject({
      code: 'LETTER_STATE_CONFLICT',
    });
    expect(repo.letters.get(d._id)?.reviewStatus).toBe('draft');
  });
  it('rechecks disabled users and organization before committing submission', async () => {
    const { create, call, safety, repo, actor } = setup();
    const d = await create();
    vi.mocked(safety.checkText).mockImplementation(async () => {
      repo.users.set(actor._id, { ...actor, status: 'disabled' });
      return {
        decision: 'pass',
        status: 'complete',
        provider: 'wechat-v2',
        checkedAt: NOW,
        labels: [],
        traceIds: [],
      };
    });
    await expect(call('submit', { letterId: d._id, revision: 1 })).rejects.toMatchObject({
      code: 'USER_DISABLED',
    });
    expect(repo.letters.get(d._id)?.reviewStatus).toBe('draft');
  });
  it('closes image writes until verified upload ownership is available', async () => {
    const { call } = setup();
    await expect(
      call('createDraft', { requestKey: 'i', ...fields, imageFileIds: ['cloud://other/image'] }),
    ).rejects.toMatchObject({ code: 'CONTENT_CHECK_UNAVAILABLE' });
  });
  it('binds submission to the current trusted class rather than the draft class', async () => {
    const { create, call, repo, actor } = setup();
    const d = await create();
    repo.classes.set('test_class_b', classroom({ _id: 'test_class_b' }));
    repo.users.set(actor._id, { ...actor, currentClassId: 'test_class_b' });
    await call('submit', { letterId: d._id, revision: 1 });
    expect(repo.letters.get(d._id)).toMatchObject({
      schoolId: actor.currentSchoolId,
      gradeId: actor.currentGradeId,
      classId: 'test_class_b',
      reviewStatus: 'pending',
    });
  });
  it('routes through the authenticated handler and returns safe DTOs', async () => {
    const { repo, safety, actor } = setup();
    const handler = createHandler('letterApi', {
      repository: repo,
      contentSafety: safety,
      getContext: () => ({ OPENID: actor.openid }),
      getEnvironment: () => 'test',
      logger: { write: vi.fn() },
      now: () => NOW,
    });
    expect(
      await handler({ action: 'createDraft', payload: { requestKey: 'route', ...fields } }),
    ).toMatchObject({ success: true, data: { reviewStatus: 'draft' } });
  });
});
