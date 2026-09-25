import type { ApiEnvelope, ModuleId } from '@freebbs-development/contracts';
import { MODULE_IDS } from '@freebbs-development/contracts';
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import type {
  DevelopmentStore,
  ModuleOwnerRecord,
  ModuleRecord,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { getModuleRecord, listModuleManifests } from '../../core/modules/registry.js';
import { adminActor } from './subjects-router.js';

const identifier = z.string().trim().min(1).max(128);
const moduleIdSchema = z.enum(MODULE_IDS);
const ownerSchema = z
  .object({
    ownerType: z.enum(['role', 'subject', 'team']),
    ownerId: identifier,
  })
  .strict();
const replaceOwnersSchema = z
  .object({ owners: z.array(ownerSchema).max(500) })
  .strict()
  .superRefine(({ owners }, context) => {
    const tuples = new Set<string>();
    for (const [index, owner] of owners.entries()) {
      const tuple = ownerTuple(owner);
      if (tuples.has(tuple)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Module owner targets must be unique',
          path: ['owners', index],
        });
      }
      tuples.add(tuple);
    }
  });

type OwnerInput = z.infer<typeof ownerSchema>;

function send<T>(response: Response, status: number, data: T): void {
  const envelope: ApiEnvelope<T> = {
    data,
    requestId: response.locals.requestId as string,
  };
  response.status(status).json(envelope);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'invalid_request', 'Request validation failed');
  return result.data;
}

function ownerTuple(owner: Pick<ModuleOwnerRecord, 'ownerType' | 'ownerId'>): string {
  return `${owner.ownerType}\u0000${owner.ownerId}`;
}

function ownerIdentity(owner: Pick<ModuleOwnerRecord, 'ownerType' | 'ownerId'>): OwnerInput {
  return { ownerType: owner.ownerType, ownerId: owner.ownerId };
}

function compareOwners(left: ModuleOwnerRecord, right: ModuleOwnerRecord): number {
  const typeOrder = { role: 0, subject: 1, team: 2 } as const;
  return (
    typeOrder[left.ownerType] - typeOrder[right.ownerType] ||
    left.ownerId.localeCompare(right.ownerId)
  );
}

async function requireModule(store: DevelopmentStore, moduleId: ModuleId): Promise<ModuleRecord> {
  const module = await getModuleRecord(store, moduleId);
  if (module === null) throw new HttpError(404, 'module_not_found', 'Module not found');
  return module;
}

async function validateOwnerTargets(
  store: DevelopmentStore,
  owners: readonly OwnerInput[],
): Promise<void> {
  const roles = owners.some(({ ownerType }) => ownerType === 'role')
    ? await store.roles.listForUpdate()
    : [];
  const subjects = owners.some(({ ownerType }) => ownerType === 'subject')
    ? await store.subjects.listForUpdate()
    : [];
  const teams = owners.some(({ ownerType }) => ownerType === 'team')
    ? await store.sportsTeams.listForUpdate()
    : [];

  for (const owner of owners) {
    const target =
      owner.ownerType === 'role'
        ? roles.find(({ key }) => key === owner.ownerId)
        : owner.ownerType === 'subject'
          ? subjects.find(({ uid }) => uid === owner.ownerId)
          : teams.find(({ id }) => id === owner.ownerId);
    if (target === undefined) {
      throw new HttpError(
        400,
        'module_owner_target_not_found',
        'Module owner target does not exist',
      );
    }
    if (target.status !== 'active') {
      throw new HttpError(409, 'module_owner_target_inactive', 'Module owner target is not active');
    }
  }
}

async function replaceOwners(
  store: DevelopmentStore,
  moduleId: ModuleId,
  desired: readonly OwnerInput[],
  actorUid: string,
): Promise<ModuleOwnerRecord[]> {
  return store.transaction(async (transactionStore) => {
    const module = (await transactionStore.modules.listForUpdate({ query: moduleId })).find(
      (candidate) => candidate.moduleId === moduleId,
    );
    if (module === undefined) throw new HttpError(404, 'module_not_found', 'Module not found');

    const existing = (
      await transactionStore.moduleOwners.listForUpdate({ query: moduleId })
    ).filter((owner) => owner.moduleId === moduleId);
    await validateOwnerTargets(transactionStore, desired);

    const desiredByTuple = new Map(desired.map((owner) => [ownerTuple(owner), owner]));
    const existingByTuple = new Map(existing.map((owner) => [ownerTuple(owner), owner]));
    const oldOwners = existing.filter(({ status }) => status === 'active').map(ownerIdentity);

    for (const current of existing) {
      const wanted = desiredByTuple.has(ownerTuple(current));
      const status = wanted ? 'active' : 'inactive';
      if (current.status === status && current.ownerUid === actorUid) continue;
      const updated = await transactionStore.moduleOwners.update(current.id, {
        status,
        ownerUid: actorUid,
      });
      if (updated === null) throw new Error('Failed to update module owner');
    }

    for (const owner of desired) {
      if (existingByTuple.has(ownerTuple(owner))) continue;
      await transactionStore.moduleOwners.create({
        moduleId,
        ...owner,
        status: 'active',
        ownerUid: actorUid,
        scope: { type: 'public', id: '*' },
      });
    }

    const replaced = (await transactionStore.moduleOwners.list({ query: moduleId })).filter(
      (owner) => owner.moduleId === moduleId && owner.status === 'active',
    );
    const replacedByTuple = new Map(replaced.map((owner) => [ownerTuple(owner), owner]));
    const ordered = desired.map((owner) => {
      const record = replacedByTuple.get(ownerTuple(owner));
      if (record === undefined) throw new Error('Failed to replace module owners');
      return record;
    });

    await recordAuditEvent(transactionStore, {
      actorUid,
      action: 'admin.module_owners.replace',
      resourceType: 'module',
      resourceId: moduleId,
      details: {
        oldOwners,
        newOwners: desired.map(ownerIdentity),
      },
    });
    return ordered;
  });
}

export function createModulesRouter(store: DevelopmentStore): Router {
  const router = Router();

  router.get('/modules', async (_request, response) => {
    send(response, 200, await listModuleManifests(store));
  });

  router.patch('/modules', async (request, response) => {
    const input = parse(
      z.object({ moduleId: moduleIdSchema, enabled: z.boolean() }).strict(),
      request.body,
    );
    if (input.moduleId === 'admin' && !input.enabled) {
      throw new HttpError(
        409,
        'protected_admin_module',
        'The administration module cannot be disabled',
      );
    }
    await store.transaction(async (transactionStore) => {
      const record = (await transactionStore.modules.listForUpdate({ query: input.moduleId })).find(
        (candidate) => candidate.moduleId === input.moduleId,
      );
      if (record === undefined) throw new HttpError(404, 'module_not_found', 'Module not found');
      const updated = await transactionStore.modules.update(record.id, {
        enabled: input.enabled,
        status: input.enabled ? 'enabled' : 'disabled',
        ownerUid: adminActor(response).uid,
      });
      if (updated === null) throw new Error('Failed to update module');
      await recordAuditEvent(transactionStore, {
        actorUid: adminActor(response).uid,
        action: 'admin.module.update',
        resourceType: 'module',
        resourceId: input.moduleId,
        details: {
          old: { enabled: record.enabled, status: record.status },
          new: { enabled: updated.enabled, status: updated.status },
        },
      });
    });
    const manifest = (await listModuleManifests(store)).find(
      (candidate) => candidate.id === input.moduleId,
    );
    if (manifest === undefined) throw new HttpError(404, 'module_not_found', 'Module not found');
    send(response, 200, manifest);
  });

  router.get('/modules/:moduleId/owners', async (request, response) => {
    const moduleId = parse(moduleIdSchema, request.params.moduleId);
    await requireModule(store, moduleId);
    const owners = (await store.moduleOwners.list({ query: moduleId }))
      .filter((owner) => owner.moduleId === moduleId && owner.status === 'active')
      .sort(compareOwners);
    send(response, 200, { moduleId, owners });
  });

  router.put('/modules/:moduleId/owners', async (request, response) => {
    const moduleId = parse(moduleIdSchema, request.params.moduleId);
    const input = parse(replaceOwnersSchema, request.body);
    const owners = await replaceOwners(store, moduleId, input.owners, adminActor(response).uid);
    send(response, 200, { moduleId, owners });
  });

  return router;
}
