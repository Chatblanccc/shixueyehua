import { isRecord, parseLetterFields, readString } from '../generated/shared';
import type { LetterFields } from '../generated/shared';
import { localModeEnabled } from './local-mode';
export interface LetterEditorDraft {
  letterId: string;
  revision: number;
  requestKey: string;
  fields: LetterFields;
}
const key = (userId: string) =>
  `shixue-letter-editor-${localModeEnabled() ? 'local' : 'cloud'}-${userId}`;
export function saveLetterEditor(userId: string, value: LetterEditorDraft): void {
  wx.setStorageSync(key(userId), value);
}
export function clearLetterEditor(userId: string): void {
  wx.removeStorageSync(key(userId));
}
export function readLetterEditor(userId: string): LetterEditorDraft | undefined {
  const value: unknown = wx.getStorageSync(key(userId));
  if (!value) return undefined;
  if (
    !isRecord(value) ||
    typeof value.letterId !== 'string' ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    throw new Error('本机未保存家书无法读取，请先保存当前内容');
  return {
    letterId: value.letterId,
    revision: value.revision,
    requestKey: readString(value.requestKey),
    fields: parseLetterFields(value.fields),
  };
}
