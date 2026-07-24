import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HostSummary } from './api';
import { hostsApi } from './services/hostsApi';
import { useAuth } from './auth';

const STORAGE_KEY = 'challoupe.selectedHostId';

interface HostContextValue {
  hostId: string;
  setHostId: (id: string) => void;
  hosts: HostSummary[];
  currentHost: HostSummary | null;
}

const HostContext = createContext<HostContextValue | null>(null);

export function HostProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [hostId, setHostIdState] = useState(() => localStorage.getItem(STORAGE_KEY) ?? 'local');

  const { data: hosts } = useQuery({
    queryKey: ['hosts'],
    queryFn: () => hostsApi.list(),
    enabled: !!user,
  });

  const setHostId = (id: string) => {
    setHostIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  // If the previously-selected host was deleted elsewhere (another tab, another admin),
  // fall back to local rather than silently querying a host id that no longer exists.
  useEffect(() => {
    if (hostId !== 'local' && hosts && !hosts.some((h) => String(h.id) === hostId)) {
      setHostId('local');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosts, hostId]);

  const currentHost = useMemo(
    () => (hostId === 'local' ? null : (hosts?.find((h) => String(h.id) === hostId) ?? null)),
    [hosts, hostId]
  );

  return (
    <HostContext.Provider value={{ hostId, setHostId, hosts: hosts ?? [], currentHost }}>
      {children}
    </HostContext.Provider>
  );
}

export function useHost(): HostContextValue {
  const ctx = useContext(HostContext);
  if (!ctx) throw new Error('useHost must be used within HostProvider');
  return ctx;
}
