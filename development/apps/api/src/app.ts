import { randomUUID } from 'node:crypto';

import express from 'express';

import type { ApiEnvelope, DevelopmentRewardProvider } from '@freebbs-development/contracts';
import {
  ACTIVITY_CONTENT_BODY_MAX_BYTES,
  DEMO_USERS,
  platformRootAdminUids,
} from '@freebbs-development/contracts';
import { loadEnvironment, type AuthMode } from './config/env.js';
import type { AuthClient } from './core/auth/auth-client.js';
import { createAuthMiddleware } from './core/auth/auth-middleware.js';
import { auditBusinessOverrides } from './core/audit/business-override.js';
import { DemoAuthClient } from './core/auth/demo-auth-client.js';
import { MainSiteAuthClient } from './core/auth/main-site-auth-client.js';
import type { UserDirectory } from './core/auth/user-directory.js';
import { createMemoryStore } from './core/database/memory-store.js';
import { RecordConflictError } from './core/database/record-conflict-error.js';
import type { DataMode } from './core/database/create-store.js';
import type { DevelopmentStore } from './core/database/types.js';
import { HttpError } from './core/errors/http-error.js';
import { listModuleManifests } from './core/modules/registry.js';
import { createAdminRouter } from './modules/admin/router.js';
import { createClubsRouter } from './modules/clubs/router.js';
import { createCollectionsRouter } from './modules/collections/router.js';
import { createDepartmentRouter } from './modules/collections/department-router.js';
import { createCommunityRouter } from './modules/community/router.js';
import { createEventsRouter } from './modules/events/router.js';
import { createActivityWorkspaceRouter } from './modules/events/workspace-router.js';
import {
  createLearningSurveyResolver,
  type LearningSurveyResolver,
} from './modules/events/workspace-activity.js';
import { createFinanceRouter } from './modules/finance/router.js';
import { createFinanceTrackingRouter } from './modules/finance/tracking-router.js';
import { financeDataDirectory } from './modules/finance/data-directory.js';
import { DEFAULT_FINANCE_DEPARTMENTS } from './modules/finance/default-departments.js';
import { createFestivalRouter } from './modules/festival/router.js';
import { createGrowthRouter } from './modules/growth/router.js';
import {
  createAtlasService,
  type LearningAchievementProvider,
} from './modules/growth/atlas-service.js';
import { createAtlasRouter } from './modules/growth/atlas-router.js';
import { createMapBridgeRouters } from './modules/map-bridge/router.js';
import { createInformationRouter } from './modules/information/router.js';
import { createKnowledgeRouter } from './modules/knowledge/router.js';
import { createLiaisonRouter } from './modules/liaison/router.js';
import { createSportsRouter } from './modules/sports/router.js';
import { createCollaborationRouter } from './modules/collaboration/router.js';
import { createOrganizationGroupRouter } from './modules/organization-group/router.js';
import { createMaterialsRouter } from './modules/collaboration/materials.js';
import { createConnectorsRouter } from './modules/connectors/router.js';
import { createPublishingRouter } from './modules/publishing/router.js';
import { createSystemSettingsRouters } from './modules/system-settings/router.js';

import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

const API_BASE_PATH = '/api/development/v1';
const API_VERSION = '0.1.0';

interface ApiErrorData {
  error: { code: string; message: string };
}

function bodyParserHttpError(error: unknown): HttpError | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { type?: unknown; status?: unknown };
  if (candidate.type === 'entity.parse.failed' && candidate.status === 400) {
    return new HttpError(400, 'invalid_json', 'Request body contains invalid JSON');
  }
  if (candidate.type === 'entity.too.large' && candidate.status === 413) {
    return new HttpError(413, 'payload_too_large', 'Request body is too large');
  }
  return undefined;
}

export type ReadinessCheck = () => Promise<void>;
export type AppliedMigrationCountProvider = () => Promise<number>;

export interface CreateAppOptions {
  environment?: NodeJS.ProcessEnv;
  store?: DevelopmentStore;
  databaseMode?: DataMode;
  appliedMigrationCount?: number;
  getAppliedMigrationCount?: AppliedMigrationCountProvider;
  checkReadiness?: ReadinessCheck;
  authMode?: AuthMode;
  authClient?: AuthClient;
  previewAllowedUids?: readonly string[];
  userDirectory?: UserDirectory;
  allowedOrigins?: readonly string[];
  version?: string;
  festivalUploadDirectory?: string;
  festivalMaxUploadBytes?: number;
  sportsUploadDirectory?: string;
  collectionsUploadDirectory?: string;
  learningSurveyResolver?: LearningSurveyResolver;
  developmentRewardProvider?: DevelopmentRewardProvider;
  systemSettingsDirectory?: string;
  financeDirectory?: string;
  publicUploadDirectory?: string;
  learningAchievementProvider?: LearningAchievementProvider;
  developmentMapTokenDigest?: string;
}

function requestId(response: Response): string {
  return response.locals.requestId as string;
}

function sendEnvelope<T>(response: Response, status: number, data: T): void {
  const envelope: ApiEnvelope<T> = { data, requestId: requestId(response) };
  response.status(status).json(envelope);
}

function parseAllowedOrigins(value: string | undefined): string[] {
  if (value === undefined) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ];
}

function resolveAuthClient(mode: AuthMode, options: CreateAppOptions): AuthClient {
  if (options.authClient !== undefined) return options.authClient;
  const environment = loadEnvironment();
  return mode === 'demo'
    ? new DemoAuthClient(environment.demoUserIds)
    : new MainSiteAuthClient({
        apiBaseUrl: environment.mainSiteApiBaseUrl,
        timeoutMs: environment.authTimeoutMs,
      });
}

/** Reuse deterministic demo accounts only; production must supply its verified user directory. */
function organizationGroupDemoDirectory(): UserDirectory {
  const users = DEMO_USERS.map((user) => ({
    uid: user.uid,
    username: user.uid,
    displayName: user.displayName,
    studentId: null,
    avatarUrl: null,
  }));
  return {
    list: async (query) =>
      users.filter((user) => !query || `${user.uid} ${user.displayName}`.includes(query)),
    get: async (uid) => users.find((user) => user.uid === uid) ?? null,
  };
}

export function createApp(options: CreateAppOptions = {}) {
  const environmentSource = options.developmentMapTokenDigest
    ? {
        ...(options.environment ?? process.env),
        DEVELOPMENT_MAP_TOKEN_SHA256: options.developmentMapTokenDigest,
      }
    : (options.environment ?? process.env);
  const environment = loadEnvironment(environmentSource);
  const store = options.store ?? createMemoryStore();
  const databaseMode = options.databaseMode ?? 'memory';
  const getAppliedMigrationCount =
    options.getAppliedMigrationCount ?? (async () => options.appliedMigrationCount ?? 0);
  const checkReadiness =
    options.checkReadiness ??
    (databaseMode === 'mysql'
      ? async () => {
          throw new Error('MySQL readiness check is required');
        }
      : async () => undefined);
  const authMode = options.authMode ?? environment.authMode;
  if (environment.nodeEnv === 'production' && authMode === 'demo') {
    throw new Error('Demo authentication is disabled in production');
  }
  const previewAllowedUids = [...(options.previewAllowedUids ?? environment.previewAllowedUids)];
  const allowedDevelopmentUids = authMode === 'main' ? previewAllowedUids : environment.demoUserIds;
  const authenticate = createAuthMiddleware({
    authClient: resolveAuthClient(authMode, options),
    mode: authMode,
    store,
    userDirectory: options.userDirectory,
    rootAdminUids: platformRootAdminUids(environmentSource.PLATFORM_ROOT_ADMIN_UIDS),
  });
  const allowedOrigins = new Set(
    options.allowedOrigins ?? parseAllowedOrigins(environmentSource.ALLOWED_ORIGINS),
  );
  const app = express();

  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    const id = randomUUID();
    response.locals.requestId = id;
    response.setHeader('X-Request-Id', id);
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use((request, response, next) => {
    const origin = request.headers.origin;
    if (origin !== undefined && allowedOrigins.has(origin)) {
      response.vary('Origin');
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      response.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization,Content-Type,X-Demo-User,X-Development-Preview-Uid,X-Request-Id,Idempotency-Key',
      );
      if (request.method === 'OPTIONS') {
        response.status(204).end();
        return;
      }
    }
    next();
  });
  const activityContentParser = express.json({
    limit: ACTIVITY_CONTENT_BODY_MAX_BYTES,
    type: 'application/json',
  });
  app.use(`${API_BASE_PATH}/events/workspaces`, (request, response, next) => {
    const contentRoute =
      /^\/(learning_survey|development_activity|native_collection)\/[a-zA-Z0-9_-]{1,128}\/(intro|recaps(?:\/[a-zA-Z0-9_-]{1,128})?)\/?$/.test(
        request.path,
      );
    if (contentRoute && ['PUT', 'POST'].includes(request.method)) {
      activityContentParser(request, response, next);
    } else next();
  });
  // Bulk rosters and configurable questionnaire answers exceed the small
  // default JSON limit. Keep this bounded expansion within the ledger API.
  app.use(
    `${API_BASE_PATH}/organization-group`,
    express.json({ limit: '8mb', type: 'application/json' }),
  );
  app.use(
    `${API_BASE_PATH}/connectors/map/sync`,
    express.json({ limit: '256kb', type: 'application/json' }),
  );
  app.use(express.json({ limit: '64kb', type: 'application/json' }));

  app.get(`${API_BASE_PATH}/health`, (_request, response) => {
    sendEnvelope(response, 200, {
      status: 'ok',
      version: options.version ?? API_VERSION,
      databaseMode,
    });
  });
  app.get(`${API_BASE_PATH}/ready`, async (_request, response) => {
    try {
      await checkReadiness();
      sendEnvelope(response, 200, { status: 'ok' });
    } catch {
      sendEnvelope<ApiErrorData>(response, 503, {
        error: { code: 'not_ready', message: 'Service is not ready' },
      });
    }
  });
  app.get(`${API_BASE_PATH}/modules`, async (request, response, next) => {
    try {
      if (authMode === 'main') {
        const result = await authenticate(request.headers);
        if (result.status !== 200) {
          sendEnvelope<ApiErrorData>(response, result.status, {
            error: { code: result.code, message: result.message },
          });
          return;
        }
      }
      sendEnvelope(response, 200, await listModuleManifests(store));
    } catch (error) {
      next(error);
    }
  });
  app.get(`${API_BASE_PATH}/me`, async (request, response, next) => {
    try {
      const result = await authenticate(request.headers);
      if (result.status !== 200) {
        sendEnvelope<ApiErrorData>(response, result.status, {
          error: { code: result.code, message: result.message },
        });
        return;
      }
      sendEnvelope(response, 200, result.user);
    } catch (error) {
      next(error);
    }
  });

  // Identity preview is read-only across every mounted business router.
  app.use(API_BASE_PATH, (request, response, next) => {
    if (
      request.headers['x-development-preview-uid'] &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    ) {
      sendEnvelope<ApiErrorData>(response, 403, {
        error: { code: 'preview_read_only', message: '身份预览仅支持读取' },
      });
      return;
    }
    next();
  });
  const systemSettingsRouters = createSystemSettingsRouters({
    store,
    authenticate,
    userDirectory: options.userDirectory,
    allowedUids: allowedDevelopmentUids,
    directory:
      options.systemSettingsDirectory ??
      options.collectionsUploadDirectory ??
      environmentSource.COLLECTIONS_UPLOAD_DIR,
    nodeEnvironment: environment.nodeEnv,
    authMode,
    rewardProvider: options.developmentRewardProvider,
  });
  app.use(`${API_BASE_PATH}/system-settings`, systemSettingsRouters.settings);
  app.use(`${API_BASE_PATH}/notifications`, systemSettingsRouters.inbox);
  app.use(API_BASE_PATH, auditBusinessOverrides(store, authenticate));

  app.use(
    `${API_BASE_PATH}/admin`,
    createAdminRouter({
      store,
      authenticate,
      version: options.version ?? API_VERSION,
      dataMode: databaseMode,
      getAppliedMigrationCount,
      userDirectory: options.userDirectory,
      allowedUids: allowedDevelopmentUids,
    }),
  );
  const interestGroupsRouter = createClubsRouter({ store, authenticate });
  app.use(`${API_BASE_PATH}/interest-groups`, interestGroupsRouter);
  app.use(`${API_BASE_PATH}/clubs`, interestGroupsRouter);
  app.use(
    `${API_BASE_PATH}/events/festival`,
    createFestivalRouter({
      store,
      authenticate,
      ...(options.festivalUploadDirectory
        ? { uploadDirectory: options.festivalUploadDirectory }
        : {}),
      ...(options.festivalMaxUploadBytes ? { maxUploadBytes: options.festivalMaxUploadBytes } : {}),
    }),
  );
  app.use(
    `${API_BASE_PATH}/events`,
    createActivityWorkspaceRouter({
      store,
      authenticate,
      learning:
        options.learningSurveyResolver ??
        createLearningSurveyResolver(environment.mainSiteApiBaseUrl, environment.authTimeoutMs),
      nodeEnvironment: environment.nodeEnv,
      ...((options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR)
        ? {
            uploadDirectory:
              options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
          }
        : {}),
    }),
  );
  app.use(
    `${API_BASE_PATH}/events`,
    createEventsRouter({
      store,
      authenticate,
      uploadDirectory:
        options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
    }),
  );
  app.use(
    `${API_BASE_PATH}/collections`,
    createCollectionsRouter({
      store,
      authenticate,
      nodeEnvironment: environment.nodeEnv,
      ...((options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR)
        ? {
            uploadDirectory:
              options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
          }
        : {}),
    }),
  );
  app.use(
    `${API_BASE_PATH}/organizations`,
    createDepartmentRouter({
      store,
      authenticate,
      nodeEnvironment: environment.nodeEnv,
      ...((options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR)
        ? {
            uploadDirectory:
              options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
          }
        : {}),
    }),
  );
  app.use(`${API_BASE_PATH}/community`, createCommunityRouter({ store, authenticate }));
  app.use(
    `${API_BASE_PATH}/organization-group`,
    createOrganizationGroupRouter({
      store,
      userDirectory:
        options.userDirectory ??
        (authMode === 'demo' ? organizationGroupDemoDirectory() : undefined),
      authenticate,
      nodeEnvironment: environment.nodeEnv,
      uploadDirectory:
        options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
    }),
  );
  app.use(
    `${API_BASE_PATH}/collaboration`,
    createCollaborationRouter({
      store,
      authenticate,
      nodeEnvironment: environment.nodeEnv,
      uploadDirectory:
        options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
    }),
  );
  app.use(
    `${API_BASE_PATH}/collaboration`,
    createMaterialsRouter({
      store,
      authenticate,
      nodeEnvironment: environment.nodeEnv,
      uploadDirectory:
        options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
    }),
  );
  const atlasService = createAtlasService({
    store,
    environment: environmentSource,
    nodeEnvironment: environment.nodeEnv,
    uploadDirectory: options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
    learningAchievementProvider: options.learningAchievementProvider,
  });
  const mapBridge = createMapBridgeRouters({
    store,
    authenticate,
    environment: environmentSource,
    nodeEnvironment: environment.nodeEnv,
    uploadDirectory: options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
    getAtlas: atlasService.getMiniappAtlas,
    saveShowcase: atlasService.saveMiniappShowcase,
  });
  app.use(`${API_BASE_PATH}/connectors/map`, mapBridge.serviceRouter);
  app.use(`${API_BASE_PATH}/growth/map`, mapBridge.userRouter);
  app.use(`${API_BASE_PATH}/growth`, createAtlasRouter({ authenticate, service: atlasService }));
  app.use(
    `${API_BASE_PATH}/connectors`,
    createConnectorsRouter({
      authenticate,
      environment: environmentSource,
      nodeEnvironment: environment.nodeEnv,
      uploadDirectory:
        options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
    }),
  );
  app.use(
    `${API_BASE_PATH}/publishing`,
    createPublishingRouter({
      store,
      authenticate,
      nodeEnvironment: environment.nodeEnv,
      uploadDirectory:
        options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
    }),
  );
  app.use(
    `${API_BASE_PATH}/growth`,
    createGrowthRouter({
      store,
      authenticate,
      uploadDirectory:
        options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
    }),
  );
  app.use(
    `${API_BASE_PATH}/finance/tracking`,
    async (_request, _response, next) => {
      const module = (await store.modules.list({ query: 'finance' })).find(
        (record) => record.moduleId === 'finance',
      );
      if (!module?.enabled || module.status !== 'enabled') {
        next(new HttpError(503, 'module_disabled', '财务模块暂未开放'));
        return;
      }
      next();
    },
    createFinanceTrackingRouter({
      authenticate: async (headers) => {
        const result = await authenticate(headers);
        if (result.status !== 200) return result;
        const subject = (await store.subjects.list({ query: result.user.uid })).find(
          ({ uid }) => uid === result.user.uid,
        );
        if (subject?.status !== 'active') {
          throw new HttpError(403, 'finance_subject_inactive', '该账号的财务访问已停用');
        }
        return result;
      },
      authMode,
      nodeEnvironment: environment.nodeEnv,
      directory: financeDataDirectory({
        directory: options.financeDirectory ?? environmentSource.FINANCE_DATA_DIR,
        nodeEnvironment: environment.nodeEnv,
        publicDirectories: [
          options.publicUploadDirectory,
          options.festivalUploadDirectory ?? environmentSource.FESTIVAL_UPLOAD_DIR,
          options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
          options.sportsUploadDirectory,
        ].filter((path): path is string => Boolean(path)),
      }),
      defaultDepartments: DEFAULT_FINANCE_DEPARTMENTS,
      getSharedTeams: () => store.sportsTeams.list(),
    }),
  );
  app.use(`${API_BASE_PATH}/finance`, createFinanceRouter({ store, authenticate }));
  app.use(`${API_BASE_PATH}/knowledge`, createKnowledgeRouter({ store, authenticate }));
  app.use(`${API_BASE_PATH}/information`, createInformationRouter({ store, authenticate }));
  app.use(`${API_BASE_PATH}/liaison`, createLiaisonRouter({ store, authenticate }));
  app.use(
    `${API_BASE_PATH}/sports`,
    createSportsRouter({
      store,
      authenticate,
      nodeEnvironment: environment.nodeEnv,
      homepageDirectory:
        options.collectionsUploadDirectory ?? environmentSource.COLLECTIONS_UPLOAD_DIR,
      ...(options.sportsUploadDirectory ? { uploadDirectory: options.sportsUploadDirectory } : {}),
    }),
  );

  app.use((_request, _response, next) => {
    next(new HttpError(404, 'not_found', 'Route not found'));
  });
  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    void _next;
    const httpError =
      error instanceof HttpError
        ? error
        : error instanceof RecordConflictError
          ? new HttpError(409, 'conflict', error.message)
          : bodyParserHttpError(error);
    sendEnvelope<ApiErrorData>(response, httpError?.status ?? 500, {
      error: {
        code: httpError?.code ?? 'internal_error',
        message: httpError?.message ?? 'An unexpected error occurred',
      },
    });
  };
  app.use(errorHandler);

  return app;
}

export type ApiRequest = Request;
export type ApiResponse = Response;
export type ApiNextFunction = NextFunction;
export { API_BASE_PATH };
