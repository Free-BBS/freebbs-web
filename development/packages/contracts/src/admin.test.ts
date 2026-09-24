import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  AdminAuditLog,
  AdminModuleOwner,
  AdminPermissionBinding,
  AdminRole,
  AdminRoleAssignment,
  AdminSubject,
  AdminSystemStatus,
  AdminTagAssignment,
  AdminTagDefinition,
  Page,
  ReplaceModuleOwnersInput,
  ReplacePermissionBindingsInput,
  RoleStatusPatch,
} from './admin.js';

describe('admin governance contracts', () => {
  it('models paged subjects and assignments with scope and expiry', () => {
    const subject: AdminSubject = {
      id: 'subject-1',
      uid: 'uid-001',
      displayName: '治理员',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'uid-001',
      scope: { type: 'public', id: '*' },
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    };
    const roleAssignment: AdminRoleAssignment = {
      ...subject,
      id: 'role-assignment-1',
      subjectUid: subject.uid,
      roleKey: 'platform.super_admin',
      expiresAt: null,
    };
    const tagAssignment: AdminTagAssignment = {
      ...subject,
      id: 'tag-assignment-1',
      subjectUid: subject.uid,
      tagKey: 'sports.team_captain',
      scope: { type: 'sports_team', id: 'team-1' },
      expiresAt: '2027-07-27T00:00:00.000Z',
    };
    const page: Page<AdminSubject> = {
      items: [subject],
      page: 1,
      pageSize: 20,
      total: 1,
    };

    expect(page.items[0]?.uid).toBe('uid-001');
    expect(roleAssignment.scope).toEqual({ type: 'public', id: '*' });
    expect(tagAssignment.expiresAt).toBe('2027-07-27T00:00:00.000Z');
  });

  it('covers every replace, status, audit, and system response shape', () => {
    const binding: AdminPermissionBinding = {
      id: 'binding-1',
      roleKey: 'platform.super_admin',
      action: 'admin.manage',
      resource: 'admin',
      effect: 'allow',
      status: 'active',
      ownerUid: 'uid-001',
      scope: { type: 'public', id: '*' },
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    };
    const role: AdminRole = {
      ...binding,
      id: 'role-1',
      key: 'platform.super_admin',
      name: '平台最高管理员',
    };
    const tag: AdminTagDefinition = {
      ...binding,
      id: 'tag-1',
      key: 'sports.team_captain',
      name: '队长',
      description: '代表队队长',
      requiredScopeType: 'sports_team',
      metadata: {},
    };
    const permissionInput: ReplacePermissionBindingsInput = {
      bindings: [
        {
          action: binding.action,
          resource: binding.resource,
          effect: binding.effect,
          scope: binding.scope,
        },
      ],
    };
    const owner: AdminModuleOwner = {
      ...binding,
      id: 'owner-1',
      moduleId: 'sports',
      ownerType: 'team',
      ownerId: 'team-1',
    };
    const ownerInput: ReplaceModuleOwnersInput = {
      owners: [{ ownerType: owner.ownerType, ownerId: owner.ownerId }],
    };
    const audit: AdminAuditLog = {
      ...binding,
      id: 'audit-1',
      actorUid: 'uid-001',
      action: 'admin.module_owners.replace',
      resourceType: 'module',
      resourceId: 'sports',
      details: { count: 1 },
    };
    const status: AdminSystemStatus = {
      version: 'b28b98f',
      dataMode: 'mysql',
      appliedMigrationCount: 4,
      moduleCounts: { total: 9, enabled: 8, disabled: 1 },
    };
    const rolePatch: RoleStatusPatch = { status: 'inactive' };

    expect(permissionInput.bindings).toHaveLength(1);
    expect(ownerInput.owners).toEqual([{ ownerType: 'team', ownerId: 'team-1' }]);
    expect(audit.details).toEqual({ count: 1 });
    expect(status.moduleCounts.total).toBe(9);
    expect(rolePatch.status).toBe('inactive');
    expect(tag.key).toBe('sports.team_captain');
    expect(role.key).toBe('platform.super_admin');
    expectTypeOf<Page<AdminAuditLog>['items']>().toEqualTypeOf<AdminAuditLog[]>();
  });
});
