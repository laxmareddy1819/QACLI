// ── Role Definitions ─────────────────────────────────────────────────────────

export type Role = 'admin' | 'tester' | 'viewer';

const ROLE_HIERARCHY: Record<Role, number> = {
  admin: 3,
  tester: 2,
  viewer: 1,
};

export function hasPermission(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function isValidRole(role: string): role is Role {
  return role === 'admin' || role === 'tester' || role === 'viewer';
}

// ── Route Permission Map ─────────────────────────────────────────────────────

interface RoutePermission {
  method: string;       // 'GET', 'POST', 'PUT', 'DELETE', '*'
  pathPrefix: string;   // e.g. '/api/runner'
  minRole: Role;
}

/**
 * Declarative route permission map.
 * More specific rules are checked first (longer prefix matches win).
 * If no rule matches, the default is 'viewer' (read access).
 */
const ROUTE_PERMISSIONS: RoutePermission[] = [
  // ── Admin-only ────────────────────────────────────────────────
  { method: '*',      pathPrefix: '/api/auth/users',           minRole: 'admin' },
  { method: '*',      pathPrefix: '/api/audit',                minRole: 'admin' },
  { method: 'POST',   pathPrefix: '/api/cloud/providers',      minRole: 'admin' },
  { method: 'DELETE', pathPrefix: '/api/cloud/providers',      minRole: 'admin' },
  { method: 'POST',   pathPrefix: '/api/cloud/schedules',      minRole: 'admin' },
  { method: 'PUT',    pathPrefix: '/api/cloud/schedules',      minRole: 'admin' },
  { method: 'DELETE', pathPrefix: '/api/cloud/schedules',      minRole: 'admin' },
  { method: 'POST',   pathPrefix: '/api/config',               minRole: 'admin' },
  { method: 'PUT',    pathPrefix: '/api/config',               minRole: 'admin' },
  { method: 'PUT',    pathPrefix: '/api/llm/config',           minRole: 'admin' },

  // ── Tester (write operations) ─────────────────────────────────
  { method: 'POST',   pathPrefix: '/api/runner',               minRole: 'tester' },
  { method: 'DELETE', pathPrefix: '/api/runner',               minRole: 'tester' },
  { method: 'POST',   pathPrefix: '/api/files',                minRole: 'tester' },
  { method: 'PUT',    pathPrefix: '/api/files',                minRole: 'tester' },
  { method: 'DELETE', pathPrefix: '/api/files',                minRole: 'tester' },
  { method: 'POST',   pathPrefix: '/api/ai',                   minRole: 'tester' },
  { method: 'POST',   pathPrefix: '/api/browser',              minRole: 'tester' },
  { method: 'POST',   pathPrefix: '/api/recorder',             minRole: 'tester' },
  { method: 'POST',   pathPrefix: '/api/api-testing',          minRole: 'tester' },
  { method: 'PUT',    pathPrefix: '/api/api-testing',          minRole: 'tester' },
  { method: 'DELETE', pathPrefix: '/api/api-testing',          minRole: 'tester' },
  { method: 'POST',   pathPrefix: '/api/cicd',                 minRole: 'tester' },
  { method: 'POST',   pathPrefix: '/api/git',                  minRole: 'tester' },
  { method: 'POST',   pathPrefix: '/api/upload',               minRole: 'tester' },
  { method: 'POST',   pathPrefix: '/api/llm/test-connection',  minRole: 'tester' },
  { method: 'POST',   pathPrefix: '/api/chat',                 minRole: 'tester' },
  { method: 'PUT',    pathPrefix: '/api/chat',                 minRole: 'tester' },
  { method: 'DELETE', pathPrefix: '/api/chat',                 minRole: 'tester' },
];

/**
 * Get the minimum role required for a given request method+path.
 * Returns 'viewer' if no specific rule matches (default: read access).
 */
export function getRequiredRole(method: string, path: string): Role {
  const upperMethod = method.toUpperCase();

  // Find the most specific matching rule (longest prefix match)
  let bestMatch: RoutePermission | null = null;
  let bestLen = 0;

  for (const rule of ROUTE_PERMISSIONS) {
    if (rule.method !== '*' && rule.method !== upperMethod) continue;
    if (!path.startsWith(rule.pathPrefix)) continue;
    if (rule.pathPrefix.length > bestLen) {
      bestLen = rule.pathPrefix.length;
      bestMatch = rule;
    }
  }

  return bestMatch ? bestMatch.minRole : 'viewer';
}
