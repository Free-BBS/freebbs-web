import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { RoleKey, SocialOrganizationId } from '@freebbs-development/contracts';
import { ROLE_KEYS, SOCIAL_ORGANIZATION_IDS } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { canAccessFinanceOrganization, canReviewFinance } from './organization-access.js';
import { FinanceService } from './service.js';

const broad = [
  { id: 'legacy-finance', action: 'finance.*', resource: '*', effect: 'allow' as const },
];
const identity = (roles: RoleKey[]): AuthorizationContext => ({
  uid: 'finance-scope-user',
  displayName: 'Finance user',
  avatarUrl: null,
  baseRole: 'student',
  roles,
  tags: [],
  policies: broad,
});

async function fixture(role: RoleKey, scope = { type: 'public', id: '*' }, legacyBroad = true) {
  const store = createMemoryStore();
  const user = identity([]);
  await store.subjects.create({
    uid: user.uid,
    displayName: user.displayName,
    avatarUrl: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
  });
  const assignment = await store.roleAssignments.create({
    subjectUid: user.uid,
    roleKey: role,
    expiresAt: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope,
  });
  // Existing installations may still have this broad role binding.
  if (legacyBroad)
    await store.rolePermissions.create({
      roleKey: role,
      action: 'finance.*',
      resource: '*',
      effect: 'allow',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
  const actor = await loadAuthorizationContext(store, user, new Date());
  const app = createApp({ store, authMode: 'demo', authClient: { introspect: async () => user } });
  const record = async (organizationId: SocialOrganizationId | null, status = 'submitted') =>
    store.financeRecords.create({
      title: `${organizationId} budget`,
      kind: 'budget',
      amountCents: 100,
      organizationId,
      status,
      activityId: null,
      ownerUid: 'another-user',
      scope: organizationId
        ? { type: 'social_organization', id: organizationId }
        : { type: 'public', id: '*' },
    });
  return { store, app, user, actor, assignment, record, service: new FinanceService(store) };
}

describe('finance identity boundaries despite legacy broad grants', () => {
  it.each(['youth_league.organization.deputy_secretary', 'affiliation.tuanwei_lead'] as const)(
    'rejects foreign review through both endpoints for %s',
    async (role) => {
      const { app, user, record, store } = await fixture(role);
      const foreign = await record('arts_center');
      await request(app)
        .post(`/api/development/v1/finance/records/${foreign.id}/reviews`)
        .set('X-Demo-User', user.uid)
        .send({ decision: 'approved' })
        .expect(403);
      await request(app)
        .post(`/api/development/v1/finance/records/${foreign.id}/transitions`)
        .set('X-Demo-User', user.uid)
        .send({ to: 'approved' })
        .expect(404);
      expect(await store.financeRecords.get(foreign.id)).toMatchObject({ status: 'submitted' });
    },
  );

  it.each(['department.arts_member', 'youth_league.organization.member'] as const)(
    'allows member reads but rejects malicious create, patch and review for %s',
    async (role) => {
      const { actor, service, record, app, user, store } = await fixture(role);
      for (const seeded of await store.financeRecords.list())
        await store.financeRecords.delete(seeded.id);
      const org = role.startsWith('department') ? 'arts_center' : 'tuanwei';
      expect(canAccessFinanceOrganization(actor, org)).toBe(true);
      const draft = await record(org, 'draft');
      await expect(
        service.create(actor, {
          title: 'Malicious create',
          kind: 'budget',
          amountCents: 100,
          activityId: null,
          status: 'draft',
          organizationId: org,
          scope: { type: 'social_organization', id: org },
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.update(actor, draft.id, { title: 'Malicious patch' }),
      ).rejects.toMatchObject({ status: 404 });
      const submitted = await record(org);
      await expect(service.review(actor, submitted.id, 'approved')).rejects.toMatchObject({
        status: 403,
      });
      await record(org, 'approved');
      await record('sports_center', 'approved');
      await record(null, 'approved');
      const page = await request(app)
        .get('/api/development/v1/finance/records?page=1&pageSize=1')
        .set('X-Demo-User', user.uid)
        .expect(200);
      expect(page.body.data).toMatchObject({
        total: 3,
        items: [expect.objectContaining({ organizationId: org })],
        summaries: [expect.objectContaining({ organizationId: org, approvedBudget: 100 })],
      });
      const foreignFilter = await request(app)
        .get('/api/development/v1/finance/records?page=1&organizationId=sports_center')
        .set('X-Demo-User', user.uid)
        .expect(200);
      expect(foreignFilter.body.data).toMatchObject({
        total: 0,
        items: [],
        summaries: [expect.objectContaining({ organizationId: org, approvedBudget: 100 })],
      });
    },
  );

  it('restricts legacy Tuanwei lead reads and mutations to Tuanwei', () => {
    const actor = identity(['affiliation.tuanwei_lead']);
    expect(canAccessFinanceOrganization(actor, 'tuanwei', 'update')).toBe(true);
    for (const foreign of ['arts_center', 'sports_center', null] as const) {
      expect(canAccessFinanceOrganization(actor, foreign)).toBe(false);
      expect(canAccessFinanceOrganization(actor, foreign, 'create')).toBe(false);
      expect(canReviewFinance(actor, foreign)).toBe(false);
    }
  });

  it('does not assign whole organization budgets to a department counselor', () => {
    const actor = identity(['counselor.practice']);
    expect(canAccessFinanceOrganization(actor, 'tuanwei', 'update')).toBe(false);
    expect(canReviewFinance(actor, 'tuanwei')).toBe(false);
  });

  it('rejects linking a foreign activity while claiming an owned organization', async () => {
    const { store, actor, service, record } = await fixture('domain.arts_lead');
    const activity = await store.activities.create({
      title: 'Foreign activity',
      description: '',
      organizationId: 'sports_center',
      registrationDeadline: null,
      capacity: null,
      contact: '',
      status: 'draft',
      ownerUid: 'foreign-user',
      scope: { type: 'social_organization', id: 'sports_center' },
      sourceCommunityPostId: null,
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
    });
    const input = {
      title: 'False organization',
      kind: 'budget' as const,
      amountCents: 100,
      activityId: activity.id,
      status: 'draft' as const,
      organizationId: 'arts_center' as const,
      scope: { type: 'activity', id: activity.id },
    };
    await expect(service.create(actor, input)).rejects.toMatchObject({ status: 404 });
    const own = await record('arts_center', 'draft');
    await expect(
      service.update(actor, own.id, { activityId: activity.id, scope: input.scope }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await store.financeRecords.get(own.id)).toMatchObject({ activityId: null });
    const inconsistent = await store.financeRecords.create({ ...input, ownerUid: actor.uid });
    await expect(
      service.update(actor, inconsistent.id, {
        activityId: null,
        scope: { type: 'social_organization', id: 'arts_center' },
      }),
    ).rejects.toMatchObject({ status: 404 });
    await store.financeRecords.update(inconsistent.id, { status: 'submitted' });
    await expect(service.review(actor, inconsistent.id, 'approved')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.transition(actor, inconsistent.id, 'approved')).rejects.toMatchObject({
      status: 404,
    });
    expect(await store.financeRecords.get(inconsistent.id)).toMatchObject({ status: 'submitted' });
  });

  it('allows own-organization linked activity creation, editing and review', async () => {
    const { store, actor, service } = await fixture('domain.liaison_lead');
    const activity = await store.activities.get('activity-orientation');
    expect(activity?.organizationId).toBe('liaison_center');
    const draft = await service.create(actor, {
      title: 'Own linked budget',
      kind: 'budget',
      amountCents: 100,
      activityId: 'activity-orientation',
      organizationId: 'liaison_center',
      status: 'draft',
      scope: { type: 'activity', id: 'activity-orientation' },
    });
    await expect(service.update(actor, draft.id, { amountCents: 200 })).resolves.toMatchObject({
      amountCents: 200,
    });
    await service.transition(actor, draft.id, 'submitted');
    await expect(service.review(actor, draft.id, 'approved')).resolves.toMatchObject({
      status: 'approved',
    });
  });

  it('keeps legacy null activity ownership limited to global finance supervisors', async () => {
    const { store, actor, service } = await fixture('counselor.youth_league');
    await store.activities.update('activity-orientation', { organizationId: null });
    const legacy = await service.create(actor, {
      title: 'Legacy linked budget',
      kind: 'budget',
      amountCents: 100,
      activityId: 'activity-orientation',
      organizationId: null,
      status: 'draft',
      scope: { type: 'activity', id: 'activity-orientation' },
    });
    await service.transition(actor, legacy.id, 'submitted');
    await expect(service.review(actor, legacy.id, 'approved')).resolves.toMatchObject({
      status: 'approved',
    });
    const lead = identity(['affiliation.tuanwei_lead']);
    expect(canAccessFinanceOrganization(lead, null)).toBe(false);
    expect(canReviewFinance(lead, null)).toBe(false);
  });
});

const union: SocialOrganizationId[] = [
  'arts_center',
  'liaison_center',
  'sports_center',
  'rights_development_center',
];
function expectedOrganizations(role: RoleKey): (SocialOrganizationId | null)[] {
  if (
    ['platform.admin', 'counselor.youth_league', 'counselor.youth_league_secretary'].includes(role)
  )
    return [...SOCIAL_ORGANIZATION_IDS, null];
  if (role === 'counselor.innovation') return ['sast'];
  if (role.startsWith('student_union.')) return union;
  if (role.startsWith('youth_league.') || role.startsWith('affiliation.tuanwei_'))
    return ['tuanwei'];
  if (role.startsWith('science_association.') || role.startsWith('affiliation.sast_'))
    return ['sast'];
  if (role.startsWith('media_center.')) return ['media_center'];
  if (role.startsWith('affiliation.tms_')) return ['tms'];
  const center =
    /^domain\.(arts|sports|liaison|rights_development)_lead$|^department\.(arts|sports|liaison|rights_development)_(?:director|member)$/.exec(
      role,
    );
  return center ? [`${center[1] ?? center[2]}_center` as SocialOrganizationId] : [];
}
function expectedMaintainer(role: RoleKey): boolean {
  return (
    [
      'platform.admin',
      'counselor.youth_league',
      'counselor.youth_league_secretary',
      'counselor.innovation',
      'student_union.executive_president',
      'student_union.presidium',
      'science_association.chair',
    ].includes(role) ||
    role.startsWith('domain.') ||
    role.endsWith('_lead') ||
    /\.(finance|deputy_secretary|vice_chair|consultant)$/.test(role)
  );
}

describe('finance canonical identity matrix', () => {
  it('covers all 79 catalog identities including legacy roles', () => {
    expect(ROLE_KEYS).toHaveLength(79);
  });
  it.each(ROLE_KEYS)(
    '%s reads its organizations and maintains only its authorized budgets',
    async (role) => {
      const { actor } = await fixture(role, { type: 'public', id: '*' }, false);
      const own = expectedOrganizations(role);
      for (const org of [...SOCIAL_ORGANIZATION_IDS, null]) {
        const readable = own.includes(org);
        const writable = readable && expectedMaintainer(role);
        expect(canAccessFinanceOrganization(actor, org), `${role} read ${org}`).toBe(readable);
        expect(canAccessFinanceOrganization(actor, org, 'create'), `${role} create ${org}`).toBe(
          writable,
        );
        expect(canAccessFinanceOrganization(actor, org, 'update'), `${role} update ${org}`).toBe(
          writable,
        );
        expect(canReviewFinance(actor, org), `${role} review ${org}`).toBe(writable);
      }
    },
  );

  it('intersects a finance appointment with its concrete assignment scope', async () => {
    const { actor } = await fixture(
      'student_union.finance',
      { type: 'social_organization', id: 'arts_center' },
      false,
    );
    expect(canAccessFinanceOrganization(actor, 'arts_center', 'update')).toBe(true);
    expect(canReviewFinance(actor, 'arts_center')).toBe(true);
    expect(canAccessFinanceOrganization(actor, 'sports_center')).toBe(false);
    expect(canReviewFinance(actor, 'sports_center')).toBe(false);
  });

  it('preserves explicit own-organization finance grants for a scoped platform administrator', async () => {
    const { actor, service, record } = await fixture(
      'platform.admin',
      { type: 'social_organization', id: 'arts_center' },
      false,
    );
    expect(actor.businessAdmin).toBe(false);
    expect(canAccessFinanceOrganization(actor, 'arts_center', 'update')).toBe(true);
    expect(canReviewFinance(actor, 'arts_center')).toBe(true);
    expect(canAccessFinanceOrganization(actor, 'sports_center')).toBe(false);
    expect(canReviewFinance(actor, null)).toBe(false);
    const own = await record('arts_center');
    await expect(service.review(actor, own.id, 'approved')).resolves.toMatchObject({
      status: 'approved',
    });
    const foreign = await record('sports_center');
    await expect(service.review(actor, foreign.id, 'approved')).rejects.toMatchObject({
      status: 403,
    });
  });

  it.each(['inactive', 'expired'] as const)(
    'rejects a stale %s finance appointment at the service boundary',
    async (reason) => {
      const { store, actor, assignment, record, service } = await fixture('student_union.finance');
      const submitted = await record('arts_center');
      const draft = await record('arts_center', 'draft');
      await store.roleAssignments.update(
        assignment.id,
        reason === 'inactive' ? { status: 'inactive' } : { expiresAt: '2000-01-01T00:00:00.000Z' },
      );
      await expect(service.review(actor, submitted.id, 'approved')).rejects.toMatchObject({
        status: 403,
      });
      await expect(service.transition(actor, submitted.id, 'approved')).rejects.toMatchObject({
        status: 404,
      });
      await expect(service.update(actor, draft.id, { title: 'Stale' })).rejects.toMatchObject({
        status: 404,
      });
    },
  );

  it('retains explicit denies on a finance appointment with an old wildcard grant', async () => {
    const { store, user, record, service } = await fixture('student_union.finance');
    for (const action of [
      'finance.record.read',
      'finance.record.update',
      'finance.record.review',
    ] as const) {
      await store.rolePermissions.create({
        roleKey: 'student_union.finance',
        action,
        resource: 'finance_record',
        effect: 'deny',
        status: 'active',
        ownerUid: 'demo-admin',
        scope: { type: 'social_organization', id: 'sports_center' },
      });
    }
    const actor = await loadAuthorizationContext(store, user, new Date());
    expect(canAccessFinanceOrganization(actor, 'sports_center')).toBe(false);
    expect(canReviewFinance(actor, 'sports_center')).toBe(false);
    const source = await record('arts_center', 'draft');
    await expect(
      service.update(actor, source.id, {
        organizationId: 'sports_center',
        scope: { type: 'social_organization', id: 'sports_center' },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await store.financeRecords.get(source.id)).toMatchObject({
      organizationId: 'arts_center',
    });
  });

  it('does not restore an explicitly inactive default finance binding', async () => {
    const { store, user } = await fixture(
      'youth_league.finance',
      { type: 'public', id: '*' },
      false,
    );
    const bindings = (await store.rolePermissions.list()).filter(
      (binding) =>
        binding.roleKey === 'youth_league.finance' && binding.action === 'finance.record.review',
    );
    expect(bindings.length).toBeGreaterThan(0);
    for (const binding of bindings)
      await store.rolePermissions.update(binding.id, { status: 'inactive' });
    const actor = await loadAuthorizationContext(store, user, new Date());
    expect(canAccessFinanceOrganization(actor, 'tuanwei')).toBe(true);
    expect(canReviewFinance(actor, 'tuanwei')).toBe(false);
  });
});
