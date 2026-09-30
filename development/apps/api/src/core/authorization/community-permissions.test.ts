import { describe, expect, it } from 'vitest';

import { BASE_STUDENT_PERMISSIONS, ROLE_PERMISSION_CATALOG } from './permission-catalog.js';

function actions(role: keyof typeof ROLE_PERMISSION_CATALOG): string[] {
  return ROLE_PERMISSION_CATALOG[role].map(({ action }) => action);
}

describe('community permission catalogue', () => {
  it('gives every development user basic community participation', () => {
    expect(BASE_STUDENT_PERMISSIONS.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        'community.post.create',
        'community.post.interact',
        'community.post.report',
      ]),
    );
  });

  it('separates newcomer member handling from leader approval', () => {
    expect(actions('youth_league.freshman.member')).toEqual(
      expect.arrayContaining([
        'community.wish.respond',
        'community.wish.transition',
        'community.wish.convert.request',
      ]),
    );
    expect(actions('youth_league.freshman.member')).not.toContain('community.wish.convert.approve');
    for (const role of [
      'youth_league.freshman.leader',
      'youth_league.freshman.deputy_secretary',
      'counselor.youth_league',
      'counselor.youth_league_secretary',
    ] as const) {
      expect(actions(role)).toContain('community.wish.convert.approve');
    }
  });

  it('grants platform admins moderation without identity reveal or wish approval', () => {
    expect(actions('platform.admin')).toContain('community.content.moderate');
    expect(actions('platform.admin')).not.toContain('community.identity.reveal');
    expect(actions('platform.admin')).not.toContain('community.wish.convert.approve');
    expect(actions('platform.super_admin')).toContain('*');
  });
});
