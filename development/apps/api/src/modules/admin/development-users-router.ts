import {
  ROLE_KEYS,
  type ApiEnvelope,
  type BatchAllowDevelopmentUsersResponse,
} from '@freebbs-development/contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { synchronizeSubject } from '../../core/auth/auth-middleware.js';
import { upsertDevelopmentAccessInTransaction } from '../../core/auth/development-access.js';
import { directoryUserContext, type UserDirectory } from '../../core/auth/user-directory.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { adminActor } from './subjects-router.js';
import {
  hasDevelopmentGrant,
  listDirectoryRows,
  parseDirectoryFilters,
  groupedByUid,
  accessLookup,
} from '../system-settings/users.js';
const ASSIGNABLE_ROLES = ROLE_KEYS.filter((key) => key !== 'platform.super_admin');
const publicScope = { type: 'public', id: '*' } as const;
const updateSchema = z.object({ accessLevel: z.enum(['member', 'lead']).nullable() }).strict();
const batchAllowSchema = z
  .object({
    uids: z
      .array(z.string().trim().min(1).max(191))
      .min(1)
      .max(100)
      .refine((uids) => new Set(uids).size === uids.length, 'UIDs must be unique'),
  })
  .strict();
function send<T>(response: Response, status: number, data: T): void {
  const envelope: ApiEnvelope<T> = { data, requestId: response.locals.requestId as string };
  response.status(status).json(envelope);
}
export function createDevelopmentUsersRouter(
  store: DevelopmentStore,
  directory: UserDirectory,
  allowedUids: readonly string[] = [],
): Router {
  const router = Router();
  router.post('/batch-allow', async (request, response) => {
    const parsed = batchAllowSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'invalid_request', '请选择 1 至 100 位不同用户');
    const targets = await Promise.all(
      parsed.data.uids.map(async (uid) => {
        const target = await directory.get(uid);
        if (!target || target.uid !== uid)
          throw new HttpError(404, 'user_not_found', 'Main-site user was not found');
        return target;
      }),
    );
    const actor = adminActor(response);
    const result = await store.transaction(async (transactionStore) => {
      // Use the same global guards as single-user access updates, in stable order.
      await transactionStore.roles.listForUpdate({ key: 'platform.admin' });
      await transactionStore.roles.listForUpdate({ key: 'platform.super_admin' });
      const records = await transactionStore.developmentAccess.list();
      const items: BatchAllowDevelopmentUsersResponse['items'] = [];
      let changedCount = 0;
      for (const target of targets) {
        const matching = records.filter((record) => hasDevelopmentGrant(target, [record]));
        if (hasDevelopmentGrant(target, records, allowedUids)) {
          // Preserve all existing grants and lead aliases; allowing access never demotes a lead.
          items.push({
            uid: target.uid,
            accessLevel: matching.some((record) => record.accessLevel === 'lead')
              ? 'lead'
              : 'member',
          });
          continue;
        }
        await synchronizeSubject(transactionStore, directoryUserContext(target), new Date());
        const record = await upsertDevelopmentAccessInTransaction(transactionStore, {
          user: directoryUserContext(target),
          accessLevel: 'member',
          actorUid: actor.uid,
        });
        if (record) records.push(record);
        items.push({ uid: target.uid, accessLevel: 'member' });
        changedCount += 1;
        await transactionStore.auditLogs.create({
          actorUid: actor.uid,
          action: 'admin.development_access.update',
          resourceType: 'development_access',
          resourceId: target.uid,
          details: {
            previous: { accessLevel: null },
            next: { accessLevel: 'member' },
            batch: true,
          },
          status: 'active',
          ownerUid: actor.uid,
          scope: publicScope,
        });
      }
      if (changedCount)
        await transactionStore.auditLogs.create({
          actorUid: actor.uid,
          action: 'admin.development_access.batch_allow',
          resourceType: 'development_access',
          resourceId: actor.uid,
          details: {
            uids: parsed.data.uids,
            changedCount,
            unchangedCount: targets.length - changedCount,
          },
          status: 'active',
          ownerUid: actor.uid,
          scope: publicScope,
        });
      return { items, changedCount, unchangedCount: targets.length - changedCount };
    });
    send<BatchAllowDevelopmentUsersResponse>(response, 200, result);
  });
  router.get('/', async (request, response) => {
    const filters = parseDirectoryFilters(request.query);
    const paged = ['page', 'pageSize', 'roleKey', 'organizationId', 'admission'].some(
      (key) => key in request.query,
    );
    const mapUser = ({
      user,
      roles,
      tags,
      grant,
    }: Awaited<ReturnType<typeof listDirectoryRows>>['items'][number]) => ({
      ...user,
      accessLevel: grant?.accessLevel ?? 'member',
      roles: roles
        .filter(
          (row) =>
            row.status === 'active' &&
            (row.expiresAt === null || Date.parse(row.expiresAt) > Date.now()) &&
            row.roleKey !== 'platform.super_admin',
        )
        .map((row) => row.roleKey),
      captainTeamIds: tags
        .filter(
          (row) =>
            row.status === 'active' &&
            (row.expiresAt === null || Date.parse(row.expiresAt) > Date.now()) &&
            row.tagKey === 'sports.team_captain',
        )
        .map((row) => row.scope.id),
    });
    if (paged) {
      const page = await listDirectoryRows(store, directory, filters, false, allowedUids);
      send(response, 200, { ...page, items: page.items.map(mapUser) });
    } else {
      const [users, roles, tags, access] = await Promise.all([
        directory.list(filters.query),
        store.roleAssignments.list(),
        store.tagAssignments.list({ tagKey: 'sports.team_captain' }),
        store.developmentAccess.list(),
      ]);
      const roleGroups = groupedByUid(roles),
        tagGroups = groupedByUid(tags),
        grantFor = accessLookup(access);
      send(
        response,
        200,
        users.map((user) =>
          mapUser({
            user,
            roles: roleGroups.get(user.uid) ?? [],
            tags: tagGroups.get(user.uid) ?? [],
            grant: grantFor(user),
          }),
        ),
      );
    }
  });
  router.put('/:uid', async (request, response) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'invalid_request', 'Invalid access settings');
    const target = await directory.get(String(request.params.uid));
    if (!target) throw new HttpError(404, 'user_not_found', 'Main-site user was not found');
    const actor = adminActor(response);
    await store.transaction(async (transactionStore) => {
      await transactionStore.roles.listForUpdate({ key: 'platform.admin' });
      await transactionStore.roles.listForUpdate({ key: 'platform.super_admin' });
      await synchronizeSubject(transactionStore, directoryUserContext(target), new Date());
      const records = await transactionStore.developmentAccess.list();
      const previous = records.find((record) => hasDevelopmentGrant(target, [record]));
      await upsertDevelopmentAccessInTransaction(transactionStore, {
        user: directoryUserContext(target),
        accessLevel: parsed.data.accessLevel,
        actorUid: actor.uid,
      });
      await transactionStore.auditLogs.create({
        actorUid: actor.uid,
        action: 'admin.development_access.update',
        resourceType: 'development_access',
        resourceId: target.uid,
        details: {
          previous: { accessLevel: previous?.accessLevel ?? null },
          next: { accessLevel: parsed.data.accessLevel },
        },
        status: 'active',
        ownerUid: actor.uid,
        scope: publicScope,
      });
    });
    send(response, 200, { updated: true, uid: target.uid });
  });
  return router;
}
export { ASSIGNABLE_ROLES };
