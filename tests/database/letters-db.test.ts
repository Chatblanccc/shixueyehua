import { describe, expect, it, vi } from 'vitest';
import { parseLetterDocument, queryOwnLetters } from '../../cloudfunctions/_shared/letter-db';
import { parseOwnLetter } from '../../shared';
const now = new Date('2026-09-16T00:00:00Z');
const record = {
  _id: 'letter1',
  title: '家书标题',
  content: '',
  recipientType: 'child',
  visibility: 'private',
  imageFileIds: [],
  revision: 1,
  reviewStatus: 'pending',
  reviewReason: '',
  authorId: 'user1',
  schoolId: 'school1',
  gradeId: 'grade1',
  classId: 'class1',
  contentHash: 'a'.repeat(64),
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  safety: {
    provider: 'wechat-v2',
    decision: 'pass',
    status: 'complete',
    checkedAt: now,
    labels: [100],
    traceIds: ['trace1'],
  },
};
describe('letter database boundary', () => {
  it('preserves evidence internally but strips it from author DTOs', () => {
    const result = parseLetterDocument(record);
    expect(result.safety).toEqual(record.safety);
    expect(
      parseOwnLetter({ ...result, createdAt: now.toISOString(), updatedAt: now.toISOString() }),
    ).not.toHaveProperty('safety');
  });
  it.each([
    { contentHash: 'bad' },
    { revision: 0 },
    { safety: { decision: 'pass' } },
    { deletedAt: 'yesterday' },
  ])('rejects corrupt record %#', (change) => {
    expect(() => parseLetterDocument({ ...record, ...change })).toThrow();
  });
  it('scopes and bounds list queries', async () => {
    const where = vi.fn(() => ({
      orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ get: async () => ({ data: [record] }) })) })),
    }));
    const db = {
      collection: vi.fn(() => ({ where })),
      command: { gt: (v: unknown) => ({ gt: v }) },
    };
    expect(await queryOwnLetters(db, 'user1', 'last')).toHaveLength(1);
    expect(where).toHaveBeenCalledWith({ authorId: 'user1', deletedAt: null, _id: { gt: 'last' } });
  });
});
