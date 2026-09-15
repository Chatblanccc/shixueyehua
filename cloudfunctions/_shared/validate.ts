import { isRecord } from '../../shared';
import { AppError } from './errors';

export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new AppError('INVALID_ARGUMENT');
  return value;
}

export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(value)) {
    throw new AppError('INVALID_ARGUMENT');
  }
  return value;
}

export interface ParsedAction {
  action: string;
  payload: Record<string, unknown>;
}

export function parseAction(value: unknown): ParsedAction {
  const event = record(value);
  if (typeof event.action !== 'string' || !/^[a-z][A-Za-z]{0,39}$/.test(event.action)) {
    throw new AppError('INVALID_ARGUMENT');
  }
  return {
    action: event.action,
    payload: event.payload === undefined ? {} : record(event.payload),
  };
}
