import { describe, expect, it } from 'vitest';
import { sanitizeAuditSnapshot, writeAudit } from '../../cloudfunctions/_shared/audit';
import { createCursorCodec, pageSize } from '../../cloudfunctions/_shared/pagination';
import { MemoryRepository, NOW, user } from './fixtures';

describe('TASK-101 signed pagination', () => {
  const codec = createCursorCodec('test_only_key_32_characters_minimum');
  const position = { timestamp: NOW.toISOString(), id: 'test_audio_123' };
  const scope = 'test_user:test_school_a:published:school';

  it('round-trips position and binds it to the server query scope', () => {
    const cursor = codec.encode(position, scope);
    expect(codec.decode(cursor, scope)).toEqual(position);
    expect(() => codec.decode(cursor, 'test_other_school')).toThrow();
    expect(codec.decode(undefined, scope)).toBeUndefined();
  });

  it('rejects data/signature tampering and a different signing key', () => {
    const cursor = codec.encode(position, scope);
    expect(() => codec.decode(`A${cursor.slice(1)}`, scope)).toThrow();
    const last = cursor.endsWith('A') ? 'B' : 'A';
    expect(() => codec.decode(`${cursor.slice(0, -1)}${last}`, scope)).toThrow();
    const other = createCursorCodec('test_only_second_key_32_characters');
    expect(() => other.decode(cursor, scope)).toThrow();
  });

  it.each(['', '{}', '../secret', 'a'.repeat(2049), 123, null, { cursor: 'injected' }])(
    'rejects malformed cursor %j',
    (cursor) => {
      expect(() => codec.decode(cursor, scope)).toThrow();
    },
  );

  it('validates page size and timestamp, and refuses a missing/short signing key', () => {
    expect(pageSize(undefined)).toBe(20);
    expect(pageSize(1)).toBe(1);
    for (const value of [0, -1, 21, 1.5, '20', NaN]) expect(() => pageSize(value)).toThrow();
    expect(() => codec.encode({ ...position, timestamp: 'not a date' }, scope)).toThrow();
    expect(() => createCursorCodec('short')).toThrow();
  });
});

describe('TASK-101 private audit trail', () => {
  it('drops personal text, URLs, tokens, nested fields and invalid values', () => {
    expect(
      sanitizeAuditSnapshot({
        role: 'admin',
        status: 'active',
        adminSchoolId: 'test_school_a',
        content: 'private family letter',
        openid: 'test_secret_identity',
        phone: 'test_phone',
        audioFileId: 'cloud://test-file',
        url: 'https://example.com/private',
        accessToken: 'test_token',
        currentSchoolId: { injected: 'object' },
        maxLetterImages: Infinity,
      }),
    ).toEqual({ role: 'admin', status: 'active', adminSchoolId: 'test_school_a' });
  });

  it('records trusted operator and request ID only in the protected audit collection', async () => {
    const repository = new MemoryRepository();
    const actor = user({ role: 'super_admin' });
    await writeAudit(repository, {
      actor,
      schoolId: 'test_school_a',
      action: 'test_grant_admin',
      targetType: 'user',
      targetId: 'test_target_user',
      requestId: 'test_request_123',
      now: NOW,
      before: { role: 'user', content: 'private' },
      after: { role: 'admin', adminSchoolId: 'test_school_a', token: 'secret' },
    });
    expect(repository.audits).toHaveLength(1);
    expect(repository.audits[0]).toEqual({
      operatorId: actor._id,
      operatorOpenid: actor.openid,
      schoolId: 'test_school_a',
      action: 'test_grant_admin',
      targetType: 'user',
      targetId: 'test_target_user',
      before: { role: 'user' },
      after: { role: 'admin', adminSchoolId: 'test_school_a' },
      requestId: 'test_request_123',
      createdAt: NOW,
    });
  });
});
