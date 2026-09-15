import { ERROR_MESSAGES, isErrorCode, isRecord } from '../generated/shared';
import type { ErrorCode } from '../generated/shared';

export class CloudClientError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly requestId: string,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'CloudClientError';
  }
}

export interface CloudInvocation {
  name: string;
  data: { action: string; payload?: unknown; requestId: string };
}
export type CloudTransport = (request: CloudInvocation) => Promise<unknown>;

function requestId(): string {
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createCloudClient(transport: CloudTransport, timeoutMs = 12000) {
  return async function call<T>(
    name: string,
    action: string,
    parse: (value: unknown) => T,
    payload?: unknown,
  ): Promise<T> {
    const id = requestId();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        Promise.resolve().then(() => transport({ name, data: { action, payload, requestId: id } })),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new CloudClientError('TIMEOUT', id)), timeoutMs);
        }),
      ]);
      if (!isRecord(raw) || typeof raw.success !== 'boolean')
        throw new CloudClientError('INVALID_RESPONSE', id);
      const serverId =
        typeof raw.requestId === 'string' && /^[\w-]{1,128}$/.test(raw.requestId)
          ? raw.requestId
          : id;
      if (!raw.success) {
        if (!isRecord(raw.error) || !isErrorCode(raw.error.code))
          throw new CloudClientError('INVALID_RESPONSE', serverId);
        // Never display raw SDK messages or server-provided stack traces.
        throw new CloudClientError(raw.error.code, serverId);
      }
      try {
        return parse(raw.data);
      } catch {
        throw new CloudClientError('INVALID_RESPONSE', serverId);
      }
    } catch (error: unknown) {
      if (error instanceof CloudClientError) throw error;
      throw new CloudClientError('NETWORK_ERROR', id);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
