import { useQuery } from '@tanstack/react-query';
import { api, type AppSettings } from '../api';

// Shared fetch for the app-wide settings (default restart policy, refresh
// interval, log tail, terminal shell) — cached under one query key so every
// consumer reads the same values without refetching independently.
export function useAppSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<AppSettings>('/settings'),
    staleTime: 60_000,
  });
}
