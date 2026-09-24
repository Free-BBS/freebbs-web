import type { ApiEnvelope, PermissionAction } from '@freebbs-development/contracts';
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { BUILT_IN_TAG_DEFINITIONS } from '../../core/bootstrap/built-in-definitions.js';
import type {
  DevelopmentStore,
  TagDefinitionRecord,
  TagPermissionRecord,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import {
  permissionBindingIdentity,
  permissionBindingTuple,
  type PermissionBindingInput,
  validateRegisteredPermissionBindings,
} from './permissions-router.js';
import {
  createTagDefinitionSchema,
  patchTagDefinitionSchema,
  replacePermissionBindingsSchema,
  tagKeySchema,
} from './schemas.js';
import { adminActor } from './subjects-router.js';

const publicScope = { type: 'public', id: '*' } as const;
const builtInTagKeys = new Set(BUILT_IN_TAG_DEFINITIONS.map(({ key }) => key));

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

function definitionIdentity(definition: TagDefinitionRecord) {
  return {
    key: definition.key,
    name: definition.name,
    description: definition.description,
    requiredScopeType: definition.requiredScopeType,
    metadata: definition.metadata,
    status: definition.status,
  };
}

function validateTagBindingScope(
  definition: TagDefinitionRecord,
  binding: PermissionBindingInput,
): void {
  if (definition.requiredScopeType === null) {
    if (binding.scope.type !== publicScope.type || binding.scope.id !== publicScope.id) {
      throw new HttpError(
        400,
        'invalid_tag_permission_scope',
        'Tag permission scope does not match its definition',
      );
    }
    return;
  }
  if (binding.scope.type !== definition.requiredScopeType || binding.scope.id !== '*') {
    throw new HttpError(
      400,
      'invalid_tag_permission_scope',
      'Tag permission scope does not match its definition',
    );
  }
}

async function createTagDefinition(
  store: DevelopmentStore,
  input: z.infer<typeof createTagDefinitionSchema>,
  actorUid: string,
): Promise<TagDefinitionRecord> {
  return store.transaction(async (transactionStore) => {
    const existing = (
      await transactionStore.tagDefinitions.listForUpdate({ query: input.key })
    ).find(({ key }) => key === input.key);
    if (existing !== undefined) {
      throw new HttpError(409, 'tag_definition_exists', 'Tag definition already exists');
    }
    const created = await transactionStore.tagDefinitions.create({
      ...input,
      status: 'active',
      ownerUid: actorUid,
      scope: publicScope,
    });
    await recordAuditEvent(transactionStore, {
      actorUid,
      action: 'admin.tag_definition.create',
      resourceType: 'tag_definition',
      resourceId: created.key,
      details: { newDefinition: definitionIdentity(created) },
    });
    return created;
  });
}

async function patchTagDefinition(
  store: DevelopmentStore,
  tagKey: string,
  input: z.infer<typeof patchTagDefinitionSchema>,
  actorUid: string,
): Promise<TagDefinitionRecord> {
  return store.transaction(async (transactionStore) => {
    const definition = (
      await transactionStore.tagDefinitions.listForUpdate({ query: tagKey })
    ).find(({ key }) => key === tagKey);
    if (definition === undefined) {
      throw new HttpError(404, 'tag_definition_not_found', 'Tag definition not found');
    }
    if (input.key !== undefined && input.key !== tagKey) {
      throw new HttpError(409, 'tag_key_immutable', 'Tag definition key is immutable');
    }

    const builtIn = builtInTagKeys.has(tagKey as never);

    if (
      builtIn &&
      input.requiredScopeType !== undefined &&
      input.requiredScopeType !== definition.requiredScopeType
    ) {
      throw new HttpError(
        409,
        'built_in_tag_immutable',
        'Built-in Tag scope requirements are immutable',
      );
    }

    if (
      !builtIn &&
      input.requiredScopeType !== undefined &&
      input.requiredScopeType !== definition.requiredScopeType
    ) {
      const bindings = await transactionStore.tagPermissions.listForUpdate({ query: tagKey });
      const assignments = await transactionStore.tagAssignments.listForUpdate({ query: tagKey });
      const inUse = [...bindings, ...assignments].some(
        (record) =>
          record.status === 'active' && ('tagKey' in record ? record.tagKey === tagKey : false),
      );
      if (inUse) {
        throw new HttpError(
          409,
          'tag_scope_in_use',
          'Archive active Tag bindings and assignments before changing required scope',
        );
      }
    }

    const updated = await transactionStore.tagDefinitions.update(definition.id, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.requiredScopeType === undefined
        ? {}
        : { requiredScopeType: input.requiredScopeType }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ownerUid: actorUid,
    });
    if (updated === null) throw new Error('Failed to update Tag definition');
    await recordAuditEvent(transactionStore, {
      actorUid,
      action: 'admin.tag_definition.update',
      resourceType: 'tag_definition',
      resourceId: tagKey,
      details: {
        oldDefinition: definitionIdentity(definition),
        newDefinition: definitionIdentity(updated),
      },
    });
    return updated;
  });
}

async function replaceTagPermissions(
  store: DevelopmentStore,
  tagKey: string,
  bindings: readonly PermissionBindingInput[],
  actorUid: string,
): Promise<TagPermissionRecord[]> {
  return store.transaction(async (transactionStore) => {
    const definition = (
      await transactionStore.tagDefinitions.listForUpdate({ query: tagKey })
    ).find(({ key }) => key === tagKey);
    if (definition === undefined) {
      throw new HttpError(404, 'tag_definition_not_found', 'Tag definition not found');
    }
    if (definition.status !== 'active') {
      throw new HttpError(409, 'tag_definition_inactive', 'Tag definition is not active');
    }

    const existing = (
      await transactionStore.tagPermissions.listForUpdate({ query: tagKey })
    ).filter((binding) => binding.tagKey === tagKey);
    for (const binding of bindings) validateTagBindingScope(definition, binding);
    await validateRegisteredPermissionBindings(transactionStore, bindings);

    const desiredByTuple = new Map(
      bindings.map((binding) => [permissionBindingTuple(binding), binding]),
    );
    const activeBefore = existing
      .filter(({ status }) => status === 'active')
      .map(permissionBindingIdentity);
    const replaced: TagPermissionRecord[] = [];
    const restoredTuples = new Set<string>();

    for (const current of existing) {
      const tuple = permissionBindingTuple(current);
      const desired = desiredByTuple.get(tuple);
      if (desired === undefined) {
        if (current.status === 'active') {
          const archived = await transactionStore.tagPermissions.update(current.id, {
            status: 'inactive',
            ownerUid: actorUid,
          });
          if (archived === null) throw new Error('Failed to archive Tag permission binding');
        }
        continue;
      }
      const restored = await transactionStore.tagPermissions.update(current.id, {
        effect: desired.effect,
        status: 'active',
        ownerUid: actorUid,
      });
      if (restored === null) throw new Error('Failed to restore Tag permission binding');
      replaced.push(restored);
      restoredTuples.add(tuple);
    }

    for (const desired of bindings) {
      const tuple = permissionBindingTuple(desired);
      if (restoredTuples.has(tuple)) continue;
      replaced.push(
        await transactionStore.tagPermissions.create({
          tagKey,
          action: desired.action as PermissionAction,
          resource: desired.resource,
          effect: desired.effect,
          status: 'active',
          ownerUid: actorUid,
          scope: desired.scope,
        }),
      );
    }

    const byTuple = new Map(replaced.map((binding) => [permissionBindingTuple(binding), binding]));
    const ordered = bindings.map((binding) => {
      const record = byTuple.get(permissionBindingTuple(binding));
      if (record === undefined) throw new Error('Failed to replace Tag permission binding');
      return record;
    });
    await recordAuditEvent(transactionStore, {
      actorUid,
      action: 'admin.tag_permissions.replace',
      resourceType: 'tag_definition',
      resourceId: tagKey,
      details: {
        oldBindings: activeBefore,
        newBindings: bindings.map(permissionBindingIdentity),
      },
    });
    return ordered;
  });
}

export function createTagsRouter(store: DevelopmentStore): Router {
  const router = Router();

  router.get('/tag-definitions', async (_request, response) => {
    send(response, 200, await store.tagDefinitions.list());
  });

  router.post('/tag-definitions', async (request, response) => {
    const input = parse(createTagDefinitionSchema, request.body);
    const definition = await createTagDefinition(store, input, adminActor(response).uid);
    send(response, 201, definition);
  });

  router.patch('/tag-definitions/:tagKey', async (request, response) => {
    const tagKey = parse(tagKeySchema, request.params.tagKey);
    const input = parse(patchTagDefinitionSchema, request.body);
    const definition = await patchTagDefinition(store, tagKey, input, adminActor(response).uid);
    send(response, 200, definition);
  });

  router.get('/tag-permissions', async (_request, response) => {
    send(response, 200, await store.tagPermissions.list());
  });

  router.put('/tag-definitions/:tagKey/permissions', async (request, response) => {
    const tagKey = parse(tagKeySchema, request.params.tagKey);
    const input = parse(replacePermissionBindingsSchema, request.body);
    const bindings = await replaceTagPermissions(
      store,
      tagKey,
      input.bindings,
      adminActor(response).uid,
    );
    send(response, 200, { tagKey, bindings });
  });

  return router;
}
