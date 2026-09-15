import { environment } from '../config/env';
import { parseLoginResult } from '../generated/shared';
import { CloudClientError, createCloudClient } from './cloud-client';

const call = createCloudClient(async (request) => {
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

export const authService = {
  login: () => call('authApi', 'login', parseLoginResult),
  getProfile: () => call('authApi', 'getProfile', parseLoginResult),
};
