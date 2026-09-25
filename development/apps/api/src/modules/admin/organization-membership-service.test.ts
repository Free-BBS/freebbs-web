import { describe, expect, it } from 'vitest';

import { createMemoryStore } from '../../core/database/memory-store.js';
import {
  revokeOrganizationMembership,
  setOrganizationMembership,
} from './organization-membership-service.js';

async function createSubject(store: ReturnType<typeof createMemoryStore>, uid: string) {
  await store.subjects.create({
    uid,
    displayName: uid,
    avatarUrl: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
  });
}

async function activeRoleKeys(store: ReturnType<typeof createMemoryStore>, subjectUid: string) {
  return (await store.roleAssignments.list({ query: subjectUid }))
    .filter(({ status }) => status === 'active')
    .map(({ roleKey }) => roleKey);
}

async function activeTagKeys(store: ReturnType<typeof createMemoryStore>, subjectUid: string) {
  return (await store.tagAssignments.list({ query: subjectUid }))
    .filter(({ status }) => status === 'active')
    .map(({ tagKey }) => tagKey);
}

describe('organization membership service', () => {
  it('keeps different levels in different organizations', async () => {
    const store = createMemoryStore();
    await createSubject(store, 'multi-org-user');

    await setOrganizationMembership(
      store,
      { subjectUid: 'multi-org-user', organizationId: 'sports_center', level: 'director' },
      { actorUid: 'demo-admin' },
    );
    await setOrganizationMembership(
      store,
      { subjectUid: 'multi-org-user', organizationId: 'tms', level: 'member' },
      { actorUid: 'demo-admin' },
    );

    expect(await activeRoleKeys(store, 'multi-org-user')).toEqual(
      expect.arrayContaining(['department.sports_director', 'affiliation.tms_member']),
    );
    expect(await activeTagKeys(store, 'multi-org-user')).toEqual(
      expect.arrayContaining(['social_org.sports_center', 'social_org.tms']),
    );
  });

  it('replaces the previous level without removing another organization', async () => {
    const store = createMemoryStore();
    await createSubject(store, 'promoted-user');

    await setOrganizationMembership(
      store,
      { subjectUid: 'promoted-user', organizationId: 'sports_center', level: 'member' },
      { actorUid: 'demo-admin' },
    );
    await setOrganizationMembership(
      store,
      { subjectUid: 'promoted-user', organizationId: 'tms', level: 'member' },
      { actorUid: 'demo-admin' },
    );
    await setOrganizationMembership(
      store,
      { subjectUid: 'promoted-user', organizationId: 'sports_center', level: 'lead' },
      { actorUid: 'demo-admin' },
    );

    expect(await activeRoleKeys(store, 'promoted-user')).toEqual(
      expect.arrayContaining(['domain.sports_lead', 'affiliation.tms_member']),
    );
    expect(await activeRoleKeys(store, 'promoted-user')).not.toContain('department.sports_member');
    expect(
      (await activeTagKeys(store, 'promoted-user')).filter(
        (tagKey) => tagKey === 'social_org.sports_center',
      ),
    ).toHaveLength(1);
  });

  it('revokes the organization role and synchronized tag together', async () => {
    const store = createMemoryStore();
    await createSubject(store, 'departing-user');

    await setOrganizationMembership(
      store,
      { subjectUid: 'departing-user', organizationId: 'liaison_center', level: 'director' },
      { actorUid: 'demo-admin' },
    );
    await revokeOrganizationMembership(store, 'departing-user', 'liaison_center', {
      actorUid: 'demo-admin',
    });

    expect(await activeRoleKeys(store, 'departing-user')).not.toContain(
      'department.liaison_director',
    );
    expect(await activeTagKeys(store, 'departing-user')).not.toContain('social_org.liaison_center');
  });
});
