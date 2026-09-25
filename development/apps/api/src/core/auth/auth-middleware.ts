import { IdentityProviderUnavailableError } from './auth-client.js';

import type { UserContext } from '@freebbs-development/contracts';
import { loadAuthorizationContext } from '../authorization/load-authorization-context.js';
import { ROLE_PERMISSION_CATALOG } from '../authorization/permission-catalog.js';
import type { AuthorizationContext } from '../authorization/policy.js';
import { ensurePlatformDefinitions } from '../bootstrap/bootstrap-service.js';
import type { DevelopmentStore, SubjectRecord } from '../database/types.js';
import type { AuthClient } from './auth-client.js';
import {
  ensureDevelopmentLeadAssignment,
  hasConfiguredDevelopmentLead,
  resolveDevelopmentAccess,
} from './development-access.js';
import { directoryUserContext, type UserDirectory } from './user-directory.js';

export type AuthHeaders = Readonly<Record<string, string | string[] | undefined>>;

export type AuthenticationResult =
  | { status: 200; user: AuthorizationContext }
  | {
      status: 401 | 403 | 503;
      code:
        | 'missing_identity'
        | 'invalid_identity'
        | 'preview_access_denied'
        | 'preview_identity_denied'
        | 'identity_provider_unavailable'
        | 'development_backend_unavailable';
      message: string;
    };

export interface AuthMiddlewareOptions {
  authClient: AuthClient;
  mode: 'main' | 'demo';
  store?: DevelopmentStore;
  allowedUids?: readonly string[];
  userDirectory?: UserDirectory;
  now?: () => Date;
  reportError?: (message: string, error: unknown) => void;
}

function firstHeader(headers: AuthHeaders, name: string): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0];
  if (direct !== undefined) return direct;
  const found = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
  return Array.isArray(found) ? found[0] : found;
}

function readCredential(
  headers: AuthHeaders,
  mode: 'main' | 'demo',
): { ok: true; value: string } | { ok: false; missing: boolean } {
  if (mode === 'demo') {
    const value = firstHeader(headers, 'x-demo-user')?.trim();
    return value ? { ok: true, value } : { ok: false, missing: true };
  }

  const authorization = firstHeader(headers, 'authorization');
  if (authorization === undefined || authorization.trim() === '') {
    return { ok: false, missing: true };
  }
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  return match?.[1] ? { ok: true, value: match[1] } : { ok: false, missing: false };
}

export async function synchronizeSubject(
  store: DevelopmentStore,
  identity: UserContext,
  now: Date,
): Promise<SubjectRecord> {
  void now;
  const existing = (await store.subjects.list({ query: identity.uid })).find(
    ({ uid }) => uid === identity.uid,
  );
  if (existing === undefined) {
    return store.subjects.create({
      uid: identity.uid,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      status: 'active',
      ownerUid: identity.uid,
      scope: { type: 'public', id: '*' },
    });
  }
  const activatePending = existing.status === 'pending';
  if (
    existing.displayName === identity.displayName &&
    existing.avatarUrl === identity.avatarUrl &&
    !activatePending
  ) {
    return existing;
  }
  const updated = await store.subjects.update(existing.id, {
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    ...(activatePending ? { status: 'active' as const } : {}),
  });
  if (updated === null) throw new Error('Subject disappeared during synchronization');
  return updated;
}

function emptyAuthorizationContext(identity: UserContext): AuthorizationContext {
  return { ...identity, roles: [], tags: [], policies: [] };
}

function temporarySuperAdminContext(context: AuthorizationContext): AuthorizationContext {
  return {
    ...context,
    roles: [...new Set([...context.roles, 'platform.super_admin' as const])],
    policies: [
      ...(context.policies ?? []),
      ...ROLE_PERMISSION_CATALOG['platform.super_admin'].map((rule, index) => ({
        ...rule,
        id: `main-site-admin-bootstrap:${index}`,
        effect: 'allow' as const,
      })),
    ],
  };
}

export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const allowedUids = options.allowedUids && new Set(options.allowedUids);
  return async (headers: AuthHeaders): Promise<AuthenticationResult> => {
    const credential = readCredential(headers, options.mode);
    if (!credential.ok) {
      return credential.missing
        ? { status: 401, code: 'missing_identity', message: 'Authentication is required' }
        : { status: 401, code: 'invalid_identity', message: 'Authentication is invalid' };
    }

    try {
      const viewerIdentity = await options.authClient.introspect(credential.value);
      if (viewerIdentity === null) {
        return { status: 401, code: 'invalid_identity', message: 'Authentication is invalid' };
      }
      const now = (options.now ?? (() => new Date()))();
      let identity = viewerIdentity;
      let accessLevel: 'member' | 'lead' | null = null;
      let accessGrant: Awaited<ReturnType<typeof resolveDevelopmentAccess>> = null;
      let bootstrapAdministrator = false;
      let previewing = false;

      if (options.mode === 'main') {
        if (options.store) {
          accessGrant = await resolveDevelopmentAccess(options.store, viewerIdentity);
          accessLevel = accessGrant?.accessLevel ?? null;
          if (
            accessLevel === null &&
            viewerIdentity.mainSiteAdmin === true &&
            !(await hasConfiguredDevelopmentLead(options.store))
          ) {
            accessLevel = 'lead';
            bootstrapAdministrator = true;
          }
        }
        if (accessLevel === null && allowedUids?.has(viewerIdentity.uid)) accessLevel = 'member';
        if (accessLevel === null) {
          return {
            status: 403,
            code: 'preview_access_denied',
            message: 'Development preview is not available for this account',
          };
        }

        const previewUid = firstHeader(headers, 'x-development-preview-uid')?.trim();
        if (previewUid) {
          if (accessLevel !== 'lead' || options.userDirectory === undefined) {
            return {
              status: 403,
              code: 'preview_identity_denied',
              message: 'Development identity preview requires lead access',
            };
          }
          const target = await options.userDirectory.get(previewUid);
          if (!target) {
            return {
              status: 403,
              code: 'preview_identity_denied',
              message: 'Preview identity does not exist',
            };
          }
          identity = directoryUserContext(target);
          previewing = identity.uid !== viewerIdentity.uid;
        }
      }

      if (options.store === undefined) {
        return { status: 200, user: emptyAuthorizationContext(identity) };
      }
      if (options.mode === 'main') {
        await synchronizeSubject(options.store, viewerIdentity, now);
        if (accessLevel === 'lead') {
          await ensurePlatformDefinitions(options.store, viewerIdentity.uid);
          if (accessGrant) {
            await ensureDevelopmentLeadAssignment(options.store, viewerIdentity, accessGrant);
          }
        }
        await synchronizeSubject(options.store, identity, now);
      }
      const storedUser = await loadAuthorizationContext(options.store, identity, now);
      const user =
        bootstrapAdministrator && !previewing ? temporarySuperAdminContext(storedUser) : storedUser;
      return {
        status: 200,
        user:
          options.mode === 'main'
            ? {
                ...user,
                developmentAccess: accessLevel ?? 'member',
                previewing,
                viewer: {
                  uid: viewerIdentity.uid,
                  displayName: viewerIdentity.displayName,
                  canManageDevelopment: accessLevel === 'lead',
                },
              }
            : user,
      };
    } catch (error) {
      if (error instanceof IdentityProviderUnavailableError) {
        return {
          status: 503,
          code: 'identity_provider_unavailable',
          message: 'Identity provider is temporarily unavailable',
        };
      }
      (options.reportError ?? console.error)('[development] authentication failed', error);
      return {
        status: 503,
        code: 'development_backend_unavailable',
        message: 'Development service is temporarily unavailable',
      };
    }
  };
}
