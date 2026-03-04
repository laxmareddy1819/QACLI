import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ShieldOff } from 'lucide-react';

// ── AuthGuard ────────────────────────────────────────────────────────────────

/**
 * Wraps protected routes. Redirects to /login or /setup as needed.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, isSetupRequired } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (isSetupRequired) {
      navigate('/setup', { replace: true });
    } else if (!isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isLoading, isAuthenticated, isSetupRequired, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-0">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-lg animate-pulse">
            Q
          </div>
          <span className="text-sm text-gray-500">Loading...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return <>{children}</>;
}

// ── RoleGuard ────────────────────────────────────────────────────────────────

type Role = 'admin' | 'tester' | 'viewer';

/**
 * Wraps routes that require a minimum role. Shows access denied for insufficient permissions.
 */
export function RoleGuard({ minRole, children }: { minRole: Role; children: ReactNode }) {
  const { hasRole } = useAuth();

  if (!hasRole(minRole)) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <ShieldOff size={24} className="text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-200">Access Denied</h2>
          <p className="text-sm text-gray-500 max-w-sm">
            You don't have permission to access this page. Contact an administrator if you need access.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// ── RoleVisible ──────────────────────────────────────────────────────────────

/**
 * Inline conditional render by role. Shows children only if user has the required role.
 */
export function RoleVisible({
  minRole,
  children,
  fallback,
}: {
  minRole: Role;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { hasRole } = useAuth();
  return hasRole(minRole) ? <>{children}</> : <>{fallback}</> || null;
}
