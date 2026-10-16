import { departmentForRoute } from '@freebbs-development/contracts';
import { describe, expect, it } from 'vitest';
import { ORGANIZATION_GALLERY, organizationRegistrationPath, findOrganization } from './catalog.js';
import { SHOWCASES, showcaseRoute } from './showcase/registry.js';

describe('organization exhibition catalog', () => {
  it('keeps the five existing organizations and their department hierarchy with an independent research exhibition', () => {
    expect(ORGANIZATION_GALLERY.map(({ key }) => key)).toEqual([
      'tms',
      'youth_league',
      'student_union',
      'science_association',
      'media_center',
    ]);
    expect(findOrganization('student_union')?.departments.map(({ key }) => key)).toEqual([
      'arts_center',
      'sports_center',
      'liaison_center',
      'rights_development_center',
    ]);
    expect(findOrganization('youth_league')?.departments.map(({ key }) => key)).toEqual([
      'organization',
      'freshman',
      'volunteer',
      'practice',
      'humanities',
      'sail',
      'research',
    ]);
    expect(findOrganization('science_association')?.departments).toHaveLength(5);
    expect(
      findOrganization('science_association')?.departments.some(({ key }) => key === 'office'),
    ).toBe(false);
    expect(
      findOrganization('science_association')?.departments.find(({ key }) => key === 'training')
        ?.name,
    ).toBe('学习培养部');
    expect(
      findOrganization('youth_league')?.departments.find(({ key }) => key === 'freshman')?.name,
    ).toBe('办公室·新生组');
    expect(findOrganization('tms')?.departments).toHaveLength(0);
    expect(ORGANIZATION_GALLERY.flatMap(({ departments }) => departments)).toHaveLength(19);
    for (const organization of ORGANIZATION_GALLERY) {
      expect(organization).not.toHaveProperty('leadership');
      expect(organization).not.toHaveProperty('supportingPositions');
      for (const department of organization.departments) {
        expect(department).not.toHaveProperty('positions');
        expect(department.focus.length).toBeGreaterThan(0);
      }
    }
  });
  it('keeps media activity links honestly unscoped and other scopes explicit', () => {
    const media = findOrganization('media_center')!;
    expect(media.departments.map(({ key }) => key)).toEqual([
      'creative',
      'audiovisual',
      'new_media_reporters',
    ]);
    expect(media.organizationIds).toEqual([]);
    for (const department of media.departments) expect(department.organizationIds).toEqual([]);
    expect(organizationRegistrationPath([])).toBe('/collections/registrations');
    const union = findOrganization('student_union')!;
    const arts = union.departments.find(({ key }) => key === 'arts_center')!;
    expect(organizationRegistrationPath(arts.organizationIds)).toBe(
      '/collections/registrations?organization=arts_center',
    );
    const freshman = findOrganization('youth_league')!.departments.find(
      ({ key }) => key === 'freshman',
    )!;
    expect(freshman.organizationIds).toEqual(['tuanwei']);
    expect(freshman.sharedActivityScope).toBe(true);
    expect(organizationRegistrationPath(['arts_center', 'sports_center'])).toBe(
      '/collections/registrations?organization=arts_center%2Csports_center',
    );
    expect(findOrganization('invalid')).toBeUndefined();
  });
  it('registers all seventeen submitted exhibitions at valid, unique browse routes', () => {
    expect(SHOWCASES).toHaveLength(17);
    expect(new Set(SHOWCASES.map(({ departmentId }) => departmentId)).size).toBe(17);
    expect(new Set(SHOWCASES.map(showcaseRoute)).size).toBe(17);
    for (const content of SHOWCASES) {
      const [organizationKey, departmentKey] = content.departmentId.split('.');
      const organization = findOrganization(organizationKey)!;
      expect(organization).toBeDefined();
      if (organizationKey === 'tms') expect(showcaseRoute(content)).toBe('/organizations/tms');
      else expect(organization.departments.some(({ key }) => key === departmentKey)).toBe(true);
      expect(content.summary).not.toBe('');
      expect(content.duties.length).toBeGreaterThan(0);
      if (!content.site) expect(content.sections.length).toBeGreaterThan(0);
    }
  });
  it('does not turn the research exhibition into a practice permission identity', () => {
    const research = findOrganization('youth_league')!.departments.find(
      ({ key }) => key === 'research',
    )!;
    expect(research.name).toBe('调研组');
    expect(research.sharedActivityScope).toBe(false);
    expect(departmentForRoute('youth_league', 'research')).toBeUndefined();
    expect(departmentForRoute('youth_league', 'practice')?.id).toBe('youth_league.practice');
    expect(SHOWCASES.find(({ slug }) => slug === 'research')?.departmentId).toBe(
      'youth_league.research',
    );
  });
});
