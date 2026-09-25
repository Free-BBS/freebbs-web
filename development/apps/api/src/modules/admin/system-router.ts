import type { ApiEnvelope } from '@freebbs-development/contracts';
import { Router } from 'express';
import type { Response } from 'express';

import type { DataMode } from '../../core/database/create-store.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { listModuleManifests } from '../../core/modules/registry.js';

export interface SystemRouterOptions {
  store: DevelopmentStore;
  version: string;
  dataMode: DataMode;
  getAppliedMigrationCount(): Promise<number>;
}

function send<T>(response: Response, status: number, data: T): void {
  const envelope: ApiEnvelope<T> = {
    data,
    requestId: response.locals.requestId as string,
  };
  response.status(status).json(envelope);
}

export function createSystemRouter(options: SystemRouterOptions): Router {
  const router = Router();

  router.get('/system-status', async (_request, response) => {
    const [modules, appliedMigrationCount] = await Promise.all([
      listModuleManifests(options.store),
      options.getAppliedMigrationCount(),
    ]);
    const enabled = modules.filter(({ status }) => status === 'enabled').length;
    send(response, 200, {
      version: options.version,
      dataMode: options.dataMode,
      appliedMigrationCount,
      moduleCounts: {
        total: modules.length,
        enabled,
        disabled: modules.length - enabled,
      },
    });
  });

  return router;
}
