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
    repository: new CloudRepository(() => sdk().database()),
    getContext: () => cloud.getWXContext(),
    getEnvironment: () => process.env.APP_ENV,
    logger: consoleLogger,
  });
}
