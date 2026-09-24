import { describe, expect, it } from 'vitest';

import {
  SOCIAL_ORGANIZATIONS,
  SOCIAL_ORGANIZATION_IDS,
  organizationForRole,
} from './organizations.js';

describe('social organization contract', () => {
  it('defines the seven approved organizations in display order', () => {
    expect(SOCIAL_ORGANIZATION_IDS).toEqual([
      'arts_center',
      'liaison_center',
      'sports_center',
      'rights_development_center',
      'tuanwei',
      'sast',
      'tms',
    ]);
    expect(SOCIAL_ORGANIZATIONS.map(({ name }) => name)).toEqual([
      '文艺中心',
      '联络中心',
      '体育中心',
      '权益发展中心',
      '团委',
      '科协',
      'TMS',
    ]);
  });

  it('maps every organization level role back to one organization and level', () => {
    expect(organizationForRole('department.sports_director')).toEqual({
      organizationId: 'sports_center',
      level: 'director',
    });
    expect(organizationForRole('affiliation.tms_member')).toEqual({
      organizationId: 'tms',
      level: 'member',
    });
    expect(organizationForRole('platform.super_admin')).toBeNull();

    const roleKeys = SOCIAL_ORGANIZATIONS.flatMap(({ roles }) => Object.values(roles));
    expect(new Set(roleKeys)).toHaveLength(21);
  });
});
