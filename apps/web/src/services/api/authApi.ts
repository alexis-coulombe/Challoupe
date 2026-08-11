import { api } from '../api';
import type { AuthStatus, LoginResult, OidcLoginConfig, TotpSetup } from '../api';

export class AuthApi {
  status() {
    return api.get<AuthStatus>('/auth/status');
  }

  logout() {
    return api.post('/auth/logout');
  }

  oidcConfig() {
    return api.get<OidcLoginConfig>('/auth/oidc/config');
  }

  setup(values: { username: string; password: string }) {
    return api.post<LoginResult>('/auth/setup', values);
  }

  login(values: { username: string; password: string }) {
    return api.post<LoginResult>('/auth/login', values);
  }

  totpVerify(values: { token: string }) {
    return api.post('/auth/totp/verify', values);
  }

  totpSetup() {
    return api.post<TotpSetup>('/auth/totp/setup');
  }

  totpConfirm(values: { token: string }) {
    return api.post<{ backupCodes: string[] }>('/auth/totp/confirm', values);
  }

  totpDisable(values: { password: string }) {
    return api.post('/auth/totp/disable', values);
  }

  totpBackupCodes(values: { password: string }) {
    return api.post<{ backupCodes: string[] }>('/auth/totp/backup-codes', values);
  }

  changePassword(values: { current: string; next: string }) {
    return api.post('/auth/password', values);
  }
}

export const authApi = new AuthApi();
