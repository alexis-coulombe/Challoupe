import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../services/settingsApi';

// Shared fetch for the app-wide settings (default restart policy, refresh
// interval, log tail, terminal shell), cached under one query key so every
// consumer reads the same values without refetching independently.
export function useAppSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
    staleTime: 60_000,
  });
}
