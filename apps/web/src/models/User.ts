import type { Permissions } from './permissions';

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  created_at: string;
  authProvider: 'local' | 'oidc';
  permissions: Permissions;
  totpEnabled: boolean;
}
