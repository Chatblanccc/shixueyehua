import { createRuntimeHandler } from '../_shared/runtime';
import { createRuntimeSafetyCallback } from '../_shared/runtime';
import { isRecord } from '../../shared';

const actions = createRuntimeHandler('letterApi');
const callback = createRuntimeSafetyCallback();
export const main = (event: unknown) =>
  isRecord(event) && event.httpMethod !== undefined ? callback(event) : actions(event);
