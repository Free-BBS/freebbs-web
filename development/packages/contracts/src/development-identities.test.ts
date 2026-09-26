import { describe, expect, it } from 'vitest';

import {
  DEVELOPMENT_IDENTITY_ROLE_KEYS,
  DEVELOPMENT_IDENTITY_SECTIONS,
  identityLabels,
  validateIdentitySelection,
} from './development-identities.js';

describe('development identity catalog', () => {
  it('contains every approved organization section in display order', () => {
    expect(DEVELOPMENT_IDENTITY_SECTIONS.map(({ id }) => id)).toEqual([
      'counselors',
      'student_union',
      'youth_league',
      'tms',
      'science_association',
      'media_center',
    ]);
  });

  it('rejects two positions from one unit and accepts positions from separate units', () => {
    expect(
      validateIdentitySelection(['domain.arts_lead', 'department.arts_member']),
    ).toMatchObject({ ok: false, groupId: 'student_union.arts_center' });
    expect(
      validateIdentitySelection(['domain.arts_lead', 'department.sports_member']),
    ).toEqual({ ok: true });
  });

  it('keeps platform administrator separate from the development lead role', () => {
    expect(DEVELOPMENT_IDENTITY_ROLE_KEYS).toContain('platform.admin');
    expect(DEVELOPMENT_IDENTITY_ROLE_KEYS).not.toContain('platform.super_admin');
  });

  it('returns visible labels in catalog order without exposing hidden legacy roles', () => {
    expect(
      identityLabels([
        'media_center.creative.member',
        'affiliation.tuanwei_member',
        'student_union.executive_president',
      ]),
    ).toEqual(['执行主席', '创意设计部部员']);
  });

  it('defines the complete approved hierarchy', () => {
    const section = (id: (typeof DEVELOPMENT_IDENTITY_SECTIONS)[number]['id']) =>
      DEVELOPMENT_IDENTITY_SECTIONS.find((candidate) => candidate.id === id);
    expect(section('counselors')?.groups.flatMap(({ options }) => options)).toHaveLength(5);
    expect(section('student_union')?.groups).toHaveLength(6);
    expect(section('youth_league')?.groups).toHaveLength(7);
    expect(section('tms')?.groups.flatMap(({ options }) => options)).toHaveLength(3);
    expect(section('science_association')?.groups).toHaveLength(7);
    expect(section('media_center')?.groups).toHaveLength(4);
  });
});
