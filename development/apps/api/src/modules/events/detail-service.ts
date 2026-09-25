import type { ScopeRef } from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  ActivityMilestoneRecord,
  ActivityRecord,
  CompetitionFixtureRecord,
  DevelopmentStore,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canUpdateOrganization } from './organization-access.js';

export interface ActivityMilestoneInput {
  occursAt: string;
  title: string;
  type: string;
  description: string;
  completed: boolean;
  displayOrder: number;
}

export type ActivityMilestonePatch = Partial<ActivityMilestoneInput>;

export interface CompetitionFixtureInput {
  round: string;
  participantA: string;
  participantB: string;
  scheduledAt: string;
  location: string;
  score: string | null;
}

export type CompetitionFixturePatch = Partial<CompetitionFixtureInput>;

export interface ActivityDetail extends ActivityRecord {
  milestones: ActivityMilestoneRecord[];
  fixtures: CompetitionFixtureRecord[];
  progress: { completed: number; total: number; percentage: number } | null;
  registrationCount: number;
}

function allowed(
  actor: AuthorizationContext,
  action: string,
  resource: string,
  scope: ScopeRef,
): boolean {
  return authorize(actor, { action, resource, scope }).allowed;
}

function canManage(actor: AuthorizationContext, record: ActivityRecord): boolean {
  return (
    (allowed(actor, 'events.update', 'activity', record.scope) &&
      canUpdateOrganization(actor, record)) ||
    (record.ownerUid === actor.uid &&
      allowed(actor, 'events.create', 'activity', record.scope) &&
      (record.status === 'draft' || record.status === 'rejected'))
  );
}

function canView(actor: AuthorizationContext, record: ActivityRecord): boolean {
  return (
    (record.status === 'published' && allowed(actor, 'events.read', 'activity', record.scope)) ||
    canManage(actor, record) ||
    (record.status === 'pending' && allowed(actor, 'events.approve', 'activity', record.scope)) ||
    (record.technicalSupportStatus === 'requested' &&
      allowed(actor, 'events.technical_support', 'activity', record.scope))
  );
}

function activityNotFound(): HttpError {
  return new HttpError(404, 'activity_not_found', 'Activity not found');
}

function milestoneNotFound(): HttpError {
  return new HttpError(404, 'activity_milestone_not_found', 'Activity milestone not found');
}

function fixtureNotFound(): HttpError {
  return new HttpError(404, 'competition_fixture_not_found', 'Competition fixture not found');
}

export class ActivityDetailService {
  constructor(private readonly store: DevelopmentStore) {}

  async get(actor: AuthorizationContext, activityId: string): Promise<ActivityDetail> {
    const activity = await this.store.activities.get(activityId);
    if (activity === null || !canView(actor, activity)) throw activityNotFound();

    const milestones = (await this.store.activityMilestones.list({ query: activityId }))
      .filter((record) => record.activityId === activityId)
      .sort(
        (left, right) =>
          left.displayOrder - right.displayOrder || left.occursAt.localeCompare(right.occursAt),
      );
    const fixtures = (await this.store.competitionFixtures.list({ query: activityId }))
      .filter((record) => record.activityId === activityId)
      .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
    const registrationCount = (
      await this.store.activityRegistrations.list({ query: activityId })
    ).filter((record) => record.activityId === activityId && record.status === 'registered').length;
    const completed = milestones.filter(({ completed: done }) => done).length;
    const progress =
      milestones.length === 0
        ? null
        : {
            completed,
            total: milestones.length,
            percentage: Math.round((completed / milestones.length) * 100),
          };

    return { ...activity, milestones, fixtures, progress, registrationCount };
  }

  async createMilestone(
    actor: AuthorizationContext,
    activityId: string,
    input: ActivityMilestoneInput,
  ): Promise<ActivityMilestoneRecord> {
    return this.store.transaction(async (store) => {
      const activity = await store.activities.getForUpdate(activityId);
      if (activity === null || !canManage(actor, activity)) throw activityNotFound();
      const created = await store.activityMilestones.create({
        ...input,
        activityId,
        status: 'active',
        ownerUid: actor.uid,
        scope: { type: 'activity', id: activityId },
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'events.milestone.created',
        resourceType: 'activity_milestone',
        resourceId: created.id,
        details: { activityId },
      });
      return created;
    });
  }

  async updateMilestone(
    actor: AuthorizationContext,
    activityId: string,
    milestoneId: string,
    patch: ActivityMilestonePatch,
  ): Promise<ActivityMilestoneRecord> {
    return this.store.transaction(async (store) => {
      const activity = await store.activities.getForUpdate(activityId);
      if (activity === null || !canManage(actor, activity)) throw activityNotFound();
      const current = await store.activityMilestones.getForUpdate(milestoneId);
      if (current === null || current.activityId !== activityId) throw milestoneNotFound();
      const updated = await store.activityMilestones.update(milestoneId, patch);
      if (updated === null) throw milestoneNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'events.milestone.updated',
        resourceType: 'activity_milestone',
        resourceId: milestoneId,
        details: { activityId, changedFields: Object.keys(patch).sort() },
      });
      return updated;
    });
  }

  async deleteMilestone(
    actor: AuthorizationContext,
    activityId: string,
    milestoneId: string,
  ): Promise<void> {
    await this.store.transaction(async (store) => {
      const activity = await store.activities.getForUpdate(activityId);
      if (activity === null || !canManage(actor, activity)) throw activityNotFound();
      const current = await store.activityMilestones.getForUpdate(milestoneId);
      if (current === null || current.activityId !== activityId) throw milestoneNotFound();
      if (!(await store.activityMilestones.delete(milestoneId))) throw milestoneNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'events.milestone.deleted',
        resourceType: 'activity_milestone',
        resourceId: milestoneId,
        details: { activityId },
      });
    });
  }

  async createFixture(
    actor: AuthorizationContext,
    activityId: string,
    input: CompetitionFixtureInput,
  ): Promise<CompetitionFixtureRecord> {
    return this.store.transaction(async (store) => {
      const activity = await store.activities.getForUpdate(activityId);
      if (activity === null || !canManage(actor, activity)) throw activityNotFound();
      const created = await store.competitionFixtures.create({
        ...input,
        activityId,
        status: 'active',
        ownerUid: actor.uid,
        scope: { type: 'activity', id: activityId },
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'events.fixture.created',
        resourceType: 'competition_fixture',
        resourceId: created.id,
        details: { activityId },
      });
      return created;
    });
  }

  async updateFixture(
    actor: AuthorizationContext,
    activityId: string,
    fixtureId: string,
    patch: CompetitionFixturePatch,
  ): Promise<CompetitionFixtureRecord> {
    return this.store.transaction(async (store) => {
      const activity = await store.activities.getForUpdate(activityId);
      if (activity === null || !canManage(actor, activity)) throw activityNotFound();
      const current = await store.competitionFixtures.getForUpdate(fixtureId);
      if (current === null || current.activityId !== activityId) throw fixtureNotFound();
      const updated = await store.competitionFixtures.update(fixtureId, patch);
      if (updated === null) throw fixtureNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'events.fixture.updated',
        resourceType: 'competition_fixture',
        resourceId: fixtureId,
        details: { activityId, changedFields: Object.keys(patch).sort() },
      });
      return updated;
    });
  }

  async deleteFixture(
    actor: AuthorizationContext,
    activityId: string,
    fixtureId: string,
  ): Promise<void> {
    await this.store.transaction(async (store) => {
      const activity = await store.activities.getForUpdate(activityId);
      if (activity === null || !canManage(actor, activity)) throw activityNotFound();
      const current = await store.competitionFixtures.getForUpdate(fixtureId);
      if (current === null || current.activityId !== activityId) throw fixtureNotFound();
      if (!(await store.competitionFixtures.delete(fixtureId))) throw fixtureNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'events.fixture.deleted',
        resourceType: 'competition_fixture',
        resourceId: fixtureId,
        details: { activityId },
      });
    });
  }
}
