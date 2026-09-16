import { createAudioStorage } from './audio-storage';
import { DEFAULT_AUDIO_UPLOAD_LIMITS } from '../adminAudioApi/audio';
import cloud from 'wx-server-sdk';
import { isRecord } from '../../shared';
import { consoleLogger } from './audit';
import { CloudRepository } from './db';
import { createHandler } from './handler';
import type { Domain } from './handler';

let initialized = false;
function sdk() {
  if (!initialized) {
    const context: unknown = cloud.getWXContext();
    if (!isRecord(context) || typeof context.ENV !== 'string' || !context.ENV) {
      throw new Error('Cloud environment is unavailable');
    }
    // ENV is supplied by the deployed cloud runtime; never accepted from event payload.
    // The locked SDK's init declaration accepts a string, avoiding an unsafe symbol cast.
    cloud.init({ env: context.ENV });
    initialized = true;
  }
  return cloud;
}

/** Lazy SDK initialization allows isolated package loading without contacting a cloud environment. */
export function createRuntimeHandler(domain: Domain) {
  return createHandler(domain, {
    repository: new CloudRepository(() => {
      const options: { env?: string; throwOnNotFound: boolean } = { throwOnNotFound: false };
      return sdk().database(options);
    }),
    audioStorage: createAudioStorage(() => {
      const context: unknown = sdk().getWXContext();
      if (!isRecord(context) || typeof context.ENV !== 'string' || !context.ENV)
        throw new Error('Cloud environment is unavailable');
      return context.ENV;
    }),
    audioUploadLimits: {
      audioMaxBytes: uploadLimit(
        'SHIXUE_AUDIO_MAX_BYTES',
        DEFAULT_AUDIO_UPLOAD_LIMITS.audioMaxBytes,
      ),
      coverMaxBytes: uploadLimit(
        'SHIXUE_COVER_MAX_BYTES',
        DEFAULT_AUDIO_UPLOAD_LIMITS.coverMaxBytes,
      ),
    },
    getContext: () => cloud.getWXContext(),
    getEnvironment: () => process.env.APP_ENV,
    logger: consoleLogger,
  });
}

function uploadLimit(name: string, maximum: number): number {
  const value = process.env[name];
  if (value === undefined) return maximum;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum)
    throw new Error('Invalid upload size configuration');
  return parsed;
}
