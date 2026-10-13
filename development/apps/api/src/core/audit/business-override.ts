import { isDevelopmentBusinessAdmin } from '@freebbs-development/contracts';
import type { RequestHandler } from 'express';
import type { AuthenticationResult, AuthHeaders } from '../auth/auth-middleware.js';
import type { DevelopmentStore } from '../database/types.js';
import { HttpError } from '../errors/http-error.js';

/** Persist intent before an admin override, including filesystem-backed modules.
 * Existing domain transaction audits remain the authoritative field changes.
 * Never put auth, private content, file bytes or transport URLs in this log. */
export function auditBusinessOverrides(
  store: DevelopmentStore,
  authenticate: (headers: AuthHeaders) => Promise<AuthenticationResult>,
): RequestHandler {
  return async (request, response, next) => {
    if (
      ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ||
      /^\/(?:admin|system-settings|notifications)(?:\/|$)/.test(request.path)
    ) {
      next();
      return;
    }
    const result = await authenticate(request.headers);
    if (
      result.status !== 200 ||
      result.user.previewing ||
      !isDevelopmentBusinessAdmin(result.user)
    ) {
      next();
      return;
    }
    const previous = {
      method: request.method,
      path: request.path,
      changedFields:
        request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)
          ? Object.keys(request.body as Record<string, unknown>)
              .filter(
                (key) =>
                  /^[a-zA-Z][a-zA-Z0-9]{0,59}$/.test(key) &&
                  !/token|secret|password|credential|webhook|url|body|html|content|file|bytes|answers|values/i.test(
                    key,
                  ),
              )
              .sort()
          : [],
    };
    let intent;
    try {
      intent = await store.auditLogs.create({
        actorUid: result.user.uid,
        action: 'business.admin_override',
        resourceType: 'business_operation',
        resourceId: request.path.split('/').filter(Boolean).slice(0, 3).join('/').slice(0, 128),
        details: { previous, next: { outcome: 'pending' } },
        status: 'pending',
        ownerUid: result.user.uid,
        scope: { type: 'public', id: '*' },
      });
    } catch {
      next(new HttpError(503, 'audit_unavailable', '操作审计暂不可用，请稍后重试'));
      return;
    }
    const originalJson = response.json.bind(response);
    let finalizing = false;
    response.once('finish', () => {
      if (finalizing) return;
      finalizing = true;
      const status = response.statusCode;
      // DELETE/204 and non-JSON responses also complete their durable intent.
      // If this post-response write fails, the existing pending record remains.
      void Promise.resolve()
        .then(() =>
          store.auditLogs.update(intent.id, {
            status: status >= 200 && status < 300 ? 'active' : 'failed',
            details: {
              previous,
              next: {
                status,
                resultId: null,
                outcome: status >= 200 && status < 300 ? 'completed' : 'failed',
              },
            },
          }),
        )
        .catch(() => undefined);
    });
    response.json = (body: unknown) => {
      finalizing = true;
      const status = response.statusCode;
      const data =
        body && typeof body === 'object' && 'data' in body
          ? (body as { data: unknown }).data
          : undefined;
      const candidate =
        data && typeof data === 'object' && 'id' in data ? (data as { id: unknown }).id : undefined;
      const resultId =
        typeof candidate === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(candidate)
          ? candidate
          : null;
      void store.auditLogs
        .update(intent.id, {
          status: status >= 200 && status < 300 ? 'active' : 'failed',
          details: {
            previous,
            next: {
              status,
              resultId,
              outcome: status >= 200 && status < 300 ? 'completed' : 'failed',
            },
          },
        })
        .then(
          (updated) => {
            if (!updated) response.setHeader('X-Development-Audit-Pending', intent.id);
            originalJson(body);
          },
          () => {
            // A committed mutation must keep its successful response. The durable
            // pending intent identifies an outcome that needs reconciliation.
            response.setHeader('X-Development-Audit-Pending', intent.id);
            originalJson(body);
          },
        );
      return response;
    };
    next();
  };
}
