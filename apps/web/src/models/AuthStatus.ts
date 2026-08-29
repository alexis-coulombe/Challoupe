import type { User } from './User';

export interface AuthStatus {
  setupRequired: boolean;
  user: User | null;
}
