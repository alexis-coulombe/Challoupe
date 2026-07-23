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
