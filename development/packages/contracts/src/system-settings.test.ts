import { describe, expect, it } from 'vitest';
import {
  canEditDepartment,
  canReviewFestival,
  isDevelopmentBusinessAdmin,
  isDevelopmentLead,
} from './index.js';
import * as contracts from './index.js';
describe('separate development authority', () => {
  it('keeps lead authority separate from global business authority', () => {
    expect(isDevelopmentBusinessAdmin({ roles: ['platform.super_admin'] })).toBe(false);
    expect(isDevelopmentBusinessAdmin({ roles: ['platform.admin'], businessAdmin: true })).toBe(
      true,
    );
    expect(isDevelopmentBusinessAdmin({ roles: ['platform.admin'] })).toBe(false);
    expect(isDevelopmentBusinessAdmin({ roles: ['platform.admin'], businessAdmin: false })).toBe(
      false,
    );
    expect(isDevelopmentBusinessAdmin({ roles: [], businessAdmin: true })).toBe(false);
    expect(canReviewFestival({ roles: ['platform.admin'] })).toBe(false);
    expect(isDevelopmentLead(['platform.admin'])).toBe(false);
    expect(isDevelopmentLead(['platform.super_admin'])).toBe(true);
    expect(
      canEditDepartment(
        { roles: ['platform.admin'], businessAdmin: true },
        'student_union.arts_center',
      ),
    ).toBe(true);
    expect(
      canEditDepartment({ roles: ['platform.super_admin'] }, 'student_union.arts_center'),
    ).toBe(false);
    expect(canReviewFestival({ roles: ['platform.admin'], businessAdmin: true })).toBe(true);
    expect(canReviewFestival({ roles: ['platform.super_admin'] })).toBe(false);
    expect(canReviewFestival({ roles: ['department.arts_member'] })).toBe(true);
  });
  it('requires trusted original lead qualification for main-mode reserved entry and denies missing qualification metadata', () => {
    const authority = contracts as typeof contracts & {
      canManageDevelopmentAccess: (
        user: Pick<contracts.UserContext, 'roles' | 'viewer' | 'developmentAccess' | 'previewing'>,
      ) => boolean;
    };
    expect(authority.canManageDevelopmentAccess).toBeTypeOf('function');
    expect(
      authority.canManageDevelopmentAccess({
        roles: ['platform.super_admin'],
        viewer: { uid: 'original', displayName: 'Original', canManageDevelopment: false },
        developmentAccess: 'member',
      }),
    ).toBe(false);
    expect(
      authority.canManageDevelopmentAccess({
        roles: ['platform.super_admin'],
        viewer: { uid: 'original', displayName: 'Original', canManageDevelopment: true },
        developmentAccess: 'lead',
      }),
    ).toBe(true);
    expect(
      authority.canManageDevelopmentAccess({
        roles: ['platform.super_admin'],
        developmentAccess: 'member',
      }),
    ).toBe(false);
    expect(
      authority.canManageDevelopmentAccess({
        roles: ['platform.super_admin'],
        viewer: { uid: 'original', displayName: 'Original', canManageDevelopment: true },
        developmentAccess: 'member',
      }),
    ).toBe(false);
    expect(authority.canManageDevelopmentAccess({ roles: ['platform.super_admin'] })).toBe(false);
    expect(authority.canManageDevelopmentAccess({ roles: ['platform.admin'] })).toBe(false);
    expect(
      authority.canManageDevelopmentAccess({ roles: ['platform.super_admin'], previewing: true }),
    ).toBe(false);
  });
  it('applies metadata consistently to identity hierarchy and captions while retaining unconfigured defaults', () => {
    const display = contracts as typeof contracts & {
      systemSettingsIdentitySections: (
        metadata: contracts.SystemSettingsOrganizations,
      ) => readonly contracts.DevelopmentIdentitySection[];
      systemSettingsIdentityLabels: (
        roles: readonly contracts.RoleKey[],
        metadata: contracts.SystemSettingsOrganizations,
      ) => string[];
    };
    expect(display.systemSettingsIdentitySections).toBeTypeOf('function');
    expect(display.systemSettingsIdentityLabels).toBeTypeOf('function');
    const defaults: contracts.SystemSettingsOrganizations = {
      revision: 0,
      organizations: contracts.SOCIAL_ORGANIZATIONS.map((org) => ({
        id: org.id,
        name: org.name,
        description: '',
      })),
      roles: [
        { key: 'department.arts_member', name: '文艺中心部员' },
        { key: 'platform.admin', name: '平台管理员' },
      ],
    };
    expect(display.systemSettingsIdentitySections(defaults)).toEqual(
      contracts.DEVELOPMENT_IDENTITY_SECTIONS,
    );
    expect(
      display.systemSettingsIdentityLabels(['department.arts_member', 'platform.admin'], defaults),
    ).toEqual(['发展端管理员', '文艺中心部员']);
    const renamed: contracts.SystemSettingsOrganizations = {
      ...defaults,
      revision: 1,
      organizations: defaults.organizations.map((org) =>
        org.id === 'arts_center' ? { ...org, name: '新文艺组织' } : org,
      ),
      roles: [
        { key: 'department.arts_member', name: '艺术协调员' },
        { key: 'platform.admin', name: '业务管理员' },
      ],
    };
    const sections = display.systemSettingsIdentitySections(renamed);
    const group = sections
      .find((section) => section.id === 'student_union')!
      .groups.find((group) => group.id === 'student_union.arts_center')!;
    expect(group.label).toBe('新文艺组织');
    expect(group.options.find((option) => option.roleKey === 'department.arts_member')!.label).toBe(
      '艺术协调员',
    );
    expect(
      display.systemSettingsIdentityLabels(['department.arts_member', 'platform.admin'], renamed),
    ).toEqual(['业务管理员', '艺术协调员']);
    expect(display.systemSettingsIdentityLabels(['department.arts_director'], renamed)).toEqual([
      '新文艺组织主任',
    ]);
  });
  it('upgrades former default department names while retaining explicit custom names', () => {
    const metadata: contracts.SystemSettingsOrganizations = {
      revision: 0,
      organizations: [],
      roles: [
        { key: 'youth_league.freshman.leader', name: '新生组组长' },
        { key: 'science_association.training.minister', name: '学培部部长' },
        { key: 'science_association.planning.member', name: '策划部部员' },
        { key: 'science_association.office.vice_chair', name: '办公室副主席' },
      ],
    };
    expect(
      contracts.systemSettingsIdentityLabels(
        metadata.roles.map((row) => row.key),
        metadata,
      ),
    ).toEqual(['办公室·新生组组长', '学习培养部部长', '智能策划部部员', '科协经费负责人']);
  });
});
