import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { auditLogApi } from './api/auditLogApi';
import { settingsApi } from './api/settingsApi';
import { useAppSettings } from '../hooks/useAppSettings';
import type { AuditLogEntry } from '../models/AuditLogEntry';

/**
 * Framework-agnostic audit log domain logic
 */
class AuditLogService {
  actionFilters(entries: AuditLogEntry[]): Array<{ text: string; value: string }> {
    return [...new Set(entries.map((entry) => entry.action))].map((action) => ({
      text: action,
      value: action,
    }));
  }
}

export const auditLogService = new AuditLogService();

/**
 * React Query adapter around AuditLogService
 * @returns Adapter object
 */
export function useAuditLogService() {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { data: settings } = useAppSettings();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => auditLogApi.list(),
    refetchInterval: settings?.refreshIntervalMs ?? 5000,
  });

  const enabled = settings?.featureFlags.auditLog !== false;

  const toggle = useMutation({
    mutationFn: (value: boolean) => settingsApi.update({ featureFlags: { auditLog: value } }),
    onSuccess: () => {
      message.success('Setting saved');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const clear = useMutation({
    mutationFn: () => auditLogApi.clear(),
    onSuccess: () => {
      message.success('Audit log cleared');
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  return {
    entries: data,
    isLoading,
    isFetching,
    refetch,
    enabled,
    toggle,
    clear,
  };
}
