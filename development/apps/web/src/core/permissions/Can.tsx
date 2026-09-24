import type { ReactNode } from 'react';

import type { RoleKey, UserContext } from '@freebbs-development/contracts';
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

export function isSuperAdmin(user: Pick<PresentationUser, 'roles'>): boolean {
  return user.roles.includes('platform.super_admin');
}

export function hasPresentationPermission(user: PresentationUser, permission: string): boolean {
  if (isSuperAdmin(user)) return true;
  const matching = (user.policies ?? []).filter((policy) => matches(policy.action, permission));
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

  const superAdmin = isSuperAdmin(user);
  const allowed =
    (role === undefined || superAdmin || user.roles.includes(role)) &&
    (tag === undefined || superAdmin || user.tags.some((assignment) => assignment.key === tag)) &&
    (permission === undefined || hasPresentationPermission(user, permission)) &&
    (predicate === undefined || predicate(user));

  return <>{allowed ? children : fallback}</>;
}
