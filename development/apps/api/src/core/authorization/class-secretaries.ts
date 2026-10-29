import { createHash } from 'node:crypto';
import {
  CLASS_SECRETARY_TAG,
  canGrantClassSecretaries,
  secretaryClassIds,
  type ClassSecretaryUpdate,
  type ClassSecretaryUser,
  type OrganizationGroupClass,
  type UserContext,
} from '@freebbs-development/contracts';
import { recordAuditEvent } from '../audit/audit-service.js';
import type { DirectoryUser, UserDirectory } from '../auth/user-directory.js';
import type { DevelopmentStore, TagAssignmentRecord } from '../database/types.js';
import { HttpError } from '../errors/http-error.js';

function currentRows(rows: readonly TagAssignmentRecord[], uid: string) {
  return rows.filter((row) => row.subjectUid === uid && row.tagKey === CLASS_SECRETARY_TAG);
}
export function classSecretaryDto(
  user: DirectoryUser,
  rows: readonly TagAssignmentRecord[],
): ClassSecretaryUser {
  const selected = currentRows(rows, user.uid).sort((a, b) => a.id.localeCompare(b.id));
  const revision = createHash('sha256')
    .update(
      JSON.stringify(
        selected.map((row) => ({
          id: row.id,
          status: row.status,
          scope: row.scope,
          expiresAt: row.expiresAt,
          updatedAt: row.updatedAt,
        })),
      ),
    )
    .digest('hex');
  return {
    uid: user.uid,
    username: user.username,
    displayName: user.displayName,
    studentId: user.studentId,
    revision,
    classIds: secretaryClassIds({
      tags: selected
        .filter((row) => row.status === 'active')
        .map((row) => ({
          key: row.tagKey,
          scope: row.scope,
          expiresAt: row.expiresAt,
        })),
    }),
  };
}
export function requireClassSecretaryAuthority(actor: UserContext) {
  if (!canGrantClassSecretaries(actor))
    throw new HttpError(
      403,
      'class_secretary_forbidden',
      '仅发展端管理员和组织组同学可以授权班级团支书',
    );
}

export async function updateClassSecretary(options: {
  store: DevelopmentStore;
  directory: UserDirectory;
  actor: UserContext;
  uid: string;
  input: ClassSecretaryUpdate;
  classes: readonly OrganizationGroupClass[];
}): Promise<ClassSecretaryUser> {
  const { store, directory, actor, uid, input, classes } = options;
  requireClassSecretaryAuthority(actor);
  const target = await directory.get(uid);
  if (!target || target.uid !== uid)
    throw new HttpError(404, 'user_not_found', '未找到该用户，请先确认同学已注册');
  if (
    new Set(input.classIds).size !== input.classIds.length ||
    input.classIds.some((id) => !classes.some((item) => item.id === id))
  ) {
    throw new HttpError(400, 'invalid_class', '请从已配置的班级中选择，不得重复');
  }
  return store.transaction(async (tx) => {
    requireClassSecretaryAuthority(actor);
    // A canonical definition-row lock also serializes first grants with no existing assignment.
    const definition = (await tx.tagDefinitions.listForUpdate({ key: CLASS_SECRETARY_TAG })).find(
      (row) => row.key === CLASS_SECRETARY_TAG,
    );
    if (!definition || definition.status !== 'active' || definition.requiredScopeType !== 'class') {
      throw new HttpError(409, 'class_secretary_unavailable', '班级团支书身份当前未启用');
    }
    requireClassSecretaryAuthority(actor);
    const rows = currentRows(await tx.tagAssignments.listForUpdate({ subjectUid: uid }), uid);
    const before = classSecretaryDto(target, rows);
    if (before.revision !== input.revision)
      throw new HttpError(409, 'revision_conflict', '授权已被其他同学更新，请重新加载后再保存');
    const subject = (await tx.subjects.listForUpdate({ query: uid })).find(
      (row) => row.uid === uid,
    );
    if (subject && subject.status !== 'active' && subject.status !== 'pending')
      throw new HttpError(409, 'subject_inactive', '该用户当前不可授权');
    if (!subject)
      await tx.subjects.create({
        uid,
        displayName: target.displayName,
        avatarUrl: target.avatarUrl,
        status: 'active',
        ownerUid: uid,
        scope: { type: 'public', id: '*' },
      });
    const desired = new Set(input.classIds);
    const retained = new Set<string>();
    for (const row of rows) {
      const classId = row.scope.type === 'class' ? row.scope.id : '';
      if (desired.has(classId) && !retained.has(classId)) {
        retained.add(classId);
        if (row.status !== 'active' || row.expiresAt !== null)
          await tx.tagAssignments.update(row.id, {
            status: 'active',
            expiresAt: null,
            ownerUid: actor.uid,
          });
      } else if (row.status === 'active')
        await tx.tagAssignments.update(row.id, { status: 'archived', ownerUid: actor.uid });
    }
    for (const classId of desired)
      if (!retained.has(classId))
        await tx.tagAssignments.create({
          subjectUid: uid,
          tagKey: CLASS_SECRETARY_TAG,
          expiresAt: null,
          status: 'active',
          ownerUid: actor.uid,
          scope: { type: 'class', id: classId },
        });
    const after = classSecretaryDto(target, await tx.tagAssignments.list({ subjectUid: uid }));
    await recordAuditEvent(tx, {
      actorUid: actor.uid,
      action: 'organization_group.class_secretary.update',
      resourceType: 'class_secretary',
      resourceId: uid,
      details: { subjectUid: uid, beforeClassIds: before.classIds, classIds: after.classIds },
    });
    requireClassSecretaryAuthority(actor);
    return after;
  });
}
