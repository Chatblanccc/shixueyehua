import { ERROR_MESSAGES } from '../../shared';
import type { ErrorCode } from '../../shared';

/** Only these public codes/messages cross the cloud boundary. */
export class AppError extends Error {
  constructor(readonly code: ErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AppError';
  }
}

export function publicErrorCode(error: unknown): ErrorCode {
  return error instanceof AppError ? error.code : 'INTERNAL_ERROR';
}
