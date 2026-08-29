import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { usersApi } from './api/usersApi';
import { useBulkAction } from '../hooks/useBulkAction';
import type { Permission, Permissions } from '../models/permissions';
import type { UserFormValues } from '../models/UserFormValues';
import type { UserUpdate } from '../models/UserUpdate';

const PERMISSION_LABELS: Record<Permission, string> = {
  manageContainers: 'Manage containers: create & delete',
  manageImages: 'Manage images: pull, delete, prune',
  manageVolumes: 'Manage volumes: create, delete, prune',
  manageNetworks: 'Manage networks: create & delete',
  manageStacks: 'Manage stacks: create, edit, delete',
  exec: 'Terminal: shell access into containers',
  useAi: 'AI Assistant',
  useSecurityScanner: 'Vulnerability scanner',
};

const PERMISSION_SHORT_LABELS: Record<Permission, string> = {
  manageContainers: 'Containers',
  manageImages: 'Images',
  manageVolumes: 'Volumes',
  manageNetworks: 'Networks',
  manageStacks: 'Stacks',
  exec: 'Terminal',
  useAi: 'AI',
  useSecurityScanner: 'Security',
};

/**
 * Framework-agnostic user domain logic
 */
class UsersService {
  /**
   * Get permission label string
   * @param permission Permission
   * @returns Permission label
   */
  permissionLabel(permission: Permission): string {
    return PERMISSION_LABELS[permission];
  }

  /**
   * Get permission short label string
   * @param permission Permission
   * @returns Permission short label
   */
  permissionShortLabel(permission: Permission): string {
    return PERMISSION_SHORT_LABELS[permission];
  }

  // Mirrors the server's defaults: AI and the security scanner stay on since every
  // authenticated user could already use them (gated only by the app-wide feature flag);
  // everything that creates/destroys Docker resources or opens a shell starts off.
  defaultPermissions(): Permissions {
    return {
      manageContainers: false,
      manageImages: false,
      manageVolumes: false,
      manageNetworks: false,
      manageStacks: false,
      exec: false,
      useAi: true,
      useSecurityScanner: true,
    };
  }
}

export const usersService = new UsersService();

interface UseUsersServiceOptions {
  onBulkRemoved: () => void;
}

/**
 * React Query adapter around UsersService
 * @returns Adapter object
 */
export function useUsersService({ onBulkRemoved }: UseUsersServiceOptions) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const create = useMutation({
    mutationFn: (values: UserFormValues) => usersApi.create(values),
    onSuccess: () => {
      message.success('User created');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, ...values }: UserUpdate & { id: number }) => usersApi.update(id, values),
    onSuccess: () => {
      message.success('User updated');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => usersApi.remove(id),
    onSuccess: () => {
      message.success('User deleted');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const resetTotp = useMutation({
    mutationFn: (id: number) => usersApi.disableTotp(id),
    onSuccess: () => {
      message.success('Two-factor authentication reset for this user');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const bulkRemove = useBulkAction<number>({
    queryKey: ['users'],
    run: (id) => usersApi.remove(id),
    successLabel: (count) => `${count} user(s) deleted`,
    onSettled: onBulkRemoved,
  });

  return {
    users: data,
    isLoading,
    invalidate,
    create,
    update,
    remove,
    resetTotp,
    bulkRemove,
  };
}
