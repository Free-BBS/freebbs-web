import { randomUUID } from 'node:crypto';

import express from 'express';

import type { ApiEnvelope } from '@freebbs-development/contracts';
import { loadEnvironment, type AuthMode } from './config/env.js';
import type { AuthClient } from './core/auth/auth-client.js';
import { createAuthMiddleware } from './core/auth/auth-middleware.js';
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
import { createEventsRouter } from './modules/events/router.js';
import { createFinanceRouter } from './modules/finance/router.js';
import { createFestivalRouter } from './modules/festival/router.js';
import { createGrowthRouter } from './modules/growth/router.js';
import { createInformationRouter } from './modules/information/router.js';
import { createKnowledgeRouter } from './modules/knowledge/router.js';
import { createLiaisonRouter } from './modules/liaison/router.js';
import { createSportsRouter } from './modules/sports/router.js';

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

export function createApp(options: CreateAppOptions = {}) {
  const environmentSource = options.environment ?? process.env;
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
  const authenticate = createAuthMiddleware({
    authClient: resolveAuthClient(authMode, options),
    mode: authMode,
    store,
    allowedUids: options.previewAllowedUids ?? environment.previewAllowedUids,
    userDirectory: options.userDirectory,
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
        'Authorization,Content-Type,X-Demo-User,X-Development-Preview-Uid,X-Request-Id',
      );
      if (request.method === 'OPTIONS') {
        response.status(204).end();
        return;
      }
    }
    next();
  });
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

  app.use(
    `${API_BASE_PATH}/admin`,
    createAdminRouter({
      store,
      authenticate,
      version: options.version ?? API_VERSION,
      dataMode: databaseMode,
      getAppliedMigrationCount,
      userDirectory: options.userDirectory,
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
  app.use(`${API_BASE_PATH}/events`, createEventsRouter({ store, authenticate }));
  app.use(
    `${API_BASE_PATH}/collections`,
    createCollectionsRouter({
      store,
      authenticate,
      ...(options.collectionsUploadDirectory
        ? { uploadDirectory: options.collectionsUploadDirectory }
        : {}),
    }),
  );
  app.use(`${API_BASE_PATH}/growth`, createGrowthRouter({ store, authenticate }));
  app.use(`${API_BASE_PATH}/finance`, createFinanceRouter({ store, authenticate }));
  app.use(`${API_BASE_PATH}/knowledge`, createKnowledgeRouter({ store, authenticate }));
  app.use(`${API_BASE_PATH}/information`, createInformationRouter({ store, authenticate }));
  app.use(`${API_BASE_PATH}/liaison`, createLiaisonRouter({ store, authenticate }));
  app.use(
    `${API_BASE_PATH}/sports`,
    createSportsRouter({
      store,
      authenticate,
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
