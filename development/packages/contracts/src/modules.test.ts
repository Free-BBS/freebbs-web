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
    expect(ROLE_KEYS[0]).toBe('platform.super_admin');
    expect(ROLE_KEYS).toEqual(
      expect.arrayContaining([
        'platform.admin',
        'counselor.youth_league_secretary',
        'student_union.executive_president',
        'youth_league.organization.deputy_secretary',
        'science_association.chair',
        'media_center.new_media_reporters.member',
      ]),
    );
    expect(new Set(ROLE_KEYS)).toHaveLength(ROLE_KEYS.length);
  });
});
