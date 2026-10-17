import { describe, expect, it } from 'vitest';
import {
  fullPageShowcaseParent,
  isDepartmentShowcasePath,
  isOrganizationShowcasePath,
  isFullPageShowcasePath,
  usesFullPageShowcase,
} from './presentation.js';

const departmentRoutes = [
  ['tms', 'position'],
  ['youth_league', 'organization'],
  ['youth_league', 'freshman'],
  ['youth_league', 'volunteer'],
  ['youth_league', 'practice'],
  ['youth_league', 'research'],
  ['youth_league', 'humanities'],
  ['youth_league', 'sail'],
  ['student_union', 'arts_center'],
  ['student_union', 'sports_center'],
  ['student_union', 'liaison_center'],
  ['student_union', 'rights_development_center'],
  ['science_association', 'software'],
  ['science_association', 'hardware'],
  ['science_association', 'training'],
  ['science_association', 'project'],
  ['science_association', 'planning'],
  ['media_center', 'creative'],
  ['media_center', 'audiovisual'],
  ['media_center', 'new_media_reporters'],
] as const;

const fullDocumentIds = [
  'youth_league.organization',
  'youth_league.research',
  'youth_league.humanities',
  'youth_league.sail',
  'media_center.creative',
  'media_center.audiovisual',
];

describe('organization presentation route boundaries', () => {
  it.each([
    '/organizations',
    '/organizations/tms',
    '/organizations/youth_league',
    '/organizations/student_union',
    '/organizations/science_association',
    '/organizations/media_center',
    ...departmentRoutes.map(
      ([organization, department]) => `/organizations/${organization}/${department}`,
    ),
  ])('uses a fixed reading surface for the complete exhibition route %s', (pathname) => {
    for (const base of ['', '/development'])
      for (const suffix of ['', '/'])
        expect(isOrganizationShowcasePath(`${base}${pathname}${suffix}`)).toBe(true);
  });

  it.each([
    '/organizations/unknown',
    '/organizations/youth_league/unknown',
    '/organizations/youth_league/organization/ledger',
    '/organizations/media_center/creative/edit',
    '/community',
    '/admin',
  ])('keeps management and unknown routes outside the exhibition viewport: %s', (pathname) => {
    expect(isOrganizationShowcasePath(pathname)).toBe(false);
    expect(isOrganizationShowcasePath(`/development${pathname}`)).toBe(false);
  });

  it.each(departmentRoutes)(
    'keeps the navigation fixed for the %s/%s exhibition with either router base',
    (organization, department) => {
      const pathname = `/organizations/${organization}/${department}`;
      for (const base of ['', '/development'])
        for (const suffix of ['', '/'])
          expect(isDepartmentShowcasePath(`${base}${pathname}${suffix}`)).toBe(true);
    },
  );

  it('recognizes the direct TMS entrance without adding another organization level', () => {
    for (const pathname of [
      '/organizations/tms',
      '/organizations/tms/',
      '/development/organizations/tms',
      '/development/organizations/tms/',
    ]) {
      expect(isDepartmentShowcasePath(pathname)).toBe(true);
      expect(isFullPageShowcasePath(pathname)).toBe(false);
      expect(fullPageShowcaseParent(pathname)).toBeUndefined();
    }
  });

  it.each(fullDocumentIds)('returns the organization parent for the %s document', (id) => {
    const [organization, department] = id.split('.');
    const pathname = `/organizations/${organization}/${department}`;
    for (const base of ['', '/development'])
      for (const suffix of ['', '/']) {
        const route = `${base}${pathname}${suffix}`;
        expect(usesFullPageShowcase(id)).toBe(true);
        expect(isFullPageShowcasePath(route)).toBe(true);
        expect(fullPageShowcaseParent(route)).toBe(`/organizations/${organization}`);
      }
  });

  it('preserves the introduction and embedded window for the three retained departments', () => {
    for (const id of [
      'student_union.liaison_center',
      'science_association.software',
      'science_association.hardware',
    ]) {
      const pathname = `/organizations/${id.replace('.', '/')}`;
      expect(isDepartmentShowcasePath(pathname)).toBe(true);
      expect(usesFullPageShowcase(id)).toBe(false);
      expect(isFullPageShowcasePath(pathname)).toBe(false);
      expect(fullPageShowcaseParent(pathname)).toBeUndefined();
    }
    expect(usesFullPageShowcase(undefined)).toBe(false);
  });

  it.each([
    '/organizations',
    '/organizations/youth_league',
    '/organizations/student_union',
    '/organizations/science_association',
    '/organizations/media_center',
    '/organizations/unknown',
    '/organizations/tms/unknown',
    '/organizations/youth_league/unknown',
    '/organizations/youth_league/organization/ledger',
    '/organizations/youth_league/organization/ledger/new',
    '/organizations/media_center/creative/manage',
    '/organizations/science_association/software/edit',
    '/community',
    '/registrations',
    '/admin',
    '/system-settings',
    '/other/organizations/media_center/creative',
  ])('does not apply the exhibition viewport to index or management route %s', (pathname) => {
    for (const base of ['', '/development']) {
      expect(isDepartmentShowcasePath(`${base}${pathname}`)).toBe(false);
      expect(isFullPageShowcasePath(`${base}${pathname}`)).toBe(false);
      expect(fullPageShowcaseParent(`${base}${pathname}`)).toBeUndefined();
    }
  });
});
