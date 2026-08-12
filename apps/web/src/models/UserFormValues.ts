import type { Permissions } from './permissions';

export interface UserFormValues {
  username: string;
  password: string;
  role: 'admin' | 'user';
  permissions: Permissions;
}
