import type { ReactNode } from 'react';

import {
  isDevelopmentBusinessAdmin,
  canManageDevelopmentAccess,
  type RoleKey,
  type UserContext,
} from '@freebbs-development/contracts';
import { useOptionalAuth } from '../auth/AuthProvider.js';

export interface PresentationPolicy {
  action: string;
  effect?: 'allow' | 'deny';
}

export type PresentationUser = UserContext & {
  policies?: readonly PresentationPolicy[];
};

export interface CanProps {
  children: ReactNode;
  fallback?: ReactNode;
  user?: PresentationUser | null;
  role?: RoleKey;
  tag?: string;
  permission?: string;
  predicate?: (user: PresentationUser) => boolean;
}

function matches(pattern: string, permission: string): boolean {
  if (pattern === '*' || pattern === permission) return true;
  return pattern.endsWith('.*') && permission.startsWith(pattern.slice(0, -1));
}

export function isSuperAdmin(
  user: Pick<PresentationUser, 'roles' | 'viewer' | 'developmentAccess' | 'previewing'>,
): boolean {
  return canManageDevelopmentAccess(user);
}

export function isBusinessAdmin(user: Pick<PresentationUser, 'roles'>): boolean {
  return isDevelopmentBusinessAdmin(user.roles);
}

export function hasPresentationPermission(user: PresentationUser, permission: string): boolean {
  if (permission.startsWith('admin.')) return isSuperAdmin(user) && !user.previewing;
  if (isBusinessAdmin(user)) return true;
  const matching = (user.policies ?? []).filter(
    (policy) => policy.action !== '*' && matches(policy.action, permission),
  );
  if (matching.some((policy) => policy.effect === 'deny')) return false;
  return matching.some((policy) => policy.effect === undefined || policy.effect === 'allow');
}

/**
 * Presentation-only visibility helper. API endpoints remain the authorization authority.
 */
export function Can({
  children,
  fallback = null,
  user: suppliedUser,
  role,
  tag,
  permission,
  predicate,
}: CanProps) {
  const auth = useOptionalAuth();
  const user = suppliedUser === undefined ? (auth?.user ?? null) : suppliedUser;
  if (user === null) return <>{fallback}</>;

  const businessAdmin = isBusinessAdmin(user);
  const allowed =
    (role === undefined ||
      (role === 'platform.super_admin'
        ? isSuperAdmin(user)
        : user.roles.includes(role) || (businessAdmin && !role.startsWith('platform.')))) &&
    (tag === undefined ||
      businessAdmin ||
      user.tags.some((assignment) => assignment.key === tag)) &&
    (permission === undefined || hasPresentationPermission(user, permission)) &&
    (predicate === undefined || predicate(user));

  return <>{allowed ? children : fallback}</>;
}
