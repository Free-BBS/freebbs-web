import { createApp } from './app.js';
import type { AuthClient } from './core/auth/auth-client.js';
import type { UserDirectory } from './core/auth/user-directory.js';
import { createMySqlStore } from './core/database/mysql-store.js';
import { startFeedScheduler } from './modules/connectors/feed.js';
import type { DevelopmentRewardProvider } from '@freebbs-development/contracts';
import type { LearningAchievementProvider } from './modules/growth/atlas-service.js';
import {
  resolvePlatformAuthority,
  type PlatformAuthority,
} from './core/auth/platform-authority.js';

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
  collectionsUploadDirectory: string;
  sportsUploadDirectory?: string;
  financeDirectory?: string;
  publicUploadDirectory?: string;
  developmentRewardProvider?: DevelopmentRewardProvider;
  learningAchievementProvider?: LearningAchievementProvider;
  developmentMapTokenDigest?: string;
}

export interface IntegratedRuntime {
  app: ReturnType<typeof createApp>;
  resolvePlatformAuthority(uid: string): Promise<PlatformAuthority>;
  close(): Promise<void>;
}

export async function createIntegratedDevelopmentRuntime(
  options: IntegratedRuntimeOptions,
): Promise<IntegratedRuntime> {
  const handle = createMySqlStore({ config: options.database });
  try {
    await handle.checkReadiness();
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? 'production',
      AUTH_MODE: 'main',
      HOST: '127.0.0.1',
    };
    const app = createApp({
      environment,
      store: handle.store,
      databaseMode: 'mysql',
      getAppliedMigrationCount: handle.getAppliedMigrationCount,
      checkReadiness: handle.checkReadiness,
      authMode: 'main',
      authClient: options.authClient,
      userDirectory: options.userDirectory,
      festivalUploadDirectory: options.uploadDirectory,
      collectionsUploadDirectory: options.collectionsUploadDirectory,
      ...(options.financeDirectory ? { financeDirectory: options.financeDirectory } : {}),
      ...(options.publicUploadDirectory
        ? { publicUploadDirectory: options.publicUploadDirectory }
        : {}),
      ...(options.sportsUploadDirectory
        ? { sportsUploadDirectory: options.sportsUploadDirectory }
        : {}),
      ...(options.developmentRewardProvider
        ? { developmentRewardProvider: options.developmentRewardProvider }
        : {}),
      ...(options.learningAchievementProvider
        ? { learningAchievementProvider: options.learningAchievementProvider }
        : {}),
      ...(options.developmentMapTokenDigest
        ? { developmentMapTokenDigest: options.developmentMapTokenDigest }
        : {}),
    });
    const stopFeed = startFeedScheduler(options.collectionsUploadDirectory, environment);
    let closing: Promise<void> | undefined;
    return {
      app,
      resolvePlatformAuthority: (uid) =>
        resolvePlatformAuthority(
          handle.store,
          uid,
          new Date(),
          environment.PLATFORM_ROOT_ADMIN_UIDS,
        ),
      close: () => {
        closing ??= Promise.resolve().then(async () => {
          try {
            stopFeed();
          } finally {
            await handle.close();
          }
        });
        return closing;
      },
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
