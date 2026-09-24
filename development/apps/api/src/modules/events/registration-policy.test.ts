import { describe, expect, it } from 'vitest';

import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { EventsService } from './service.js';

function registrant(uid: string): AuthorizationContext {
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
    policies: [
      {
        id: `register-${uid}`,
        action: 'events.register',
        resource: 'activity_registration',
        effect: 'allow',
      },
      {
        id: `cancel-${uid}`,
        action: 'events.cancel_registration',
        resource: 'activity_registration',
        effect: 'allow',
      },
    ],
  };
}

async function activity(
  store: DevelopmentStore,
  overrides: Partial<Parameters<DevelopmentStore['activities']['create']>[0]> = {},
) {
  return store.activities.create({
    title: 'Capacity contract',
    description: 'Registration boundaries are server-owned.',
    clubId: null,
    startsAt: null,
    status: 'published',
    technicalSupportStatus: 'not_requested',
    technicalSupportNote: null,
    ownerUid: 'owner',
    scope: { type: 'public', id: '*' },
    ...overrides,
  });
}

describe('event registration policy', () => {
  it('rejects registration at and after the deadline inside the transaction', async () => {
    const store = createMemoryStore({ seed: false });
    const record = await activity(store, { registrationDeadline: '2026-09-14T08:00:00.000Z' });
    const service = new EventsService(store, () => new Date('2026-09-14T08:00:00.000Z'));

    await expect(service.register(registrant('student-a'), record.id)).rejects.toMatchObject({
      status: 409,
      code: 'activity_registration_closed',
    });
  });

  it('serializes concurrent registration so capacity cannot be oversubscribed', async () => {
    const store = createMemoryStore({ seed: false });
    const record = await activity(store, { capacity: 1 });
    const service = new EventsService(store, () => new Date('2026-09-14T08:00:00.000Z'));

    const results = await Promise.allSettled([
      service.register(registrant('student-a'), record.id),
      service.register(registrant('student-b'), record.id),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ status: 409, code: 'activity_capacity_reached' }),
      }),
    ]);
    expect(
      (await store.activityRegistrations.list({ query: record.id })).filter(
        ({ status }) => status === 'registered',
      ),
    ).toHaveLength(1);
  });

  it('allows a cancelled participant to reclaim only a free place', async () => {
    const store = createMemoryStore({ seed: false });
    const record = await activity(store, { capacity: 1 });
    const service = new EventsService(store, () => new Date('2026-09-14T08:00:00.000Z'));
    await service.register(registrant('student-a'), record.id);
    await service.cancel(registrant('student-a'), record.id);
    await service.register(registrant('student-b'), record.id);

    await expect(service.register(registrant('student-a'), record.id)).rejects.toMatchObject({
      code: 'activity_capacity_reached',
    });
  });
});
