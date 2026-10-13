import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UserContext } from '@freebbs-development/contracts';
import { Can, hasPresentationPermission, isBusinessAdmin, isSuperAdmin } from './Can.js';

const member: UserContext = {
  uid: 'u',
  displayName: '同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};

describe('development business presentation boundaries', () => {
  it('requires a trusted global assignment instead of a flattened administrator role', () => {
    const scoped = { ...member, roles: ['platform.admin' as const], businessAdmin: false };
    expect(isBusinessAdmin(scoped)).toBe(false);
    expect(hasPresentationPermission(scoped, 'finance.record.create')).toBe(false);
    expect(isBusinessAdmin({ ...member, roles: ['platform.admin'] })).toBe(false);
    render(
      <Can user={scoped} permission="finance.record.create">
        全局业务编辑
      </Can>,
    );
    expect(screen.queryByText('全局业务编辑')).not.toBeInTheDocument();
  });
  it('does not present reserved authority from a stale real-user role', () => {
    const stale = {
      ...member,
      roles: ['platform.super_admin' as const],
      developmentAccess: 'member' as const,
      viewer: { uid: 'u', displayName: '同学', canManageDevelopment: false },
    };
    expect(isSuperAdmin(stale)).toBe(false);
    expect(hasPresentationPermission(stale, 'admin.manage')).toBe(false);
    render(
      <Can user={stale} role="platform.super_admin">
        负责人设置
      </Can>,
    );
    expect(screen.queryByText('负责人设置')).not.toBeInTheDocument();
  });
  it('does not give lead-only identities business permissions', () => {
    const lead = {
      ...member,
      roles: ['platform.super_admin' as const],
      policies: [{ action: '*' }],
    };
    expect(hasPresentationPermission(lead, 'finance.record.write')).toBe(false);
    render(
      <Can user={lead} role="department.arts_member">
        业务编辑
      </Can>,
    );
    expect(screen.queryByText('业务编辑')).not.toBeInTheDocument();
  });
  it('gives platform administrators business permissions without reserved administration', () => {
    const admin = {
      ...member,
      roles: ['platform.admin' as const],
      businessAdmin: true,
      policies: [{ action: '*' }],
    };
    expect(hasPresentationPermission(admin, 'finance.record.write')).toBe(true);
    expect(hasPresentationPermission(admin, 'admin.manage')).toBe(false);
    render(
      <Can user={admin} role="department.arts_member">
        业务编辑
      </Can>,
    );
    expect(screen.getByText('业务编辑')).toBeInTheDocument();
  });
});
