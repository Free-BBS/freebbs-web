import type { UserContext } from '@freebbs-development/contracts';
import type {
  DevelopmentAccessRecord,
  DevelopmentStore,
  RoleAssignmentRecord,
} from '../database/types.js';
import { HttpError } from '../errors/http-error.js';

const publicScope = { type: 'public', id: '*' } as const;

function sameIdentity(record: DevelopmentAccessRecord, identity: UserContext): boolean {
  if (record.status !== 'active') return false;
  if (record.subjectUid) return record.subjectUid === identity.uid;
  if (record.studentId)
    return Boolean(identity.studentId && record.studentId === identity.studentId);
  return Boolean(
    record.username &&
    identity.username &&
    record.username.toLocaleLowerCase() === identity.username.toLocaleLowerCase(),
  );
}

export async function hasConfiguredDevelopmentLead(store: DevelopmentStore): Promise<boolean> {
  return (await store.developmentAccess.list()).some(
    (record) =>
      record.status === 'active' &&
      record.accessLevel === 'lead' &&
      record.ownerUid.trim().length > 0 &&
      record.ownerUid !== 'system',
  );
}

export async function ensureDevelopmentLeadAssignment(
  store: DevelopmentStore,
  identity: UserContext,
  grant: DevelopmentAccessRecord,
): Promise<void> {
  if (grant.accessLevel !== 'lead') return;
  const existing = (await store.roleAssignments.list({ query: identity.uid })).find(
    (assignment) =>
      assignment.subjectUid === identity.uid &&
      assignment.roleKey === 'platform.super_admin' &&
      assignment.scope.type === 'public' &&
      assignment.scope.id === '*',
  );
  if (existing) {
    if (existing.status !== 'active' || existing.expiresAt !== null) {
      await store.roleAssignments.update(existing.id, { status: 'active', expiresAt: null });
    }
    return;
  }
  await store.roleAssignments.create({
    subjectUid: identity.uid,
    roleKey: 'platform.super_admin',
    expiresAt: null,
    status: 'active',
    ownerUid: grant.ownerUid || identity.uid,
    scope: publicScope,
  });
}

export async function resolveDevelopmentAccess(
  store: DevelopmentStore,
  identity: UserContext,
): Promise<DevelopmentAccessRecord | null> {
  const grant = (await store.developmentAccess.list()).find((candidate) =>
    sameIdentity(candidate, identity),
  );
  if (!grant) return null;
  if (!grant.subjectUid) {
    await store.developmentAccess.update(grant.id, {
      subjectUid: identity.uid,
      username: identity.username ?? grant.username,
    });
  }
  return { ...grant, subjectUid: identity.uid };
}

async function applyDevelopmentAccess(
  store: DevelopmentStore,
  input: {
    user: Pick<UserContext, 'uid' | 'username' | 'studentId'>;
    accessLevel: 'member' | 'lead' | null;
    actorUid: string;
  },
): Promise<DevelopmentAccessRecord | null> {
  const all = await store.developmentAccess.listForUpdate();
  const existing = all.find(
    (record) =>
      record.subjectUid === input.user.uid ||
      (input.user.studentId !== null && record.studentId === input.user.studentId),
  );
  if (input.accessLevel === null) {
    if (!existing || existing.status !== 'active') return null;
    if (existing.accessLevel === 'lead') {
      const otherLead = all.some(
        (record) =>
          record.id !== existing.id && record.status === 'active' && record.accessLevel === 'lead',
      );
      if (!otherLead) {
        throw new HttpError(409, 'last_development_lead', '至少保留一位发展端负责人');
      }
    }
    await store.developmentAccess.update(existing.id, { status: 'archived' });
    const superAdmin = (
      await store.roleAssignments.listForUpdate({
        query: input.user.uid,
      })
    ).find(
      (assignment) =>
        assignment.subjectUid === input.user.uid &&
        assignment.roleKey === 'platform.super_admin' &&
        assignment.status === 'active',
    );
    if (superAdmin) await store.roleAssignments.update(superAdmin.id, { status: 'archived' });
    return null;
  }

  const record = existing
    ? await store.developmentAccess.update(existing.id, {
        subjectUid: input.user.uid,
        studentId: input.user.studentId ?? null,
        username: input.user.username ?? null,
        accessLevel: input.accessLevel,
        status: 'active',
        ownerUid: input.actorUid,
      })
    : await store.developmentAccess.create({
        subjectUid: input.user.uid,
        studentId: input.user.studentId ?? null,
        username: input.user.username ?? null,
        accessLevel: input.accessLevel,
        status: 'active',
        ownerUid: input.actorUid,
        scope: publicScope,
      });
  if (!record) throw new Error('发展端白名单更新失败');

  if (input.accessLevel === 'lead')
    await ensureDevelopmentLeadAssignment(
      store,
      {
        uid: input.user.uid,
        username: input.user.username,
        studentId: input.user.studentId,
        displayName: input.user.username ?? input.user.uid,
        avatarUrl: null,
        baseRole: 'student',
        roles: [],
        tags: [],
      },
      record,
    );
  else {
    const assignments = await store.roleAssignments.listForUpdate({ query: input.user.uid });
    for (const assignment of assignments.filter(
      (candidate: RoleAssignmentRecord) =>
        candidate.subjectUid === input.user.uid &&
        candidate.roleKey === 'platform.super_admin' &&
        candidate.status === 'active',
    )) {
      await store.roleAssignments.update(assignment.id, { status: 'archived' });
    }
  }
  return record;
}

export async function upsertDevelopmentAccessInTransaction(
  store: DevelopmentStore,
  input: Parameters<typeof applyDevelopmentAccess>[1],
): Promise<DevelopmentAccessRecord | null> {
  return applyDevelopmentAccess(store, input);
}

export async function upsertDevelopmentAccess(
  store: DevelopmentStore,
  input: Parameters<typeof applyDevelopmentAccess>[1],
): Promise<DevelopmentAccessRecord | null> {
  return store.transaction((transactionStore) => applyDevelopmentAccess(transactionStore, input));
}
