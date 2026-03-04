import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { createElement } from 'react';
import {
  authStatus,
  authLogin,
  authLogout,
  authSetup,
  setStoredToken,
  clearStoredToken,
  getStoredToken,
  type AuthUser,
} from '../api/client';

// ── Types ────────────────────────────────────────────────────────────────────

type Role = 'admin' | 'tester' | 'viewer';

const ROLE_HIERARCHY: Record<Role, number> = {
  admin: 3,
  tester: 2,
  viewer: 1,
};

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isSetupRequired: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setup: (username: string, displayName: string, password: string) => Promise<void>;
  hasRole: (minRole: Role) => boolean;
  refreshStatus: () => Promise<void>;
}

// ── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  isAuthenticated: false,
  isSetupRequired: false,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
  setup: async () => {},
  hasRole: () => false,
  refreshStatus: async () => {},
});

// ── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [isSetupRequired, setIsSetupRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await authStatus();
      if (status.setupRequired) {
        setIsSetupRequired(true);
        setUser(null);
      } else if (status.authenticated && status.user) {
        setIsSetupRequired(false);
        setUser(status.user);
      } else {
        setIsSetupRequired(false);
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check auth status on mount
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await authLogin(username, password);
    setStoredToken(result.token);
    setToken(result.token);
    setUser(result.user);
    setIsSetupRequired(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authLogout();
    } catch {
      // Ignore errors on logout
    }
    clearStoredToken();
    setToken(null);
    setUser(null);
  }, []);

  const setup = useCallback(async (username: string, displayName: string, password: string) => {
    const result = await authSetup({ username, displayName, password });
    setStoredToken(result.token);
    setToken(result.token);
    setUser(result.user);
    setIsSetupRequired(false);
  }, []);

  const hasRole = useCallback((minRole: Role): boolean => {
    if (!user) return false;
    return ROLE_HIERARCHY[user.role as Role] >= ROLE_HIERARCHY[minRole];
  }, [user]);

  const value: AuthContextValue = {
    user,
    token,
    isAuthenticated: !!user,
    isSetupRequired,
    isLoading,
    login,
    logout,
    setup,
    hasRole,
    refreshStatus,
  };

  return createElement(AuthContext.Provider, { value }, children);
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
