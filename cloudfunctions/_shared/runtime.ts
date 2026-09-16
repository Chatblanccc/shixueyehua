import { createAudioStorage } from './audio-storage';
import { createContentSafety } from './content-safety';
import { createWechatSafetyPlatform } from './wechat-content-safety';
import { DEFAULT_AUDIO_UPLOAD_LIMITS } from '../adminAudioApi/audio';
import cloud from 'wx-server-sdk';
import { isRecord } from '../../shared';
import { consoleLogger } from './audit';
import { CloudRepository } from './db';
import { createHandler } from './handler';
import type { Domain } from './handler';
import { CloudSafetyJobStore } from './safety-jobs-db';
import { createMediaSafetySink } from './safety-jobs';
import { createSafetyHttpHandler } from './safety-http';
import { createLetterImages } from '../letterApi/images';
import { createImageSafetyCoordinator } from './safety-submission';
import { CloudImageCheckStore } from './safety-submission-db';
import { AppError } from './errors';

let initialized = false;
export function createRuntimeSafetyCallback() {
  const store = new CloudSafetyJobStore(() => {
    const options: { env?: string; throwOnNotFound: boolean } = { throwOnNotFound: false };
    return sdk().database(options);
  });
  return createSafetyHttpHandler(
    () => ({
      appId: process.env.SHIXUE_CALLBACK_APP_ID ?? '',
      token: process.env.SHIXUE_CALLBACK_TOKEN ?? '',
      encodingAESKey: process.env.SHIXUE_CALLBACK_AES_KEY ?? '',
    }),
    createMediaSafetySink(store),
  );
}
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
  const database = () => {
    const options: { env?: string; throwOnNotFound: boolean } = { throwOnNotFound: false };
    return sdk().database(options);
  };
  const repository = new CloudRepository(database);
  const storage = createAudioStorage(() => {
    const context: unknown = sdk().getWXContext();
    if (!isRecord(context) || typeof context.ENV !== 'string' || !context.ENV)
      throw new Error('Cloud environment is unavailable');
    return context.ENV;
  });
  const letterImages = createLetterImages(repository, storage);
  const contentSafety = createContentSafety({
    platform: createWechatSafetyPlatform(() => sdk().openapi),
    resolveImage: (actor, fileId) => letterImages.resolve(actor.openid, fileId),
  });
  return createHandler(domain, {
    contentSafety,
    repository,
    audioStorage: storage,
    letterImages,
    imageChecks: {
      async check(input) {
        if (
          !process.env.SHIXUE_CALLBACK_APP_ID ||
          !process.env.SHIXUE_CALLBACK_TOKEN ||
          !process.env.SHIXUE_CALLBACK_AES_KEY
        )
          throw new AppError('CONTENT_CHECK_UNAVAILABLE');
        return createImageSafetyCoordinator({
          appId: process.env.SHIXUE_CALLBACK_APP_ID,
          store: new CloudImageCheckStore(database),
          safety: contentSafety,
        }).check(input);
      },
    },
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
