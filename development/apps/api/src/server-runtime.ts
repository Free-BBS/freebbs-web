import type { Server } from 'node:http';

import { createApp } from './app.js';
import { createStore } from './core/database/create-store.js';

export interface ServerRuntimeDependencies {
  createApp: typeof createApp;
  createStore: typeof createStore;
}

export interface StartServerRuntimeOptions {
  host: string;
  port: number;
  dependencies?: ServerRuntimeDependencies;
}

export interface ServerRuntime {
  server: Server;
  close(): Promise<void>;
}

const defaultDependencies: ServerRuntimeDependencies = { createApp, createStore };

function onceAsync(action: () => Promise<void>): () => Promise<void> {
  let result: Promise<void> | undefined;
  return () => {
    result ??= action();
    return result;
  };
}

function waitForListening(server: Server): Promise<void> {
  if (server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onListening = (): void => {
      cleanup();
      resolve();
    };
    const ignoreFurtherStartupErrors = (): void => undefined;
    const onError = (error: Error): void => {
      server.on('error', ignoreFurtherStartupErrors);
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      server.removeListener('listening', onListening);
      server.removeListener('error', onError);
    };

    server.once('listening', onListening);
    server.once('error', onError);
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function startServerRuntime({
  host,
  port,
  dependencies = defaultDependencies,
}: StartServerRuntimeOptions): Promise<ServerRuntime> {
  const handle = dependencies.createStore();
  const closeStore = onceAsync(() => handle.close());
  let server: Server;

  try {
    const app = dependencies.createApp({
      store: handle.store,
      databaseMode: handle.mode,
      getAppliedMigrationCount: handle.getAppliedMigrationCount,
      checkReadiness: handle.checkReadiness,
    });
    server = app.listen(port, host);
    await waitForListening(server);
  } catch (error) {
    await closeStore();
    throw error;
  }

  const close = onceAsync(async () => {
    try {
      await closeServer(server);
    } finally {
      await closeStore();
    }
  });

  return { server, close };
}
