import type { LetterFields, LetterStatus } from '../../shared';
import type { SafetyResult } from './content-safety';
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
}
export interface LetterReader {
  findLetter(id: string): Promise<LetterRecord | undefined>;
}
export interface LetterTransaction extends LetterReader {
  saveLetter(letter: LetterRecord, exists: boolean): Promise<void>;
}
