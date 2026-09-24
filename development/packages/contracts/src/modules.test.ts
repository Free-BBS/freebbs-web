import { describe, expect, it } from 'vitest';

import { MODULE_IDS, ROLE_KEYS } from './modules.js';

describe('module and role contracts', () => {
  it('keeps the legacy clubs ID while registering the growth module', () => {
    expect(MODULE_IDS).toEqual([
      'dashboard',
      'knowledge',
      'information',
      'clubs',
      'growth',
      'events',
      'liaison',
      'sports',
      'finance',
      'admin',
    ]);
  });

  it('defines each elevated role key exactly once', () => {
    expect(ROLE_KEYS).toEqual([
      'platform.super_admin',
      'domain.arts_lead',
      'domain.sports_lead',
      'domain.liaison_lead',
      'domain.rights_development_lead',
      'department.arts_director',
      'department.sports_director',
      'department.liaison_director',
      'department.rights_development_director',
      'department.arts_member',
      'department.sports_member',
      'department.liaison_member',
      'department.rights_development_member',
      'affiliation.tuanwei_member',
      'affiliation.sast_member',
      'affiliation.tuanwei_director',
      'affiliation.tuanwei_lead',
      'affiliation.sast_director',
      'affiliation.sast_lead',
      'affiliation.tms_member',
      'affiliation.tms_director',
      'affiliation.tms_lead',
    ]);
    expect(new Set(ROLE_KEYS)).toHaveLength(ROLE_KEYS.length);
  });
});
