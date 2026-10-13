import { Router } from 'express';
import {
  canManageDevelopmentAccess,
  isDevelopmentBusinessAdmin,
} from '@freebbs-development/contracts';

import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import type { DataMode } from '../../core/database/create-store.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { createAssignmentsRouter } from './assignments-router.js';
import { createAuditRouter } from './audit-router.js';
import { createDevelopmentUsersRouter } from './development-users-router.js';
import type { UserDirectory } from '../../core/auth/user-directory.js';
import { createModulesRouter } from './modules-router.js';
import { createOrganizationMembershipsRouter } from './organization-memberships-router.js';
import { createPermissionsRouter } from './permissions-router.js';
import { createSubjectsRouter } from './subjects-router.js';
import { createSystemRouter } from './system-router.js';
import { createTagsRouter } from './tags-router.js';
import { createBusinessAdminBootstrapRouter } from './business-admin-bootstrap-router.js';

type Authenticate = (headers: AuthHeaders) => Promise<AuthenticationResult>;

export interface AdminRouterOptions {
  store: DevelopmentStore;
  authenticate: Authenticate;
  version: string;
  dataMode: DataMode;
  getAppliedMigrationCount(): Promise<number>;
  userDirectory?: UserDirectory;
  allowedUids?: readonly string[];
}

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router();

  router.use(async (request, response, next) => {
    try {
      const result = await options.authenticate(request.headers);
      if (result.status !== 200) {
        response.status(result.status).json({
          data: { error: { code: result.code, message: result.message } },
          requestId: response.locals.requestId as string,
        });
        return;
      }
      if (!canManageDevelopmentAccess(result.user)) {
        response.status(403).json({
          data: {
            error: { code: 'forbidden', message: 'Original development lead access is required' },
          },
          requestId: response.locals.requestId as string,
        });
        return;
      }
      response.locals.user = result.user;
      const accessRoute = /^\/development-users(?:\/[^/]+)?\/?$/.test(request.path);
      const accessAudit = request.path === '/audit-logs' && request.method === 'GET';
      const statusRoute = request.path === '/system-status' && request.method === 'GET';
      const bootstrapRoute =
        /^\/business-admin-bootstrap\/?$/.test(request.path) &&
        ['GET', 'POST'].includes(request.method);
      if (
        !accessRoute &&
        !accessAudit &&
        !statusRoute &&
        !bootstrapRoute &&
        !isDevelopmentBusinessAdmin(result.user)
      ) {
        response.status(403).json({
          data: {
            error: {
              code: 'forbidden',
              message: 'Platform administrator role is required for business identity management',
            },
          },
          requestId: response.locals.requestId,
        });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  router.use('/subjects', createSubjectsRouter(options.store));
  if (options.userDirectory) {
    router.use(
      '/business-admin-bootstrap',
      createBusinessAdminBootstrapRouter(options.store, options.userDirectory, options.allowedUids),
    );
    router.use(
      '/development-users',
      createDevelopmentUsersRouter(options.store, options.userDirectory, options.allowedUids),
    );
  }
  router.use('/organization-memberships', createOrganizationMembershipsRouter(options.store));
  router.use(createAssignmentsRouter(options.store, options.userDirectory, options.allowedUids));
  router.use(createPermissionsRouter(options.store, options.userDirectory, options.allowedUids));
  router.use(createTagsRouter(options.store));
  router.use(createModulesRouter(options.store));
  router.use(createAuditRouter(options.store));
  router.use(
    createSystemRouter({
      store: options.store,
      version: options.version,
      dataMode: options.dataMode,
      getAppliedMigrationCount: options.getAppliedMigrationCount,
    }),
  );

  return router;
}
