import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { formatBytes } from '../utils';
import { volumesApi } from './api/volumesApi';
import { useBulkAction } from '../hooks/useBulkAction';
import type { VolumeCreateRequest } from '../models/VolumeCreateRequest';

/**
 * Framework-agnostic volume logic
 */
class VolumesService {
  /**
   * Get prune volume string
   * @param spaceReclaimed number
   * @returns Prune message
   */
  pruneMessage(spaceReclaimed: number): string {
    return `Prune complete: ${formatBytes(spaceReclaimed)} reclaimed`;
  }

  bindMountOpts(hostPath: string): Record<string, string> {
    return { type: 'none', o: 'bind', device: hostPath };
  }
}

export const volumesService = new VolumesService();

interface UseVolumesServiceOptions {
  onBulkRemoved: () => void;
}

/**
 * React Query adapter around VolumesService
 * @param hostId string
 * @returns Adapter object
 */
export function useVolumesService(hostId: string, { onBulkRemoved }: UseVolumesServiceOptions) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['volumes', hostId],
    queryFn: () => volumesApi.list(hostId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['volumes', hostId] });

  const create = useMutation({
    mutationFn: (values: VolumeCreateRequest) => volumesApi.create(hostId, values),
    onSuccess: () => {
      message.success('Volume created');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (name: string) => volumesApi.remove(hostId, name),
    onSuccess: () => {
      message.success('Volume deleted');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const prune = useMutation({
    mutationFn: () => volumesApi.prune(hostId),
    onSuccess: (result) => {
      message.success(volumesService.pruneMessage(result.spaceReclaimed));
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const bulkRemove = useBulkAction<string>({
    queryKey: ['volumes', hostId],
    run: (name) => volumesApi.remove(hostId, name),
    successLabel: (count) => `${count} volume(s) deleted`,
    onSettled: onBulkRemoved,
  });

  return {
    volumes: data,
    isLoading,
    invalidate,
    create,
    remove,
    prune,
    bulkRemove,
  };
}
