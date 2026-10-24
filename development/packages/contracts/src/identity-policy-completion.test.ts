import { describe, expect, it } from 'vitest';
import { ROLE_KEYS } from './modules.js';
import * as organizations from './organizations.js';
import { canEditDepartment, departmentsForRoles } from './departments.js';
import { validateIdentitySelection } from './development-identities.js';

describe('completed organization identity policy', () => {
  it('maps all 81 keys to canonical membership or an explicit nonmembership category', () => {
    expect(ROLE_KEYS).toHaveLength(81);
    for (const role of ROLE_KEYS) {
      const memberships = organizations.organizationMembershipsForRole(role);
      if (role.startsWith('platform.') || role.startsWith('counselor.')) {
        expect(memberships, role).toEqual([]);
      } else {
        expect(memberships.length, role).toBeGreaterThan(0);
        expect(
          memberships.every(({ organizationId }) =>
            organizations.SOCIAL_ORGANIZATION_IDS.includes(organizationId),
          ),
          role,
        ).toBe(true);
      }
    }
    expect(organizations.organizationMembershipsForRole('student_union.presidium')).toHaveLength(4);
    expect(organizations.organizationMembershipsForRole('media_center.audiovisual.member')).toEqual(
      [{ organizationId: 'media_center', level: 'member' }],
    );
    expect(
      organizations.organizationMembershipsForRoles([
        'science_association.software.member',
        'science_association.chair',
      ]),
    ).toEqual([{ organizationId: 'sast', level: 'lead' }]);
  });
  it('supervises approved departments without turning counselors into organization members', () => {
    for (const role of ['student_union.executive_president', 'student_union.presidium'] as const)
      expect(departmentsForRoles([role])).toHaveLength(4);
    expect(departmentsForRoles(['science_association.chair'])).toHaveLength(5);
    expect(departmentsForRoles(['counselor.practice']).map(({ id }) => id)).toEqual([
      'youth_league.practice',
    ]);
    expect(departmentsForRoles(['counselor.innovation'])).toHaveLength(5);
    expect(departmentsForRoles(['counselor.student_development']).map(({ id }) => id)).toEqual([
      'youth_league.freshman',
      'youth_league.sail',
    ]);
    expect(
      canEditDepartment(
        { roles: ['counselor.youth_league'], businessAdmin: false },
        'media_center.creative',
      ),
    ).toBe(true);
    expect(canEditDepartment({ roles: ['counselor.practice'] }, 'youth_league.organization')).toBe(
      false,
    );
  });
  it('enforces one ordinary position per major organization including legacy aliases', () => {
    for (const roles of [
      ['domain.arts_lead', 'department.sports_member'],
      ['student_union.presidium', 'department.arts_member'],
      ['science_association.chair', 'science_association.software.member'],
      ['affiliation.sast_member', 'science_association.hardware.member'],
      ['affiliation.tuanwei_director', 'youth_league.practice.member'],
      ['youth_league.organization.member', 'youth_league.sail.student'],
      ['media_center.creative.member', 'media_center.audiovisual.member'],
    ] as const)
      expect(validateIdentitySelection(roles), roles.join(',')).toMatchObject({ ok: false });
    expect(
      validateIdentitySelection([
        'domain.arts_lead',
        'youth_league.practice.member',
        'student_union.finance',
        'youth_league.finance',
        'media_center.finance',
        'platform.admin',
      ]),
    ).toEqual({ ok: true });
  });
});
