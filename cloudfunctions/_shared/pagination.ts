import { createHmac, timingSafeEqual } from 'node:crypto';
import { isRecord } from '../../shared';
import { AppError } from './errors';
import { identifier } from './validate';

export interface PagePosition {
  /** Descending sort uses (timestamp, _id), making equal timestamps deterministic. */
  timestamp: string;
  id: string;
}

function validatePosition(value: unknown): PagePosition {
  if (!isRecord(value) || typeof value.timestamp !== 'string')
    throw new AppError('INVALID_ARGUMENT');
  const date = new Date(value.timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.timestamp)
    throw new AppError('INVALID_ARGUMENT');
  return { timestamp: value.timestamp, id: identifier(value.id) };
}

export function pageSize(value: unknown): number {
  if (value === undefined) return 20;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 20)
    throw new AppError('INVALID_ARGUMENT');
  return value;
}

/** Scope must include user/school/query filters derived by the server, never a client authorization field. */
export function createCursorCodec(signingKey: string) {
  if (Buffer.byteLength(signingKey) < 32) throw new Error('Cursor signing key is not configured');
  const signature = (data: string) => createHmac('sha256', signingKey).update(data).digest();
  return {
    encode(position: PagePosition, scope: string): string {
      const valid = validatePosition(position);
      if (!scope || scope.length > 512) throw new AppError('INVALID_ARGUMENT');
      const data = Buffer.from(JSON.stringify({ version: 1, scope, ...valid })).toString(
        'base64url',
      );
      return `${data}.${signature(data).toString('base64url')}`;
    },
    decode(cursor: unknown, scope: string): PagePosition | undefined {
      if (cursor === undefined) return undefined;
      if (
        typeof cursor !== 'string' ||
        cursor.length > 2048 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor)
      )
        throw new AppError('INVALID_ARGUMENT');
      const [data, mac] = cursor.split('.');
      if (!data || !mac) throw new AppError('INVALID_ARGUMENT');
      const actual = Buffer.from(mac, 'base64url');
      const expected = signature(data);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected) ||
        actual.toString('base64url') !== mac
      )
        throw new AppError('INVALID_ARGUMENT');
      let value: unknown;
      try {
        const decoded = Buffer.from(data, 'base64url');
        if (decoded.toString('base64url') !== data) throw new Error('Noncanonical cursor');
        value = JSON.parse(decoded.toString('utf8')) as unknown;
      } catch {
        throw new AppError('INVALID_ARGUMENT');
      }
      if (!isRecord(value) || value.version !== 1 || value.scope !== scope)
        throw new AppError('INVALID_ARGUMENT');
      return validatePosition(value);
    },
  };
}
