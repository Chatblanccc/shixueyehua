import { parseLoginResult } from '../generated/shared';
import type { UpdateProfileInput } from '../generated/shared';
import { callCloud } from './cloud-api';

export const authService = {
  login: () => callCloud('authApi', 'login', parseLoginResult),
  getProfile: () => callCloud('authApi', 'getProfile', parseLoginResult),
  updateProfile: (payload: UpdateProfileInput) =>
    callCloud('authApi', 'updateProfile', parseLoginResult, payload),
};
