import { isRecord } from '../../shared';
import { createSafetyCallback } from './safety-callback';
import type { CallbackConfig, MediaSafetySink, SafetyCallbackResponse } from './safety-callback';

/** CloudBase HTTP mapping; config is server-injected, never read from request fields. */
export function createSafetyHttpHandler(
  getConfig: () => CallbackConfig,
  sink: MediaSafetySink,
  now?: () => Date,
) {
  return async (event: unknown): Promise<SafetyCallbackResponse> => {
    if (
      !isRecord(event) ||
      typeof event.httpMethod !== 'string' ||
      event.isBase64Encoded === true ||
      (event.body !== undefined && typeof event.body !== 'string')
    )
      return { statusCode: 400, body: 'bad request' };
    try {
      return await createSafetyCallback(
        getConfig(),
        sink,
        now,
      )({ method: event.httpMethod, query: event.queryStringParameters, body: event.body });
    } catch {
      return { statusCode: 503, body: 'unavailable' };
    }
  };
}
