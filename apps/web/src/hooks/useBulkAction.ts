import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { runBulk } from '../utils';

interface UseBulkActionOptions<TKey> {
  queryKey: QueryKey;
  run: (key: TKey) => Promise<unknown>;
  successLabel: (count: number) => string;
  onSettled: () => void;
}

// Runs a single action over every selected row, reporting success/failure
// counts and refreshing the list — the shared shape behind every table's
// bulk-delete button.
export function useBulkAction<TKey>({ queryKey, run, successLabel, onSettled }: UseBulkActionOptions<TKey>) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (keys: TKey[]) => runBulk(keys, run),
    onSuccess: ({ ok, errors }) => {
      if (ok) message.success(successLabel(ok));
      if (errors.length) message.error(`${errors.length} failure(s) — ${errors[0]}`);
      onSettled();
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
