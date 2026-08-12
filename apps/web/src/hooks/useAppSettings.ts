import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../services/api/settingsApi';

/**
 * Shared fetch for the app-wide settings
 * @returns Global settings
 */
export function useAppSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
    staleTime: 60_000,
  });
}
