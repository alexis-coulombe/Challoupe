import type { User } from './User';

export const PERMISSIONS = [
  'manageContainers',
  'manageImages',
  'manageVolumes',
  'manageNetworks',
  'manageStacks',
  'exec',
  'useAi',
  'useSecurityScanner',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Permissions = Record<Permission, boolean>;

export function hasPermission(user: User | null | undefined, permission: Permission): boolean {
  return user?.role === 'admin' || !!user?.permissions[permission];
}
