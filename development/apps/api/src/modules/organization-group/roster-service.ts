import { randomUUID } from 'node:crypto';
import { canGrantClassSecretaries } from '@freebbs-development/contracts';
import type {
  OrganizationGroupClassRoster,
  OrganizationGroupRosterHistory,
  OrganizationGroupRosterImport,
  OrganizationGroupRosterSnapshot,
  UserContext,
} from '@freebbs-development/contracts';
import {
  audit,
  fail,
  manages,
  now,
  revision,
  submitClasses,
  viewsAll,
  type OrganizationState,
} from './domain.js';

type StoredRoster = NonNullable<OrganizationState['classRosters']>[number];
type Batch = OrganizationGroupRosterImport['batches'][number];

export function canImportRosters(state: OrganizationState, user: UserContext): boolean {
  return !user.previewing && (manages(state, user) || canGrantClassSecretaries(user));
}

function configuredClass(state: OrganizationState, classId: string) {
  if (!state.classes.some((row) => row.id === classId))
    fail(404, 'class_not_found', '未找到已配置的班级');
}

function requireRead(state: OrganizationState, user: UserContext, classId: string) {
  if (!viewsAll(state, user) && !submitClasses(state, user).includes(classId))
    fail(403, 'roster_forbidden', '当前无权查看该班级名单');
  configuredClass(state, classId);
}

function requireWrite(state: OrganizationState, user: UserContext, classId: string) {
  if (
    user.previewing ||
    (!canImportRosters(state, user) && !submitClasses(state, user).includes(classId))
  )
    fail(403, 'roster_forbidden', '当前无权维护该班级名单');
  configuredClass(state, classId);
}

function copySnapshot(snapshot: OrganizationGroupRosterSnapshot): OrganizationGroupRosterSnapshot {
  return { ...snapshot, members: snapshot.members.map((member) => ({ ...member })) };
}

export function classRoster(
  state: OrganizationState,
  user: UserContext,
  classId: string,
): OrganizationGroupClassRoster {
  requireRead(state, user, classId);
  const stored = state.classRosters?.find((row) => row.classId === classId);
  const canImport = canImportRosters(state, user);
  return {
    classId,
    revision: stored?.revision ?? 0,
    members: stored?.members.map((member) => ({ ...member })) ?? [],
    updatedAt: stored?.updatedAt ?? null,
    canEdit: !user.previewing && (canImport || submitClasses(state, user).includes(classId)),
    canImport,
  };
}

export function classRosterHistory(
  state: OrganizationState,
  user: UserContext,
  classId: string,
): OrganizationGroupRosterHistory {
  requireRead(state, user, classId);
  return {
    classId,
    items:
      state.classRosters?.find((row) => row.classId === classId)?.history.map(copySnapshot) ?? [],
  };
}

/** All batches are planned before mutation and committed by the existing workspace lock. */
export function replaceClassRosters(
  state: OrganizationState,
  user: UserContext,
  batches: OrganizationGroupRosterImport['batches'],
  importing = false,
): OrganizationGroupClassRoster[] {
  if (importing && !canImportRosters(state, user))
    fail(403, 'roster_import_forbidden', '只有已授权管理者或组织组同学可以批量导入');
  if (new Set(batches.map((batch) => batch.classId)).size !== batches.length)
    fail(400, 'duplicate_class', '一次导入不能重复指定同一班级');
  if (batches.reduce((count, batch) => count + batch.members.length, 0) > 20000)
    fail(400, 'roster_too_large', '一次导入最多包含 20000 条成员记录');

  const owners = new Map<string, string>();
  for (const roster of state.classRosters ?? [])
    for (const snapshot of [...roster.history, roster])
      for (const member of snapshot.members) owners.set(member.id, roster.classId);

  const plans = batches.map((batch: Batch): StoredRoster => {
    requireWrite(state, user, batch.classId);
    const previous = state.classRosters?.find((row) => row.classId === batch.classId);
    revision(previous?.revision ?? 0, batch.revision);
    const ids = new Set<string>();
    const studentIds = new Set<string>();
    const members = batch.members.map((input) => {
      const id = input.id ?? randomUUID();
      if (ids.has(id)) fail(400, 'duplicate_member', '同一名单的成员 ID 不能重复');
      ids.add(id);
      if (owners.has(id) && owners.get(id) !== batch.classId)
        fail(400, 'member_class_mismatch', '成员 ID 不能跨班级复用');
      owners.set(id, batch.classId);
      const studentId = input.studentId?.trim();
      if (studentId && studentIds.has(studentId))
        fail(400, 'duplicate_student_id', '同一名单的学号不能重复');
      if (studentId) studentIds.add(studentId);
      return { id, displayName: input.displayName.trim(), ...(studentId ? { studentId } : {}) };
    });
    const snapshot: OrganizationGroupRosterSnapshot = {
      revision: (previous?.revision ?? 0) + 1,
      members,
      updatedAt: now(),
    };
    return {
      ...snapshot,
      classId: batch.classId,
      history: [...(previous?.history ?? []), copySnapshot(snapshot)],
    };
  });

  // Recheck expiry-sensitive grants immediately before applying the planned transaction.
  for (const batch of batches) requireWrite(state, user, batch.classId);
  state.classRosters ??= [];
  for (const next of plans) {
    const index = state.classRosters.findIndex((row) => row.classId === next.classId);
    if (index < 0) state.classRosters.push(next);
    else state.classRosters[index] = next;
    audit(
      state,
      user,
      importing ? 'class_roster_imported' : 'class_roster_updated',
      next.classId,
      next.revision,
    );
  }
  return plans.map((row) => classRoster(state, user, row.classId));
}
