import {
  parseLetterFields,
  parseOwnLetter,
  validLetterSubmission,
  containsLetterContact,
  readString,
} from '../generated/shared';
import type { OwnLetter, UserProfile, ErrorCode } from '../generated/shared';
export interface LocalLetter extends OwnLetter {
  authorId: string;
  requestKey: string;
}
export class LocalLetterError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}
const fail = (code: ErrorCode): never => {
  throw new LocalLetterError(code);
};
export function localLetterAction(
  letters: LocalLetter[],
  user: UserProfile,
  action: string,
  p: Record<string, unknown>,
  now: string,
  nextId: () => string,
): unknown {
  if (
    !['createDraft', 'updateDraft', 'submit', 'withdraw', 'delete', 'detail', 'listMine'].includes(
      action,
    )
  )
    fail('NOT_IMPLEMENTED');
  if (user.status !== 'active') fail('USER_DISABLED');
  const allowed =
    action === 'createDraft'
      ? ['requestKey', 'title', 'content', 'recipientType', 'visibility', 'imageFileIds']
      : action === 'updateDraft'
        ? [
            'letterId',
            'revision',
            'title',
            'content',
            'recipientType',
            'visibility',
            'imageFileIds',
          ]
        : action === 'listMine'
          ? ['cursor']
          : action === 'detail'
            ? ['letterId']
            : ['letterId', 'revision'];
  if (Object.keys(p).some((k) => !allowed.includes(k))) fail('INVALID_ARGUMENT');
  if (action === 'listMine') {
    const cursor = p.cursor === undefined ? undefined : readString(p.cursor);
    const rows = letters
      .filter(
        (v) =>
          v.authorId === user._id && v.reviewStatus !== 'deleted' && (!cursor || v._id > cursor),
      )
      .sort((a, b) => a._id.localeCompare(b._id));
    return {
      items: rows.slice(0, 20).map(parseOwnLetter),
      ...(rows.length > 20 ? { nextCursor: rows[19]?._id } : {}),
    };
  }
  if (action === 'createDraft') {
    if (!user.identity || !user.currentClassId || !user.currentSchoolId || !user.currentGradeId)
      fail('CLASS_NOT_AVAILABLE');
    const requestKey = readString(p.requestKey),
      fields = parseLetterFields(p);
    if (fields.imageFileIds.length) fail('CONTENT_CHECK_UNAVAILABLE');
    const old = letters.find((v) => v.authorId === user._id && v.requestKey === requestKey);
    if (old) {
      if (
        old.reviewStatus === 'deleted' ||
        JSON.stringify(parseLetterFields(old)) !== JSON.stringify(fields)
      )
        fail('DUPLICATE_REQUEST');
      return parseOwnLetter(old);
    }
    const next: LocalLetter = {
      ...fields,
      _id: nextId(),
      authorId: user._id,
      requestKey,
      revision: 1,
      reviewStatus: 'draft',
      reviewReason: '',
      createdAt: now,
      updatedAt: now,
    };
    letters.push(next);
    return parseOwnLetter(next);
  }
  const index = letters.findIndex((v) => v._id === p.letterId && v.authorId === user._id);
  const old = letters[index];
  if (!old) return fail('LETTER_NOT_FOUND');
  if (action === 'delete' && old.reviewStatus === 'deleted') return parseOwnLetter(old);
  if (old.reviewStatus === 'deleted') fail('LETTER_NOT_FOUND');
  if (action === 'detail') return parseOwnLetter(old);
  if (!Number.isSafeInteger(p.revision) || p.revision !== old.revision)
    fail('LETTER_STATE_CONFLICT');
  let next = { ...old, updatedAt: now };
  if (action === 'updateDraft') {
    if (!['draft', 'rejected'].includes(old.reviewStatus)) fail('LETTER_STATE_CONFLICT');
    const fields = parseLetterFields({ ...old, ...p });
    if (fields.imageFileIds.length) fail('CONTENT_CHECK_UNAVAILABLE');
    next = {
      ...next,
      ...fields,
      revision: old.revision + 1,
      reviewStatus: 'draft',
      reviewReason: '',
    };
  } else if (action === 'submit') {
    if (old.reviewStatus === 'pending') return parseOwnLetter(old);
    if (!['draft', 'rejected'].includes(old.reviewStatus)) fail('LETTER_STATE_CONFLICT');
    if (!validLetterSubmission(old)) fail('INVALID_ARGUMENT');
    if (containsLetterContact(old)) fail('CONTENT_REJECTED');
    if (old.imageFileIds.length) fail('CONTENT_CHECK_UNAVAILABLE');
    if (!user.identity || !user.currentClassId || !user.currentSchoolId)
      fail('CLASS_NOT_AVAILABLE');
    // This is an explicitly isolated demo queue, never a platform safety result or publication.
    next.reviewStatus = 'pending';
    next.reviewReason = '';
  } else if (action === 'withdraw') {
    if (!['pending', 'approved'].includes(old.reviewStatus)) fail('LETTER_STATE_CONFLICT');
    next.reviewStatus = 'draft';
    next.revision++;
    next.reviewReason = '';
  } else if (action === 'delete') {
    if (!['draft', 'rejected', 'hidden'].includes(old.reviewStatus)) fail('LETTER_STATE_CONFLICT');
    next.reviewStatus = 'deleted';
    next.revision++;
  } else fail('NOT_IMPLEMENTED');
  letters[index] = next;
  return parseOwnLetter(next);
}
