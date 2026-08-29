import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { stacksApi } from './api/stacksApi';
import { useAppSettings } from '../hooks/useAppSettings';
import { runBulk } from '../utils';
import type { ComposeResult } from '../models/ComposeResult';

type BulkStackAction = 'deploy' | 'down' | 'delete';

/**
 * Framework-agnostic stack domain logic
 */
class StacksService {
  private readonly pastTense: Record<BulkStackAction, string> = {
    deploy: 'deployed',
    down: 'stopped',
    delete: 'deleted',
  };

  /**
   * Get bulk action string
   * @param action BulkStackAction
   * @param count number
   * @returns Bulk action message
   */
  bulkActionLabel(action: BulkStackAction, count: number): string {
    return `${count} stack(s) ${this.pastTense[action]}`;
  }
}

export const stacksService = new StacksService();

interface UseStacksServiceOptions {
  onBulkDone: () => void;
}

/**
 * React Query adapter around StacksService
 * @returns Adapter object
 */
export function useStacksService({ onBulkDone }: UseStacksServiceOptions) {
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const { data: settings } = useAppSettings();

  const { data, isLoading } = useQuery({
    queryKey: ['stacks'],
    queryFn: () => stacksApi.list(),
    refetchInterval: settings?.refreshIntervalMs ?? 5000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['stacks'] });

  const showResult = (title: string, result: ComposeResult) => {
    if (result.ok) {
      message.success(title);
    } else {
      modal.error({
        title: `${title}: failed`,
        width: 720,
        content: (
          <pre style={{ maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {result.output}
          </pre>
        ),
      });
    }
    invalidate();
  };

  const deploy = useMutation({
    mutationFn: (name: string) => stacksApi.deploy(name),
    onSuccess: (result) => showResult('Deployment', result),
    onError: (err: Error) => message.error(err.message),
  });

  const down = useMutation({
    mutationFn: (name: string) => stacksApi.down(name),
    onSuccess: (result) => showResult('Stop', result),
    onError: (err: Error) => message.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (name: string) => stacksApi.remove(name),
    onSuccess: () => {
      message.success('Stack deleted');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const bulk = useMutation({
    mutationFn: ({ action, names }: { action: BulkStackAction; names: string[] }) =>
      runBulk(names, async (name) => {
        if (action === 'delete') {
          await stacksApi.remove(name);
          return;
        }
        const result = action === 'deploy' ? await stacksApi.deploy(name) : await stacksApi.down(name);
        if (!result.ok) throw new Error(`${name}: ${result.output.slice(0, 200)}`);
      }),
    onSuccess: ({ ok, errors }, { action }) => {
      if (ok) message.success(stacksService.bulkActionLabel(action, ok));
      if (errors.length) message.error(`${errors.length} failure(s) : ${errors[0]}`);
      onBulkDone();
      invalidate();
    },
  });

  return {
    stacks: data,
    isLoading,
    invalidate,
    deploy,
    down,
    remove,
    bulk,
  };
}
