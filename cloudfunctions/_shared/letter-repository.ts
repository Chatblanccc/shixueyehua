import type { LetterFields, LetterStatus } from '../../shared';
import type { SafetyResult } from './content-safety';
import type { AudioUploadRecord } from './audio-repository';
export interface LetterRecord extends LetterFields {
  _id: string;
  authorId: string;
  schoolId: string;
  gradeId: string;
  classId: string;
  revision: number;
  contentHash: string;
  reviewStatus: LetterStatus;
  reviewReason: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  safety: SafetyResult | null;
  imageUploads?: AudioUploadRecord[];
}
export interface LetterReader {
  letterImageLimit(schoolId: string): Promise<number>;
  findLetter(id: string): Promise<LetterRecord | undefined>;
}
export interface LetterTransaction extends LetterReader {
  saveLetter(letter: LetterRecord, exists: boolean): Promise<void>;
}
