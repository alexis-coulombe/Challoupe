import { api } from '../../api';
import type { User } from '../../models/User';
import type { UserFormValues } from '../../models/UserFormValues';
import type { UserUpdate } from '../../models/UserUpdate';

class UsersApi {
  /**
   * Get all users
   * @returns Users list
   */
  list() {
    return api.get<User[]>('/users');
  }

  /**
   * Create new user
   * @param values UserFormValues
   * @returns Creation response
   */
  create(values: UserFormValues) {
    return api.post('/users', values);
  }

  /**
   * Update user
   * @param id number
   * @param values UserUpdate
   * @returns Update response
   */
  update(id: number, values: UserUpdate) {
    return api.put(`/users/${id}`, values);
  }

  /**
   * Delete user
   * @param id number
   * @returns void
   */
  remove(id: number) {
    return api.delete(`/users/${id}`);
  }

  /**
   * Disable TOTP for a user
   * @param id number
   * @returns Disable response
   */
  disableTotp(id: number) {
    return api.post(`/users/${id}/totp/disable`);
  }
}

export const usersApi = new UsersApi();
