import type { RoleKey, ScopeRef, UserContext } from '@freebbs-development/contracts';

export type PermissionEffect = 'allow' | 'deny';

export interface PermissionRule {
  action: string;
  resource: string;
  scope?: ScopeRef;
}

export interface AuthorizationPolicy extends PermissionRule {
  id: string;
  effect: PermissionEffect;
  expiresAt?: string | null;
}

export interface AuthorizationContext extends UserContext {
  policies?: AuthorizationPolicy[];
}

export interface AuthorizationRequest {
  action: string;
  resource: string;
  scope?: ScopeRef;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason:
    | 'explicit-deny'
    | 'expired-assignment'
    | 'policy-grant'
    | 'role-grant'
    | 'tag-grant'
    | 'base-role-grant'
    | 'scope-mismatch'
    | 'invalid-scope'
    | 'unknown-permission'
    | 'no-matching-grant';
  matchedBy: string | null;
}

export type RolePermissionCatalog = Readonly<Record<RoleKey, readonly PermissionRule[]>>;
