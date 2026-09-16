import { createHash } from 'node:crypto';
import {
  parseLetterFields,
  parseOwnLetter,
  validLetterSubmission,
  containsLetterContact,
} from '../../shared';
import type { LetterFields, OwnLetter } from '../../shared';
import type { Repository } from '../_shared/repository';
import type { LetterRecord } from '../_shared/letter-repository';
import type { ContentSafetyPort } from '../_shared/content-safety';
import { assertSafetyQueueAdmission } from '../_shared/content-safety';
import { requireActiveUser } from '../_shared/auth';
import { transactionUser } from '../_shared/user-transaction';
import { assertScope, fields, relationId } from '../_shared/audio-common';
import { identifier } from '../_shared/validate';
import { AppError } from '../_shared/errors';

const EDIT_FIELDS = ['title', 'content', 'recipientType', 'visibility', 'imageFileIds'];
function parseFields(p: unknown): LetterFields {
  try {
    const result = parseLetterFields(p);
    if (result.imageFileIds.length) throw new AppError('CONTENT_CHECK_UNAVAILABLE');
    return result;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('INVALID_ARGUMENT');
  }
}
export function letterHash(value: LetterFields): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        value.title,
        value.content,
        value.recipientType,
        value.visibility,
        value.imageFileIds,
      ]),
    )
    .digest('hex');
}
function dto(value: LetterRecord): OwnLetter {
  return parseOwnLetter({
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  });
}
function owned(value: LetterRecord | undefined, authorId: string): LetterRecord {
  if (!value || value.authorId !== authorId) throw new AppError('LETTER_NOT_FOUND');
  return value;
}
function version(p: Record<string, unknown>, letter: LetterRecord) {
  if (typeof p.revision !== 'number' || !Number.isSafeInteger(p.revision) || p.revision < 1)
    throw new AppError('INVALID_ARGUMENT');
  if (p.revision !== letter.revision) throw new AppError('LETTER_STATE_CONFLICT');
}
export async function letterAction(
  repo: Repository,
  safety: ContentSafetyPort | undefined,
  openid: string,
  action: string,
  p: Record<string, unknown>,
  now: Date,
): Promise<unknown> {
  const actor = await requireActiveUser(repo, openid);
  if (action === 'listMine') {
    fields(p, ['cursor']);
    const after = p.cursor === undefined ? undefined : identifier(p.cursor);
    const rows = await repo.listOwnLetters(actor._id, after);
    return {
      items: rows.slice(0, 20).map(dto),
      ...(rows.length > 20 ? { nextCursor: rows[19]?._id } : {}),
    };
  }
  if (action === 'detail') {
    fields(p, ['letterId']);
    const letter = owned(await repo.findLetter(identifier(p.letterId)), actor._id);
    if (letter.deletedAt) throw new AppError('LETTER_NOT_FOUND');
    return dto(letter);
  }
  if (action === 'createDraft') {
    fields(p, ['requestKey', ...EDIT_FIELDS]);
    const key = identifier(p.requestKey),
      content = parseFields(p);
    return repo.runTransaction(async (tx) => {
      const user = await transactionUser(tx, actor._id, openid);
      await assertScope(tx, user);
      const id = relationId(actor._id, `letter:${key}`),
        hash = letterHash(content);
      const old = await tx.findLetter(id);
      if (old) {
        if (old.authorId !== actor._id || old.contentHash !== hash || old.deletedAt)
          throw new AppError('DUPLICATE_REQUEST');
        return dto(old);
      }
      const letter: LetterRecord = {
        ...content,
        _id: id,
        authorId: user._id,
        schoolId: user.currentSchoolId!,
        gradeId: user.currentGradeId!,
        classId: user.currentClassId!,
        revision: 1,
        contentHash: hash,
        reviewStatus: 'draft',
        reviewReason: '',
        safety: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await tx.saveLetter(letter, false);
      return dto(letter);
    });
  }
  fields(
    p,
    action === 'updateDraft' ? ['letterId', 'revision', ...EDIT_FIELDS] : ['letterId', 'revision'],
  );
  const id = identifier(p.letterId);
  if (action === 'submit') {
    const snapshot = owned(await repo.findLetter(id), actor._id);
    version(p, snapshot);
    if (snapshot.deletedAt) throw new AppError('LETTER_NOT_FOUND');
    if (snapshot.reviewStatus === 'pending') return dto(snapshot);
    if (!['draft', 'rejected'].includes(snapshot.reviewStatus))
      throw new AppError('LETTER_STATE_CONFLICT');
    if (!validLetterSubmission(snapshot)) throw new AppError('INVALID_ARGUMENT');
    if (containsLetterContact(snapshot)) throw new AppError('CONTENT_REJECTED');
    if (!safety || snapshot.imageFileIds.length) throw new AppError('CONTENT_CHECK_UNAVAILABLE');
    const checked = await safety.checkText({ openid }, snapshot);
    assertSafetyQueueAdmission([checked]);
    return repo.runTransaction(async (tx) => {
      const user = await transactionUser(tx, actor._id, openid);
      await assertScope(tx, user);
      const current = owned(await tx.findLetter(id), actor._id);
      version(p, current);
      if (current.deletedAt || current.contentHash !== snapshot.contentHash)
        throw new AppError('LETTER_STATE_CONFLICT');
      if (current.reviewStatus === 'pending') return dto(current);
      if (!['draft', 'rejected'].includes(current.reviewStatus))
        throw new AppError('LETTER_STATE_CONFLICT');
      const value: LetterRecord = {
        ...current,
        schoolId: user.currentSchoolId!,
        gradeId: user.currentGradeId!,
        classId: user.currentClassId!,
        reviewStatus: 'pending',
        reviewReason: '',
        safety: checked,
        updatedAt: now,
      };
      await tx.saveLetter(value, true);
      return dto(value);
    });
  }
  return repo.runTransaction(async (tx) => {
    await transactionUser(tx, actor._id, openid);
    const old = owned(await tx.findLetter(id), actor._id);
    if (action === 'delete' && old.reviewStatus === 'deleted') return dto(old);
    version(p, old);
    if (old.deletedAt) throw new AppError('LETTER_NOT_FOUND');
    let next: LetterRecord;
    if (action === 'updateDraft') {
      if (!['draft', 'rejected'].includes(old.reviewStatus))
        throw new AppError('LETTER_STATE_CONFLICT');
      const content = parseFields({ ...old, ...p });
      next = {
        ...old,
        ...content,
        contentHash: letterHash(content),
        reviewStatus: 'draft',
        reviewReason: '',
        safety: null,
      };
    } else if (action === 'withdraw') {
      if (!['pending', 'approved'].includes(old.reviewStatus))
        throw new AppError('LETTER_STATE_CONFLICT');
      next = { ...old, reviewStatus: 'draft', safety: null, reviewReason: '' };
    } else if (action === 'delete') {
      if (!['draft', 'rejected', 'hidden'].includes(old.reviewStatus))
        throw new AppError('LETTER_STATE_CONFLICT');
      next = { ...old, reviewStatus: 'deleted', deletedAt: now, safety: null };
    } else throw new AppError('NOT_IMPLEMENTED');
    next.revision++;
    next.updatedAt = now;
    await tx.saveLetter(next, true);
    return dto(next);
  });
}
