import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { networksApi } from './api/networksApi';
import { useBulkAction } from '../hooks/useBulkAction';
import type { NetworkCreateRequest } from '../models/NetworkCreateRequest';

/**
 * Framework-agnostic network domain logic
 */
class NetworksService {
  // Docker always creates these three; they can't be deleted or bulk-selected for deletion.
  private readonly builtinNames = ['bridge', 'host', 'none'];

  /**
   * Check if network driver is builtin
   * @param name string
   * @returns True if builtin
   */
  isBuiltin(name: string): boolean {
    return this.builtinNames.includes(name);
  }
}

export const networksService = new NetworksService();

interface UseNetworksServiceOptions {
  onBulkRemoved: () => void;
}

/**
 * React Query adapter around NetworksService
 * @param hostId string
 * @returns Adapter object
 */
export function useNetworksService(hostId: string, { onBulkRemoved }: UseNetworksServiceOptions) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['networks', hostId],
    queryFn: () => networksApi.list(hostId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['networks', hostId] });

  const create = useMutation({
    mutationFn: (values: NetworkCreateRequest) => networksApi.create(hostId, values),
    onSuccess: () => {
      message.success('Network created');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => networksApi.remove(hostId, id),
    onSuccess: () => {
      message.success('Network deleted');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const bulkRemove = useBulkAction<string>({
    queryKey: ['networks', hostId],
    run: (id) => networksApi.remove(hostId, id),
    successLabel: (count) => `${count} network(s) deleted`,
    onSettled: onBulkRemoved,
  });

  return {
    networks: data,
    isLoading,
    invalidate,
    create,
    remove,
    bulkRemove,
  };
}
