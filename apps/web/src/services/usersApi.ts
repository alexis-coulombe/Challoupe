import { api } from '../api';
import type { Permissions, User } from '../api';

export interface UserFormValues {
  username: string;
  password: string;
  role: 'admin' | 'user';
  permissions: Permissions;
}

export interface UserUpdate {
  password?: string;
  role: 'admin' | 'user';
  permissions: Permissions;
}

export class UsersApi {
  list() {
    return api.get<User[]>('/users');
  }

  create(values: UserFormValues) {
    return api.post('/users', values);
  }

  update(id: number, values: UserUpdate) {
    return api.put(`/users/${id}`, values);
  }

  remove(id: number) {
    return api.delete(`/users/${id}`);
  }

  disableTotp(id: number) {
    return api.post(`/users/${id}/totp/disable`);
  }
}

export const usersApi = new UsersApi();
