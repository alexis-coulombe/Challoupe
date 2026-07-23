import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { AuthStatus, User } from './api';
import { authApi } from './services/authApi';

interface AuthContextValue {
  user: User | null;
  setupRequired: boolean;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState(false);

  // A failed request must not be treated as "no setup needed, nobody logged in" — that
  // fake-good status used to hide the first-run setup screen (or silently log out an
  // authenticated user) behind a single dropped request. Leave `status` as-is and surface
  // `error` instead so the caller can offer a retry rather than guessing.
  const refresh = useCallback(async () => {
    try {
      const result = await authApi.status();
      setStatus(result);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await authApi.logout();
    setStatus((s) => ({ setupRequired: s?.setupRequired ?? false, user: null }));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user: status?.user ?? null,
        setupRequired: status?.setupRequired ?? false,
        loading: status === null,
        error,
        refresh,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
