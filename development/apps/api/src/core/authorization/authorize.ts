import { ALL_PERMISSION_RULES } from './permission-catalog.js';

import type { ScopeRef } from '@freebbs-development/contracts';
import type {
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationPolicy,
  AuthorizationRequest,
  PermissionRule,
} from './policy.js';

function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === '*' || pattern === value) return true;
  return pattern.endsWith('.*') && value.startsWith(pattern.slice(0, -1));
}

function matchesRule(rule: PermissionRule, request: AuthorizationRequest): boolean {
  return (
    matchesPattern(rule.action, request.action) && matchesPattern(rule.resource, request.resource)
  );
}

function isKnownRequest(request: AuthorizationRequest): boolean {
  return ALL_PERMISSION_RULES.some(
    (rule) => (rule.action !== '*' || rule.resource !== '*') && matchesRule(rule, request),
  );
}

const scopeTypePattern = /^[a-z][a-z0-9_]*$/;
const maximumScopePartLength = 128;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function validScopePart(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= maximumScopePartLength &&
    value.trim() === value &&
    !containsControlCharacter(value)
  );
}

function validScope(scope: ScopeRef | undefined): boolean {
  if (scope === undefined) return true;
  return (
    validScopePart(scope.type) &&
    scopeTypePattern.test(scope.type) &&
    validScopePart(scope.id) &&
    (scope.id !== '*' || scope.type === 'public')
  );
}

function matchesScope(grant: ScopeRef | undefined, requested: ScopeRef | undefined): boolean {
  if (grant === undefined) return true;
  return requested !== undefined && grant.type === requested.type && grant.id === requested.id;
}

function isExpired(expiresAt: string | null | undefined, now: Date): boolean {
  if (expiresAt === undefined || expiresAt === null) return false;
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= now.getTime();
}

function source(policy: AuthorizationPolicy): string {
  return `policy:${policy.id}`;
}

function specificity(policy: AuthorizationPolicy): number {
  return policy.scope === undefined ? 0 : 1;
}

function mostSpecific(policies: readonly AuthorizationPolicy[]): AuthorizationPolicy | undefined {
  return [...policies].sort(
    (left, right) => specificity(right) - specificity(left) || left.id.localeCompare(right.id),
  )[0];
}

export function authorize(
  context: AuthorizationContext,
  request: AuthorizationRequest,
  now = new Date(),
): AuthorizationDecision {
  if (!validScope(request.scope)) {
    return { allowed: false, reason: 'invalid-scope', matchedBy: null };
  }

  if (!isKnownRequest(request)) {
    return { allowed: false, reason: 'unknown-permission', matchedBy: null };
  }

  const matching = (context.policies ?? []).filter(
    (policy) =>
      (policy.effect === 'allow' || policy.effect === 'deny') &&
      validScope(policy.scope) &&
      matchesRule(policy, request),
  );
  const compatible = matching.filter((policy) => matchesScope(policy.scope, request.scope));
  const current = compatible.filter((policy) => !isExpired(policy.expiresAt, now));

  const explicitDeny = mostSpecific(current.filter(({ effect }) => effect === 'deny'));
  if (explicitDeny !== undefined) {
    return { allowed: false, reason: 'explicit-deny', matchedBy: source(explicitDeny) };
  }

  const grant = mostSpecific(current.filter(({ effect }) => effect === 'allow'));
  if (grant !== undefined) {
    return { allowed: true, reason: 'policy-grant', matchedBy: source(grant) };
  }

  const expired = mostSpecific(compatible.filter((policy) => isExpired(policy.expiresAt, now)));
  if (expired !== undefined) {
    return { allowed: false, reason: 'expired-assignment', matchedBy: source(expired) };
  }

  const mismatch = mostSpecific(matching.filter(({ effect }) => effect === 'allow'));
  if (mismatch !== undefined) {
    return { allowed: false, reason: 'scope-mismatch', matchedBy: source(mismatch) };
  }

  return { allowed: false, reason: 'no-matching-grant', matchedBy: null };
}
