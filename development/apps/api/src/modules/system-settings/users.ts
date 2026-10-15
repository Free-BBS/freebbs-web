import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  validateIdentitySelection,
  organizationForRole,
  ROLE_KEYS,
  SOCIAL_ORGANIZATION_IDS,
  type DevelopmentDirectoryFilters,
  type SystemSettingsUser,
  type SystemSettingsUserInput,
} from '@freebbs-development/contracts';
import { synchronizeSubject } from '../../core/auth/auth-middleware.js';
import {
  directoryUserContext,
  directoryPage,
  type DirectoryIdentityFilter,
  type DirectoryUser,
  type UserDirectory,
} from '../../core/auth/user-directory.js';
import type {
  DevelopmentStore,
  DevelopmentAccessRecord,
  RoleAssignmentRecord,
  TagAssignmentRecord,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import {
  businessAdminIdentities,
  effectiveGlobalBusinessAdmins,
} from '../../core/authorization/business-admin.js';

const scope = { type: 'public', id: '*' } as const;
const current = (row: { status: string; expiresAt: string | null }, now = Date.now()) =>
  row.status === 'active' && (row.expiresAt === null || Date.parse(row.expiresAt) > now);
const editableBusinessIdentity = (row: RoleAssignmentRecord) =>
  row.roleKey !== 'platform.admin' || (row.scope.type === 'public' && row.scope.id === '*');
export function hasRecipientAccess(
  user: DirectoryUser,
  access: DevelopmentAccessRecord[],
  allowedUids: readonly string[] = [],
) {
  return (
    allowedUids.includes(user.uid) ||
    access.some(
      (grant) =>
        grant.status === 'active' &&
        (grant.subjectUid
          ? grant.subjectUid === user.uid
          : grant.studentId
            ? grant.studentId === user.studentId
            : Boolean(
                grant.username &&
                grant.username.toLocaleLowerCase() === user.username.toLocaleLowerCase(),
              )),
    )
  );
}
export function identitySnapshot(
  user: DirectoryUser,
  roles: RoleAssignmentRecord[],
  tags: TagAssignmentRecord[],
  access: DevelopmentAccessRecord[] = [],
  demo = false,
  allowedUids: readonly string[] = [],
): SystemSettingsUser {
  const now = Date.now();
  const currentlyActive = (row: { status: string; expiresAt: string | null }) => current(row, now);
  const ownedRoles = roles.filter(
    (row) => row.subjectUid === user.uid && row.roleKey !== 'platform.super_admin',
  );
  const ownedTags = tags.filter(
    (row) => row.subjectUid === user.uid && row.tagKey === 'sports.team_captain',
  );
  // Include effective expiry state too: an old checked grant expiring while the
  // editor is open must cause a stale revision, not become a new permanent grant.
  const revision = createHash('sha256')
    .update(
      JSON.stringify([
        ownedRoles
          .map((row) => [
            row.id,
            row.roleKey,
            row.status,
            row.scope,
            row.expiresAt,
            row.updatedAt,
            currentlyActive(row),
          ])
          .sort(),
        ownedTags
          .map((row) => [
            row.id,
            row.scope,
            row.status,
            row.expiresAt,
            row.updatedAt,
            currentlyActive(row),
          ])
          .sort(),
      ]),
    )
    .digest('hex');
  return {
    ...user,
    roles: [
      ...new Set(
        ownedRoles
          .filter((row) => currentlyActive(row) && editableBusinessIdentity(row))
          .map((row) => row.roleKey),
      ),
    ].sort() as SystemSettingsUser['roles'],
    captainTeamIds: [
      ...new Set(
        ownedTags
          .filter((row) => currentlyActive(row) && row.scope.type === 'sports_team')
          .map((row) => row.scope.id),
      ),
    ].sort(),
    revision,
    canReceiveNotifications: demo || hasRecipientAccess(user, access, allowedUids),
  };
}
export const directoryFiltersSchema = z
  .object({
    query: z.string().trim().max(80).optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    roleKey: z.enum(ROLE_KEYS).optional(),
    organizationId: z.enum(SOCIAL_ORGANIZATION_IDS).optional(),
    admission: z.enum(['admitted', 'not_admitted', 'member', 'lead']).optional(),
  })
  .strict();
export function parseDirectoryFilters(query: unknown): DevelopmentDirectoryFilters {
  const parsed = directoryFiltersSchema.safeParse(query);
  if (!parsed.success) throw new HttpError(400, 'invalid_request', 'Invalid directory filters');
  return parsed.data;
}
export function groupedByUid<T extends { subjectUid: string }>(rows: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const owned = result.get(row.subjectUid);
    if (owned) owned.push(row);
    else result.set(row.subjectUid, [row]);
  }
  return result;
}
export function accessLookup(rows: DevelopmentAccessRecord[]) {
  const maps = {
    uid: new Map<string, { row: DevelopmentAccessRecord; index: number }>(),
    studentId: new Map<string, { row: DevelopmentAccessRecord; index: number }>(),
    username: new Map<string, { row: DevelopmentAccessRecord; index: number }>(),
  };
  rows.forEach((row, index) => {
    if (row.status !== 'active') return;
    const [map, key] = row.subjectUid
      ? [maps.uid, row.subjectUid]
      : row.studentId
        ? [maps.studentId, row.studentId]
        : [maps.username, row.username?.toLocaleLowerCase()];
    if (key && !map.has(key)) map.set(key, { row, index });
  });
  return (user: DirectoryUser) =>
    [
      maps.uid.get(user.uid),
      maps.studentId.get(user.studentId ?? ''),
      maps.username.get(user.username.toLocaleLowerCase()),
    ]
      .filter((value) => value !== undefined)
      .sort((a, b) => a.index - b.index)[0]?.row;
}
export async function listDirectoryRows(
  store: DevelopmentStore,
  directory: UserDirectory,
  filters: DevelopmentDirectoryFilters,
  demo = false,
  allowedUids: readonly string[] = [],
) {
  const [filterRoles, access] = await Promise.all([
    filters.roleKey || filters.organizationId
      ? store.roleAssignments.list({
          status: 'active',
          ...(filters.roleKey ? { roleKey: filters.roleKey } : {}),
        })
      : Promise.resolve([] as RoleAssignmentRecord[]),
    store.developmentAccess.list(),
  ]);
  let uids: string[] | undefined;
  for (const predicate of [
    filters.roleKey ? (row: RoleAssignmentRecord) => row.roleKey === filters.roleKey : undefined,
    filters.organizationId
      ? (row: RoleAssignmentRecord) =>
          organizationForRole(row.roleKey)?.organizationId === filters.organizationId
      : undefined,
  ]) {
    if (!predicate) continue;
    const selected = new Set(
      filterRoles.filter((row) => current(row) && predicate(row)).map((row) => row.subjectUid),
    );
    uids = uids ? uids.filter((uid) => selected.has(uid)) : [...selected];
  }
  const identityFilter: DirectoryIdentityFilter = { uids: [], studentIds: [], usernames: [] };
  const includedUids: string[] = [],
    studentIds: string[] = [],
    usernames: string[] = [];
  for (const grant of access) {
    if (
      grant.status !== 'active' ||
      ((filters.admission === 'lead' || filters.admission === 'member') &&
        grant.accessLevel !== filters.admission)
    )
      continue;
    if (grant.subjectUid) includedUids.push(grant.subjectUid);
    else if (grant.studentId) studentIds.push(grant.studentId);
    else if (grant.username) usernames.push(grant.username.toLocaleLowerCase());
  }
  if (filters.admission === 'member') {
    const grantFor = accessLookup(access);
    const identities = await Promise.all(allowedUids.map((uid) => directory.get(uid)));
    includedUids.push(
      ...identities
        .filter(
          (user): user is DirectoryUser => user !== null && grantFor(user)?.accessLevel !== 'lead',
        )
        .map((user) => user.uid),
    );
  } else if (filters.admission !== 'lead') includedUids.push(...allowedUids);
  Object.assign(identityFilter, { uids: includedUids, studentIds, usernames });
  const page = await directoryPage(directory, {
    query: filters.query,
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 20,
    uids,
    ...(!filters.admission || (demo && ['admitted', 'not_admitted'].includes(filters.admission))
      ? {}
      : filters.admission === 'not_admitted'
        ? { exclude: identityFilter }
        : { include: identityFilter }),
    ...(demo && filters.admission === 'not_admitted' ? { uids: [] } : {}),
  });
  const pageUids = page.items.map((user) => user.uid);
  const [roles, tags] = await Promise.all([
    store.roleAssignments.list({ subjectUids: pageUids }),
    store.tagAssignments.list({ subjectUids: pageUids, tagKey: 'sports.team_captain' }),
  ]);
  const ownedRoles = groupedByUid(roles),
    ownedTags = groupedByUid(tags),
    grantFor = accessLookup(access);
  return {
    ...page,
    items: page.items.map((user) => ({
      user,
      roles: ownedRoles.get(user.uid) ?? [],
      tags: ownedTags.get(user.uid) ?? [],
      grant: grantFor(user),
    })),
  };
}
export async function settingsUsersPage(
  store: DevelopmentStore,
  directory: UserDirectory,
  filters: DevelopmentDirectoryFilters,
  demo = false,
  allowedUids: readonly string[] = [],
) {
  const page = await listDirectoryRows(store, directory, filters, demo, allowedUids);
  return {
    ...page,
    items: page.items.map(({ user, roles, tags, grant }) =>
      identitySnapshot(user, roles, tags, grant ? [grant] : [], demo, allowedUids),
    ),
  };
}
export async function listSettingsUsers(
  store: DevelopmentStore,
  directory: UserDirectory,
  query = '',
  demo = false,
  allowedUids: readonly string[] = [],
) {
  const [users, roles, tags, access] = await Promise.all([
    directory.list(query),
    store.roleAssignments.list(),
    store.tagAssignments.list({ tagKey: 'sports.team_captain' }),
    store.developmentAccess.list(),
  ]);
  const ownedRoles = groupedByUid(roles),
    ownedTags = groupedByUid(tags),
    grantFor = accessLookup(access);
  return users.map((user) => {
    const grant = grantFor(user);
    return identitySnapshot(
      user,
      ownedRoles.get(user.uid) ?? [],
      ownedTags.get(user.uid) ?? [],
      grant ? [grant] : [],
      demo,
      allowedUids,
    );
  });
}
export async function updateSettingsUser(
  store: DevelopmentStore,
  directory: UserDirectory,
  uid: string,
  input: SystemSettingsUserInput,
  actorUid: string,
  allowedUids: readonly string[] = [],
) {
  const target = await directory.get(uid);
  if (!target) throw new HttpError(404, 'user_not_found', 'Main-site user was not found');
  const validation = validateIdentitySelection(input.roles);
  if (!validation.ok) throw new HttpError(400, 'identity_group_conflict', validation.message);
  const initialRoles = await store.roleAssignments.list({ subjectUid: uid });
  const changesAdmin =
    input.roles.includes('platform.admin') ||
    initialRoles.some((row) => row.roleKey === 'platform.admin' && current(row));
  return store.transaction(async (tx) => {
    // Stable definition row serializes last-administrator decisions, including access edits.
    // Lock it before identity rows so every administration writer has the same order.
    if (changesAdmin) await tx.roles.listForUpdate({ key: 'platform.admin' });
    const definitions = changesAdmin ? await tx.roles.list() : [];
    const adminRoles = changesAdmin
      ? await tx.roleAssignments.listForUpdate({ roleKey: 'platform.admin' })
      : [];
    const targetRoles = await tx.roleAssignments.listForUpdate({ subjectUid: uid });
    const roles = [
      ...new Map([...adminRoles, ...targetRoles].map((row) => [row.id, row])).values(),
    ];
    const [tags, teams, access, subjects] = await Promise.all([
      tx.tagAssignments.listForUpdate({ subjectUid: uid }),
      tx.sportsTeams.listForUpdate({ ids: input.captainTeamIds }),
      tx.developmentAccess.list(),
      tx.subjects.listForUpdate({
        uids: [...new Set([uid, ...adminRoles.map((row) => row.subjectUid)])],
      }),
    ]);
    const previous = identitySnapshot(target, roles, tags, access, false, allowedUids);
    if (previous.revision !== input.revision)
      throw new HttpError(409, 'stale_revision', '用户身份已被修改，请重新加载');
    if (
      input.captainTeamIds.some(
        (id) => !teams.some((team) => team.id === id && team.status === 'active'),
      )
    )
      throw new HttpError(400, 'invalid_sports_team', '代表队不存在或不可用');
    const identities = await businessAdminIdentities(roles, directory);
    const admins = effectiveGlobalBusinessAdmins(
      roles,
      definitions,
      subjects,
      access,
      new Date(),
      identities,
      allowedUids,
    );
    const losingAdmin = admins.has(uid) && !input.roles.includes('platform.admin');
    if (losingAdmin && admins.size === 1) {
      throw new HttpError(409, 'last_platform_admin', '至少保留一位可访问发展端的平台管理员');
    }
    await synchronizeSubject(tx, directoryUserContext(target), new Date());
    const existing = roles.filter(
      (row) =>
        row.subjectUid === uid &&
        row.roleKey !== 'platform.super_admin' &&
        editableBusinessIdentity(row),
    );
    const desired = new Set(input.roles);
    for (const row of existing) {
      const wanted = desired.has(row.roleKey as SystemSettingsUser['roles'][number]);
      if (!wanted && current(row)) await tx.roleAssignments.update(row.id, { status: 'archived' });
    }
    for (const roleKey of desired) {
      // A checked role represents existing current grants, not authority to
      // restore every historical scope or replace a future expiry with null.
      if (previous.roles.includes(roleKey)) continue;
      const canonical = existing.find(
        (row) =>
          row.roleKey === roleKey && row.scope.type === scope.type && row.scope.id === scope.id,
      );
      if (canonical) {
        await tx.roleAssignments.update(canonical.id, {
          status: 'active',
          expiresAt: null,
          ownerUid: actorUid,
        });
      } else {
        await tx.roleAssignments.create({
          subjectUid: uid,
          roleKey,
          expiresAt: null,
          status: 'active',
          ownerUid: actorUid,
          scope,
        });
      }
    }
    const captainTags = tags.filter(
      (row) => row.subjectUid === uid && row.tagKey === 'sports.team_captain',
    );
    for (const row of captainTags) {
      const wanted =
        row.scope.type === 'sports_team' && input.captainTeamIds.includes(row.scope.id);
      if (!wanted && current(row)) await tx.tagAssignments.update(row.id, { status: 'archived' });
    }
    for (const id of input.captainTeamIds) {
      if (previous.captainTeamIds.includes(id)) continue;
      const canonical = captainTags.find(
        (row) => row.scope.type === 'sports_team' && row.scope.id === id,
      );
      if (canonical) {
        await tx.tagAssignments.update(canonical.id, {
          status: 'active',
          expiresAt: null,
          ownerUid: actorUid,
        });
      } else {
        await tx.tagAssignments.create({
          subjectUid: uid,
          tagKey: 'sports.team_captain',
          expiresAt: null,
          status: 'active',
          ownerUid: actorUid,
          scope: { type: 'sports_team', id },
        });
      }
    }
    const next = identitySnapshot(
      target,
      await tx.roleAssignments.list({ subjectUid: uid }),
      await tx.tagAssignments.list({ subjectUid: uid }),
      access,
      false,
      allowedUids,
    );
    await tx.auditLogs.create({
      actorUid,
      action: 'system_settings.user.update',
      resourceType: 'development_user',
      resourceId: uid,
      details: { previous, next },
      status: 'active',
      ownerUid: actorUid,
      scope,
    });
    return next;
  });
}
