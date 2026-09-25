import { createApp } from './app.js';
import type { AuthClient } from './core/auth/auth-client.js';
import type { UserDirectory } from './core/auth/user-directory.js';
import { createMySqlStore } from './core/database/mysql-store.js';

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
  sportsUploadDirectory?: string;
}

export interface IntegratedRuntime {
  app: ReturnType<typeof createApp>;
  close(): Promise<void>;
}

export async function createIntegratedDevelopmentRuntime(
  options: IntegratedRuntimeOptions,
): Promise<IntegratedRuntime> {
  const handle = createMySqlStore({ config: options.database });
  try {
    await handle.checkReadiness();
  } catch (error) {
    await handle.close();
    throw error;
  }
  const app = createApp({
    environment: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? 'production',
      AUTH_MODE: 'main',
      HOST: '127.0.0.1',
    },
    store: handle.store,
    databaseMode: 'mysql',
    getAppliedMigrationCount: handle.getAppliedMigrationCount,
    checkReadiness: handle.checkReadiness,
    authMode: 'main',
    authClient: options.authClient,
    userDirectory: options.userDirectory,
    festivalUploadDirectory: options.uploadDirectory,
    ...(options.sportsUploadDirectory
      ? { sportsUploadDirectory: options.sportsUploadDirectory }
      : {}),
  });
  return { app, close: handle.close };
}
