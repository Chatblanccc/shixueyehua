import { parseOwnLetter, parseOwnLetterPage } from '../generated/shared';
import type { LetterFields } from '../generated/shared';
import { callCloud } from './cloud-api';
export const letterService = {
  create: (requestKey: string, fields: LetterFields) =>
    callCloud('letterApi', 'createDraft', parseOwnLetter, { requestKey, ...fields }),
  update: (letterId: string, revision: number, fields: LetterFields) =>
    callCloud('letterApi', 'updateDraft', parseOwnLetter, { letterId, revision, ...fields }),
  detail: (letterId: string) => callCloud('letterApi', 'detail', parseOwnLetter, { letterId }),
  list: (cursor?: string) =>
    callCloud('letterApi', 'listMine', parseOwnLetterPage, { ...(cursor ? { cursor } : {}) }),
  transition: (letterId: string, revision: number, action: 'submit' | 'withdraw' | 'delete') =>
    callCloud('letterApi', action, parseOwnLetter, { letterId, revision }),
};
