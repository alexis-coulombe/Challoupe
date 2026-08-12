import type { Permissions } from './permissions';

export interface UserUpdate {
  password?: string;
  role: 'admin' | 'user';
  permissions: Permissions;
}
