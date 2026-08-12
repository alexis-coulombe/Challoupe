import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { hostsApi } from './api/hostsApi';
import { useBulkAction } from '../hooks/useBulkAction';
import type { HostFormValues } from '../models/HostFormValues';
import type { HostTestState } from '../models/HostTestState';

/**
 * Framework-agnostic host domain logic
 */
class HostsService {
  readonly idleTestState: HostTestState = { status: 'idle' };

  testResultState(result: { ok: boolean; error?: string }): HostTestState {
    return result.ok ? { status: 'ok' } : { status: 'error', error: result.error };
  }
}

export const hostsService = new HostsService();

interface UseHostsServiceOptions {
  onBulkRemoved: () => void;
}

/**
 * React Query adapter around HostsService
 * @returns Adapter object
 */
export function useHostsService({ onBulkRemoved }: UseHostsServiceOptions) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['hosts'],
    queryFn: () => hostsApi.list(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['hosts'] });

  const create = useMutation({
    mutationFn: (values: HostFormValues) => hostsApi.create(values),
    onSuccess: () => {
      message.success('Host added');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, ...values }: HostFormValues & { id: number }) => hostsApi.update(id, values),
    onSuccess: () => {
      message.success('Host updated');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => hostsApi.remove(id),
    onSuccess: () => {
      message.success('Host deleted');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const testStored = useMutation({
    mutationFn: (id: number) => hostsApi.testExisting(id),
    onSuccess: (result) => {
      if (result.ok) message.success('Connected successfully');
      else message.error(result.error ?? 'Could not connect');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const bulkRemove = useBulkAction<number>({
    queryKey: ['hosts'],
    run: (id) => hostsApi.remove(id),
    successLabel: (count) => `${count} host(s) deleted`,
    onSettled: onBulkRemoved,
  });

  return {
    hosts: data,
    isLoading,
    invalidate,
    create,
    update,
    remove,
    testStored,
    bulkRemove,
  };
}
