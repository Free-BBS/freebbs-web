import { describe, expect, it } from 'vitest';

import { createAuthMiddleware } from '../auth/auth-middleware.js';
import { DemoAuthClient } from '../auth/demo-auth-client.js';
import { bootstrapPlatform } from '../bootstrap/bootstrap-service.js';
import { createMemoryStore } from '../database/memory-store.js';
import { authorize } from './authorize.js';

import type { AuthorizationContext } from './policy.js';

const student: AuthorizationContext = {
  uid: 'student',
  displayName: 'Student',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
  policies: [
    {
      id: 'baseline-liaison',
      action: 'liaison.resource.read',
      resource: 'liaison_resource',
      effect: 'allow',
      scope: { type: 'public', id: '*' },
    },
  ],
};

describe('second review: public liaison visibility', () => {
  it('grants the compiled liaison baseline only for the explicit public wildcard scope', () => {
    expect(
      authorize(student, {
        action: 'liaison.resource.read',
        resource: 'liaison_resource',
        scope: { type: 'public', id: '*' },
      }).allowed,
    ).toBe(true);

    for (const scope of [
      { type: 'organization', id: 'freebbs' },
      { type: 'restricted', id: 'leadership' },
    ]) {
      expect(
        authorize(student, {
          action: 'liaison.resource.read',
          resource: 'liaison_resource',
          scope,
        }),
      ).toEqual({ allowed: false, reason: 'scope-mismatch', matchedBy: 'policy:baseline-liaison' });
    }

    expect(
      authorize(student, { action: 'liaison.resource.read', resource: 'liaison_resource' }),
    ).toEqual({ allowed: false, reason: 'scope-mismatch', matchedBy: 'policy:baseline-liaison' });
  });
});

describe('second review: deterministic sports lead', () => {
  it('loads the governed sports lead for every team but not finance', async () => {
    const now = new Date('2026-07-27T10:00:00.000Z');
    const store = createMemoryStore({ seed: false });
    await bootstrapPlatform(store, {
      uid: 'demo-admin',
      recovery: false,
      version: 'task-15-review',
      now,
    });
    await store.subjects.create({
      uid: 'demo-sports-lead',
      displayName: 'Sports lead',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await store.roleAssignments.create({
      subjectUid: 'demo-sports-lead',
      roleKey: 'domain.sports_lead',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const authenticate = createAuthMiddleware({
      authClient: new DemoAuthClient(['demo-sports-lead']),
      mode: 'demo',
      store,
      now: () => now,
    });
    const authenticated = await authenticate({ 'x-demo-user': 'demo-sports-lead' });
    if (authenticated.status !== 200) throw new Error('expected governed sports lead');

    for (const teamId of ['team-basketball', 'team-badminton']) {
      expect(
        authorize(authenticated.user, {
          action: 'sports.team.manage',
          resource: 'sports_team',
          scope: { type: 'sports_team', id: teamId },
        }).allowed,
      ).toBe(true);
    }
    expect(
      authorize(authenticated.user, {
        action: 'finance.record.read',
        resource: 'finance_record',
        scope: { type: 'public', id: '*' },
      }).allowed,
    ).toBe(false);
  });
});
