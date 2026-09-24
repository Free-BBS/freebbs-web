import { isIP } from 'node:net';
import { DEMO_USER_IDS as deterministicDemoUserIds } from '@freebbs-development/contracts';

export type AuthMode = 'main' | 'demo';
export type NodeEnvironment = 'development' | 'test' | 'production';

export interface Environment {
  nodeEnv: NodeEnvironment;
  authMode: AuthMode;
  host: string;
  port: number;
  mainSiteApiBaseUrl: string;
  authTimeoutMs: number;
  demoUserIds: string[];
  previewAllowedUids: string[];
}

function readNodeEnvironment(value: string | undefined): NodeEnvironment {
  if (value === undefined || value.trim() === '') return 'development';
  if (value === 'production' || value === 'test' || value === 'development') return value;
  throw new Error('NODE_ENV must be development, test or production');
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('AUTH_TIMEOUT_MS must be a positive integer');
  }
  return parsed;
}

function readHost(value: string | undefined): string {
  const host = value?.trim() || '127.0.0.1';
  if (isIP(host) === 0 || host === '0.0.0.0' || host === '::') {
    throw new Error('HOST must be a non-wildcard IP address');
  }
  return host;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 3100;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const nodeEnv = readNodeEnvironment(source.NODE_ENV);
  const authMode = source.AUTH_MODE ?? (nodeEnv === 'production' ? 'main' : 'demo');
  if (authMode !== 'main' && authMode !== 'demo') {
    throw new Error('AUTH_MODE must be main or demo');
  }
  if (nodeEnv === 'production' && authMode === 'demo') {
    throw new Error('Demo authentication is disabled in production');
  }

  const requestedDemoIds = (source.DEMO_USER_IDS ?? deterministicDemoUserIds.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const demoUserIds = [...new Set(requestedDemoIds)].filter((uid) =>
    deterministicDemoUserIds.includes(uid as (typeof deterministicDemoUserIds)[number]),
  );
  const previewAllowedUids = [
    ...new Set(
      (source.DEVELOPMENT_PREVIEW_UIDS ?? '')
        .split(',')
        .map((uid) => uid.trim())
        .filter(Boolean),
    ),
  ];

  return {
    nodeEnv,
    authMode,
    host: readHost(source.HOST),
    port: readPort(source.PORT),
    mainSiteApiBaseUrl: (source.MAIN_SITE_API_BASE_URL ?? 'http://localhost:3000').replace(
      /\/+$/,
      '',
    ),
    authTimeoutMs: readPositiveInteger(source.AUTH_TIMEOUT_MS, 3_000),
    demoUserIds,
    previewAllowedUids,
  };
}
