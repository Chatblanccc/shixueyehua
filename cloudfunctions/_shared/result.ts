import { ERROR_MESSAGES } from '../../shared';
import type { ApiResult } from '../../shared';
import { publicErrorCode } from './errors';

export function success<T>(data: T, requestId: string): ApiResult<T> {
  return { success: true, data, requestId };
}

export function failure(error: unknown, requestId: string): ApiResult<never> {
  const code = publicErrorCode(error);
  return { success: false, error: { code, message: ERROR_MESSAGES[code], requestId }, requestId };
}
