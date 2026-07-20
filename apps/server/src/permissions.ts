// The granular capabilities a "user"-role account can be individually granted.
// An "admin" account always has every permission and never consults this list —
// see requirePermission() in auth.ts.
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

// AI and the vulnerability scanner default to on (matching pre-existing behavior, where
// every authenticated user could use them once the app-wide feature flag was enabled).
// Everything that can create/destroy Docker resources or open a shell defaults to off.
export const DEFAULT_PERMISSIONS: Permissions = {
  manageContainers: false,
  manageImages: false,
  manageVolumes: false,
  manageNetworks: false,
  manageStacks: false,
  exec: false,
  useAi: true,
  useSecurityScanner: true,
};

export const PERMISSION_COLUMNS: Record<Permission, string> = {
  manageContainers: 'can_manage_containers',
  manageImages: 'can_manage_images',
  manageVolumes: 'can_manage_volumes',
  manageNetworks: 'can_manage_networks',
  manageStacks: 'can_manage_stacks',
  exec: 'can_exec',
  useAi: 'can_use_ai',
  useSecurityScanner: 'can_use_security_scanner',
};
