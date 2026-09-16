import { randomUUID } from 'node:crypto';
import type { LetterFields } from '../../shared';
import type { AudioUploadRecord } from '../_shared/audio-repository';
import type { AudioStoragePort } from '../_shared/audio-storage-port';
import type { LetterRecord } from '../_shared/letter-repository';
import type { Repository, TransactionRepository } from '../_shared/repository';
import { requireActiveUser } from '../_shared/auth';
import { transactionUser } from '../_shared/user-transaction';
import { assertScope, fields, boundedNumber } from '../_shared/audio-common';
import { identifier } from '../_shared/validate';
import { AppError } from '../_shared/errors';

const MAX_BYTES = 5 * 1024 * 1024;
export function validateLetterImages(letter: LetterRecord, values: LetterFields) {
  if (
    new Set(values.imageFileIds).size !== values.imageFileIds.length ||
    values.imageFileIds.length > 3
  )
    throw new AppError('INVALID_ARGUMENT');
  for (const id of values.imageFileIds) {
    const upload = letter.imageUploads?.find((v) => v.finalFileId === id);
    if (
      !upload ||
      upload.userId !== letter.authorId ||
      upload.status !== 'confirmed' ||
      upload.kind !== 'cover' ||
      !upload.fileSize ||
      upload.fileSize > MAX_BYTES ||
      !['image/jpeg', 'image/png'].includes(upload.mimeType ?? '')
    )
      throw new AppError('CONTENT_CHECK_UNAVAILABLE');
  }
}
function owned(letter: LetterRecord | undefined, author: string): LetterRecord {
  if (!letter || letter.authorId !== author) throw new AppError('LETTER_NOT_FOUND');
  return letter;
}
function editable(letter: LetterRecord) {
  if (letter.deletedAt || !['draft', 'rejected'].includes(letter.reviewStatus))
    throw new AppError('LETTER_STATE_CONFLICT');
}
export function createLetterImages(repo: Repository, storage: AudioStoragePort) {
  async function resource(tx: TransactionRepository, author: string, openid: string, id: string) {
    await transactionUser(tx, author, openid);
    return owned(await tx.findLetter(id), author);
  }
  async function change(
    author: string,
    openid: string,
    id: string,
    ticketId: string,
    work: (letter: LetterRecord, ticket: AudioUploadRecord) => AudioUploadRecord,
  ) {
    return repo.runTransaction(async (tx) => {
      const letter = await resource(tx, author, openid, id);
      const ticket = letter.imageUploads?.find((v) => v._id === ticketId);
      if (!ticket) throw new AppError('UPLOAD_EXPIRED');
      const next = work(letter, ticket);
      await tx.saveLetter(
        {
          ...letter,
          imageUploads: letter.imageUploads!.map((v) => (v._id === ticketId ? next : v)),
        },
        true,
      );
      return next;
    });
  }
  return {
    async action(
      openid: string,
      action: string,
      p: Record<string, unknown>,
      now: Date,
    ): Promise<unknown> {
      const actor = await requireActiveUser(repo, openid);
      const id = identifier(p.letterId);
      fields(
        p,
        action === 'prepareImage'
          ? ['letterId', 'revision', 'fileName', 'fileSize']
          : action === 'imageUrls'
            ? ['letterId', 'fileIds']
            : action === 'cleanupImages'
              ? ['letterId']
              : ['letterId', 'ticketId'],
      );
      if (action === 'prepareImage') {
        const name = typeof p.fileName === 'string' ? p.fileName : '';
        const ext = /\.(jpe?g|png)$/i.exec(name)?.[1]?.toLowerCase();
        if (!ext || name.length > 256) throw new AppError('INVALID_ARGUMENT');
        const size = boundedNumber(p.fileSize, 1, MAX_BYTES);
        if (!Number.isSafeInteger(size)) throw new AppError('INVALID_ARGUMENT');
        const ticketId = randomUUID();
        const sourcePath = `letter-quarantine/${id}/${now.getUTCFullYear()}/${ticketId}.${ext}`;
        const finalPath = `letter-media/${id}/${now.getUTCFullYear()}/${randomUUID()}.${ext}`;
        const ticket: AudioUploadRecord = {
          _id: ticketId,
          userId: actor._id,
          schoolId: actor.currentSchoolId ?? '',
          kind: 'cover',
          status: 'issued',
          originalFileName: name,
          expectedBytes: size,
          maxBytes: MAX_BYTES,
          sourcePath,
          sourceFileId: '',
          finalPath,
          finalFileId: '',
          expiresAt: new Date(now.getTime() + 20 * 60000),
          grantExpiresAt: now,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          sourceCleaned: false,
          finalCleaned: false,
        };
        await repo.runTransaction(async (tx) => {
          const user = await transactionUser(tx, actor._id, openid);
          await assertScope(tx, user);
          if ((await tx.letterImageLimit(user.currentSchoolId!)) < 1)
            throw new AppError('CONTENT_CHECK_UNAVAILABLE');
          const letter = owned(await tx.findLetter(id), actor._id);
          editable(letter);
          if (p.revision !== letter.revision) throw new AppError('LETTER_STATE_CONFLICT');
          const uploads = (letter.imageUploads ?? []).filter((v) => v.status !== 'cleaned');
          if (uploads.length >= 6) throw new AppError('RATE_LIMITED');
          await tx.saveLetter({ ...letter, imageUploads: [...uploads, ticket] }, true);
        });
        const grant = await storage.prepare(sourcePath, now);
        if (
          !grant.fileId.startsWith('cloud://') ||
          !grant.fileId.endsWith(`/${sourcePath}`) ||
          grant.expiresAt <= now
        )
          throw new AppError('UPLOAD_FAILED');
        await change(actor._id, openid, id, ticketId, (letter, old) => {
          editable(letter);
          if (old.status !== 'issued') throw new AppError('UPLOAD_EXPIRED');
          return {
            ...old,
            sourceFileId: grant.fileId,
            finalFileId: grant.fileId.slice(0, -sourcePath.length) + finalPath,
            grantExpiresAt: grant.expiresAt,
          };
        });
        return {
          ticketId,
          uploadUrl: grant.uploadUrl,
          method: grant.method,
          headers: grant.headers,
          expiresAt: new Date(
            Math.min(ticket.expiresAt.getTime(), grant.expiresAt.getTime()),
          ).toISOString(),
          maxBytes: MAX_BYTES,
        };
      }
      if (action === 'imageUrls') {
        const letter = owned(await repo.findLetter(id), actor._id);
        if (letter.deletedAt) throw new AppError('LETTER_NOT_FOUND');
        if (
          !Array.isArray(p.fileIds) ||
          p.fileIds.length > 3 ||
          !p.fileIds.every((v) => typeof v === 'string')
        )
          throw new AppError('INVALID_ARGUMENT');
        const fileIds = p.fileIds as string[];
        validateLetterImages(letter, { ...letter, imageFileIds: fileIds });
        return {
          urls: await Promise.all(fileIds.map((fileId) => storage.temporaryUrl(fileId, 600))),
        };
      }
      if (action === 'cleanupImages') {
        const letter = owned(await repo.findLetter(id), actor._id);
        let cleaned = 0;
        for (const candidate of letter.imageUploads ?? []) {
          if (
            candidate.status === 'cleaned' ||
            candidate.expiresAt > now ||
            candidate.grantExpiresAt.getTime() + 5 * 60000 > now.getTime()
          )
            continue;
          const reserved = await change(actor._id, openid, id, candidate._id, (fresh, upload) => {
            if (
              upload.status === 'validating' &&
              (upload.validationStartedAt?.getTime() ?? 0) + 10 * 60000 > now.getTime()
            )
              throw new AppError('DUPLICATE_REQUEST');
            const keep = !fresh.deletedAt && fresh.imageFileIds.includes(upload.finalFileId);
            return keep ? upload : { ...upload, status: 'cancelled' };
          });
          const files = [
            !reserved.sourceCleaned ? reserved.sourceFileId : '',
            reserved.status === 'cancelled' && !reserved.finalCleaned ? reserved.finalFileId : '',
          ].filter(Boolean);
          await storage.deleteFiles(files);
          await change(actor._id, openid, id, reserved._id, (_fresh, upload) => {
            if (upload.status !== reserved.status) throw new AppError('LETTER_STATE_CONFLICT');
            return {
              ...upload,
              sourceCleaned: true,
              ...(upload.status === 'cancelled' ? { status: 'cleaned', finalCleaned: true } : {}),
            };
          });
          cleaned++;
        }
        return { cleaned };
      }
      const ticketId = identifier(p.ticketId);
      if (action === 'cancelImage') {
        await change(actor._id, openid, id, ticketId, (letter, ticket) => {
          if (letter.imageFileIds.includes(ticket.finalFileId))
            throw new AppError('LETTER_STATE_CONFLICT');
          return ticket.status === 'cleaned' ? ticket : { ...ticket, status: 'cancelled' };
        });
        return { cancelled: true };
      }
      if (action !== 'confirmImage') throw new AppError('INVALID_ARGUMENT');
      const ticket = await change(actor._id, openid, id, ticketId, (letter, old) => {
        editable(letter);
        if (old.status === 'confirmed') return old;
        if (
          old.status !== 'issued' ||
          old.expiresAt <= now ||
          old.grantExpiresAt <= now ||
          !old.sourceFileId
        )
          throw new AppError('UPLOAD_EXPIRED');
        return { ...old, status: 'validating', validationStartedAt: now };
      });
      if (ticket.status === 'confirmed') return { fileId: ticket.finalFileId };
      try {
        const result = await storage.inspectAndSeal({
          sourceFileId: ticket.sourceFileId,
          finalPath: ticket.finalPath,
          kind: 'cover',
          expectedBytes: ticket.expectedBytes,
          maxBytes: MAX_BYTES,
        });
        if (
          result.fileId !== ticket.finalFileId ||
          result.fileSize !== ticket.expectedBytes ||
          !['image/jpeg', 'image/png'].includes(result.mimeType)
        )
          throw new AppError('UPLOAD_FAILED');
        await change(actor._id, openid, id, ticketId, (letter, current) => {
          editable(letter);
          if (current.status !== 'validating') throw new AppError('UPLOAD_EXPIRED');
          return {
            ...current,
            status: 'confirmed',
            fileSize: result.fileSize,
            mimeType: result.mimeType,
          };
        });
        return { fileId: result.fileId };
      } catch (error) {
        await change(actor._id, openid, id, ticketId, (_letter, old) =>
          old.status === 'validating' ? { ...old, status: 'cancelled' } : old,
        );
        throw error;
      }
    },
    async resolve(openid: string, fileId: string) {
      const id = /^cloud:\/\/[^/]+\/letter-media\/([A-Za-z0-9_-]+)\//.exec(fileId)?.[1];
      if (!id) throw new AppError('CONTENT_CHECK_UNAVAILABLE');
      const actor = await requireActiveUser(repo, openid);
      const letter = owned(await repo.findLetter(id), actor._id);
      editable(letter);
      if (!letter.imageFileIds.includes(fileId)) throw new AppError('CONTENT_CHECK_UNAVAILABLE');
      validateLetterImages(letter, { ...letter, imageFileIds: [fileId] });
      const upload = letter.imageUploads!.find((v) => v.finalFileId === fileId)!;
      return {
        url: await storage.temporaryUrl(fileId, 600),
        size: upload.fileSize!,
        mimeType: upload.mimeType as 'image/jpeg' | 'image/png',
      };
    },
  };
}
