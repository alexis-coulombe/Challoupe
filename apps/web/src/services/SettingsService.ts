import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { backupApi } from './api/backupApi';
import { imagesApi } from './api/imagesApi';
import { settingsApi } from './api/settingsApi';
import { systemApi } from './api/systemApi';
import { systemStatsApi } from './api/systemStatsApi';
import { useAuth } from '../auth';
import type { AppSettings } from '../models/AppSettings';
import type { BackupFile } from '../models/BackupFile';

// Framework-agnostic settings-page domain logic: no React, no react-query, no HTTP. Anything
// that touches useQuery/useMutation/App.useApp() belongs in the hooks below instead, since
// those are React hooks and can't live in a class method.
class SettingsService {
  // Every "test connection" action on this page (Ollama, webhook, ntfy) follows the same
  // try/catch shape: surface the server's message for an ApiError, else a generic fallback.
  errorMessage(err: unknown, fallback: string): string {
    return err instanceof ApiError ? err.message : fallback;
  }
}

export const settingsService = new SettingsService();

// React Query adapter for the Settings page's core concerns: system info, save/reset,
// backup restore, scheduled backups, and the one-off Trivy image pull. Cache invalidation
// and antd toasts live here; page-owned UI state (form resets) is wired by the caller
// through each mutation's call-site options.
export function useSettingsService() {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { logout, refresh } = useAuth();

  const { data: info } = useQuery({
    queryKey: ['system-info'],
    queryFn: () => systemApi.info('local'),
  });

  const pullTrivy = useMutation({
    mutationFn: (reference: string) => imagesApi.pull('local', reference),
    onSuccess: () => message.success('Trivy image pulled and ready to scan'),
    onError: (err: Error) => message.error(err.message),
  });

  const save = useMutation({
    mutationFn: (values: AppSettings) => settingsApi.update(values),
    onSuccess: () => {
      message.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const reset = useMutation({
    mutationFn: () => settingsApi.reset(),
    onSuccess: async () => {
      message.success('Factory reset complete. Create a new administrator account to continue.');
      await refresh();
      navigate('/login', { replace: true });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const restore = useMutation({
    mutationFn: (data: BackupFile) => backupApi.restore(data),
    onSuccess: async () => {
      message.success('Restore complete. Please sign in again.');
      await logout().catch(() => {}); // the server session is already destroyed; this just clears local state
      navigate('/login', { replace: true });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const { data: scheduledBackups } = useQuery({
    queryKey: ['scheduled-backups'],
    queryFn: () => backupApi.listScheduled(),
  });

  const invalidateScheduledBackups = () =>
    queryClient.invalidateQueries({ queryKey: ['scheduled-backups'] });

  const runBackup = useMutation({
    mutationFn: () => backupApi.runScheduled(),
    onSuccess: (res) => {
      message.success(`Wrote ${res.filename}`);
      invalidateScheduledBackups();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const deleteBackup = useMutation({
    mutationFn: (filename: string) => backupApi.removeScheduled(filename),
    onSuccess: () => {
      message.success('Backup deleted');
      invalidateScheduledBackups();
    },
    onError: (err: Error) => message.error(err.message),
  });

  return {
    info,
    pullTrivy,
    save,
    reset,
    restore,
    scheduledBackups,
    runBackup,
    deleteBackup,
  };
}

interface UseSystemStatsTokenServiceOptions {
  onRegenerated: (token: string) => void;
}

// React Query adapter for the System Stats API token widget (SystemStatsCard): its own
// query key and API domain (systemStatsApi), independent of the rest of the settings form.
export function useSystemStatsTokenService({ onRegenerated }: UseSystemStatsTokenServiceOptions) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data: tokenStatus } = useQuery({
    queryKey: ['system-stats-token'],
    queryFn: () => systemStatsApi.getToken(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['system-stats-token'] });

  const regenerate = useMutation({
    mutationFn: () => systemStatsApi.regenerateToken(),
    onSuccess: ({ token }) => {
      onRegenerated(token);
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const revoke = useMutation({
    mutationFn: () => systemStatsApi.revokeToken(),
    onSuccess: () => {
      message.success('System stats token revoked');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  return {
    tokenStatus,
    regenerate,
    revoke,
  };
}
