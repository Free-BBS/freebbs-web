import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import type { AuthClient } from './core/auth/auth-client.js';
import type { UserDirectory } from './core/auth/user-directory.js';
import { createMySqlStore } from './core/database/mysql-store.js';
import { runMigrations } from './core/database/migrate.js';

export interface IntegratedDatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  socketPath?: string;
}

export interface IntegratedRuntimeOptions {
  authClient: AuthClient;
  userDirectory: UserDirectory;
  database: IntegratedDatabaseConfig;
  uploadDirectory: string;
}

export interface IntegratedRuntime {
  app: ReturnType<typeof createApp>;
  close(): Promise<void>;
}

export async function createIntegratedDevelopmentRuntime(
  options: IntegratedRuntimeOptions,
): Promise<IntegratedRuntime> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'production',
    AUTH_MODE: 'main',
    DATA_MODE: 'mysql',
    MYSQL_HOST: options.database.host,
    MYSQL_PORT: String(options.database.port),
    MYSQL_USER: options.database.user,
    MYSQL_PASSWORD: options.database.password,
    MYSQL_DATABASE: options.database.database,
    ...(options.database.socketPath ? { MYSQL_SOCKET: options.database.socketPath } : {}),
  };
  const migrationDirectory = fileURLToPath(
    new URL('../../../database/migrations/', import.meta.url),
  );
  await runMigrations({ environment, directory: migrationDirectory });
  const handle = createMySqlStore({ environment });
  const app = createApp({
    store: handle.store,
    databaseMode: 'mysql',
    getAppliedMigrationCount: handle.getAppliedMigrationCount,
    checkReadiness: handle.checkReadiness,
    authMode: 'main',
    authClient: options.authClient,
    userDirectory: options.userDirectory,
    festivalUploadDirectory: options.uploadDirectory,
  });
  return { app, close: handle.close };
}
