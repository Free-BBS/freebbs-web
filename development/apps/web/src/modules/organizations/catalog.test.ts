import { describe, expect, it } from 'vitest';
import { ORGANIZATION_GALLERY, organizationRegistrationPath, findOrganization } from './catalog.js';

describe('organization exhibition catalog', () => {
  it('shows exactly the requested four organizations and uses the existing department hierarchy', () => {
    expect(ORGANIZATION_GALLERY.map((item) => item.name)).toEqual([
      '电子系学生会',
      '电子系团委',
      '电子系TMS分会',
      '电子系科协',
    ]);
    expect(findOrganization('student_union')?.departments.map((item) => item.name)).toEqual([
      '文艺中心',
      '体育中心',
      '联络中心',
      '权益发展中心',
    ]);
    expect(findOrganization('youth_league')?.departments).toHaveLength(6);
    expect(findOrganization('science_association')?.departments).toHaveLength(6);
    expect(findOrganization('tms')?.departments).toHaveLength(0);
    for (const organization of ORGANIZATION_GALLERY) {
      expect(organization).not.toHaveProperty('leadership');
      expect(organization).not.toHaveProperty('supportingPositions');
      for (const department of organization.departments) {
        expect(department).not.toHaveProperty('positions');
      }
    }
  });
  it('links using explicit activity organization identifiers without inventing department scopes', () => {
    const union = findOrganization('student_union')!;
    const arts = union.departments.find((item) => item.key === 'arts_center')!;
    expect(organizationRegistrationPath(arts.organizationIds)).toBe(
      '/collections/registrations?organization=arts_center',
    );
    const freshman = findOrganization('youth_league')!.departments.find(
      (item) => item.key === 'freshman',
    )!;
    expect(freshman.organizationIds).toEqual(['tuanwei']);
    expect(freshman.sharedActivityScope).toBe(true);
    expect(findOrganization('invalid')).toBeUndefined();
  });
});
