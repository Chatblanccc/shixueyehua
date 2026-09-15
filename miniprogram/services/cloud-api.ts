import { environment } from '../config/env';
import { CloudClientError, createCloudClient } from './cloud-client';

/** One real transport for all domains; unavailable cloud never becomes mock success. */
export const callCloud = createCloudClient(async (request) => {
  if (!environment.cloudConfigured || !environment.envId || !wx.cloud) {
    throw new CloudClientError('NETWORK_ERROR', 'local-cloud-unavailable');
  }
  const response = await wx.cloud.callFunction({
    name: request.name,
    data: request.data,
    config: { env: environment.envId },
  });
  return response.result;
});
