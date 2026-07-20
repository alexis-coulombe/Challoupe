import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { useBulkAction } from './useBulkAction';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <AntApp>{children}</AntApp>
    </QueryClientProvider>
  );
}

describe('useBulkAction', () => {
  it('runs the action over every key and reports the success count', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const successLabel = vi.fn((count: number) => `${count} deleted`);
    const onSettled = vi.fn();

    const { result } = renderHook(
      () => useBulkAction<string>({ queryKey: ['things'], run, successLabel, onSettled }),
      { wrapper }
    );

    result.current.mutate(['a', 'b', 'c']);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(run).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledWith('a');
    expect(successLabel).toHaveBeenCalledWith(3);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('continues past individual failures and still calls onSettled', async () => {
    const run = vi.fn((key: string) => (key === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve()));
    const onSettled = vi.fn();

    const { result } = renderHook(
      () =>
        useBulkAction<string>({
          queryKey: ['things'],
          run,
          successLabel: (count) => `${count} done`,
          onSettled,
        }),
      { wrapper }
    );

    result.current.mutate(['good', 'bad']);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(run).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
