import { isRecord, readEnum, readString } from './validate';
import type { LetterStatus, RecipientType } from './domain';
export interface LetterFields {
  title: string;
  content: string;
  recipientType: RecipientType;
  visibility: 'private' | 'class' | 'school';
  imageFileIds: string[];
}
export interface OwnLetter extends LetterFields {
  _id: string;
  revision: number;
  reviewStatus: LetterStatus;
  reviewReason: string;
  createdAt: string;
  updatedAt: string;
}
export function parseLetterFields(value: unknown): LetterFields {
  if (!isRecord(value)) throw new Error('Invalid letter');
  const text = (v: unknown, max: number) => {
    if (typeof v !== 'string' || Array.from(v).length > max) throw new Error('Invalid letter text');
    return v;
  };
  const images = value.imageFileIds ?? [];
  if (!Array.isArray(images) || images.length > 3) throw new Error('Invalid images');
  return {
    title: text(value.title ?? '', 30),
    content: text(value.content ?? '', 3000),
    recipientType: readEnum(value.recipientType ?? 'child', [
      'child',
      'parent',
      'teacher',
      'classmate',
      'future_self',
      'other',
    ]),
    visibility: readEnum(value.visibility ?? 'private', ['private', 'class', 'school']),
    imageFileIds: images.map((id: unknown) => readString(id, 1024)),
  };
}
export function validLetterSubmission(fields: LetterFields): boolean {
  return (
    Array.from(fields.title.trim()).length >= 2 && Array.from(fields.content.trim()).length >= 20
  );
}
/** Conservative local rule supplements, never replaces, platform checking. */
export function containsLetterContact(fields: LetterFields): boolean {
  return /https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?86[ -]?)?1[3-9](?:[ -]?\d){9}|(?:微信|QQ|电话|手机)\s*[:：号]?\s*[a-z\d_-]{5,}/i.test(
    fields.title + '\n' + fields.content,
  );
}
export function parseOwnLetter(value: unknown): OwnLetter {
  if (
    !isRecord(value) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  )
    throw new Error('Invalid letter');
  const date = (v: unknown) => {
    const s = readString(v, 30);
    if (new Date(s).toISOString() !== s) throw new Error('Invalid date');
    return s;
  };
  return {
    ...parseLetterFields(value),
    _id: readString(value._id),
    revision: value.revision,
    reviewStatus: readEnum(value.reviewStatus, [
      'draft',
      'pending',
      'approved',
      'rejected',
      'hidden',
      'deleted',
    ]),
    reviewReason:
      typeof value.reviewReason === 'string' && value.reviewReason.length <= 500
        ? value.reviewReason
        : '',
    createdAt: date(value.createdAt),
    updatedAt: date(value.updatedAt),
  };
}
export function parseOwnLetterPage(value: unknown): { items: OwnLetter[]; nextCursor?: string } {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 20)
    throw new Error('Invalid letters');
  return {
    items: value.items.map(parseOwnLetter),
    ...(value.nextCursor === undefined ? {} : { nextCursor: readString(value.nextCursor) }),
  };
}
