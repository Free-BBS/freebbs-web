import type {
  InformationFeedFilter,
  InformationFeedItem,
  ScopeRef,
} from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  AnnouncementRecord,
  ConsultationRecord,
  DevelopmentStore,
  ListFilters,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canTransition } from '../../core/workflow/state-machine.js';

export type AnnouncementStatus = 'draft' | 'published' | 'archived';
export type ConsultationStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

const ANNOUNCEMENT_TRANSITIONS = {
  draft: ['published'],
  published: ['draft', 'archived'],
  archived: [],
} as const;

const CONSULTATION_TRANSITIONS = {
  open: ['in_progress'],
  in_progress: ['resolved'],
  resolved: ['in_progress', 'closed'],
  closed: [],
} as const;

export interface AnnouncementInput {
  title: string;
  body: string;
  status: 'draft';
  scope: ScopeRef;
}

export interface AnnouncementPatch {
  title?: string;
  body?: string;
  scope?: ScopeRef;
}

export interface ConsultationInput {
  title: string;
  body: string;
  visibility?: 'public' | 'private';
}

export interface ConsultationPatch {
  title?: string;
  body?: string;
  visibility?: 'public' | 'private';
}

export interface ConsultationHandlingPatch {
  dueAt?: string | null;
  assigneeUid?: string | null;
  reply?: string | null;
}

type TransitionResult<T> =
  | { kind: 'missing' }
  | { kind: 'updated'; record: T }
  | { kind: 'rejected'; from: string; to: string; scope: ScopeRef };

function permitted(
  actor: AuthorizationContext,
  action: string,
  resource: 'announcement' | 'consultation',
  scope: ScopeRef,
): boolean {
  return authorize(actor, { action, resource, scope }).allowed;
}

export class InformationService {
  constructor(private readonly store: DevelopmentStore) {}

  async listFeed(
    actor: AuthorizationContext,
    filter: InformationFeedFilter,
  ): Promise<InformationFeedItem[]> {
    const [announcements, consultations, replies, likes] = await Promise.all([
      this.store.announcements.list(),
      this.store.consultations.list(),
      this.store.informationReplies.list(),
      this.store.informationLikes.list(),
    ]);
    const visibleAnnouncements = announcements.filter(
      (record) =>
        record.status === 'published' ||
        permitted(actor, 'information.announcement.create', 'announcement', record.scope) ||
        permitted(actor, 'information.announcement.publish', 'announcement', record.scope),
    );
    const visibleConsultations = consultations.filter(
      (record) =>
        record.visibility === 'public' ||
        record.requesterUid === actor.uid ||
        permitted(actor, 'information.consultation.read', 'consultation', record.scope) ||
        permitted(actor, 'information.consultation.triage', 'consultation', record.scope),
    );
    const counts = (kind: 'announcement' | 'consultation', id: string) => ({
      replyCount: replies.filter(
        (reply) => reply.targetType === kind && reply.targetId === id && reply.status === 'visible',
      ).length,
      targetLikes: likes.filter(
        (like) => like.targetType === kind && like.targetId === id && like.status === 'active',
      ),
    });
    const items: InformationFeedItem[] = [
      ...visibleAnnouncements.map((record): InformationFeedItem => {
        const { replyCount, targetLikes } = counts('announcement', record.id);
        const canManage =
          permitted(actor, 'information.announcement.create', 'announcement', record.scope) ||
          permitted(actor, 'information.announcement.publish', 'announcement', record.scope);
        return {
          kind: 'announcement',
          id: record.id,
          title: record.title,
          body: record.body,
          status: record.status as 'draft' | 'published' | 'archived',
          ownerUid: record.ownerUid,
          scope: record.scope,
          pinned: record.pinned ?? false,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          likeCount: targetLikes.length,
          replyCount,
          likedByViewer: targetLikes.some((like) => like.userUid === actor.uid),
          canReply: record.status === 'published',
          canManage,
        };
      }),
      ...visibleConsultations.map((record): InformationFeedItem => {
        const { replyCount, targetLikes } = counts('consultation', record.id);
        const isPublic = record.visibility === 'public';
        return {
          kind: 'consultation',
          id: record.id,
          title: record.title,
          body: record.body,
          status: record.status as 'open' | 'in_progress' | 'resolved' | 'closed',
          visibility: record.visibility ?? 'private',
          requesterUid: record.requesterUid,
          assigneeUid: record.assigneeUid,
          dueAt: record.dueAt,
          scope: record.scope,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          likeCount: isPublic ? targetLikes.length : 0,
          replyCount: isPublic ? replyCount : 0,
          likedByViewer: isPublic && targetLikes.some((like) => like.userUid === actor.uid),
          canReply:
            isPublic ||
            record.requesterUid === actor.uid ||
            permitted(actor, 'information.consultation.triage', 'consultation', record.scope),
          canManage:
            record.requesterUid === actor.uid ||
            permitted(actor, 'information.consultation.triage', 'consultation', record.scope),
        };
      }),
    ];
    return items
      .filter((item) => {
        if (filter === 'official') return item.kind === 'announcement';
        if (filter === 'public_feedback')
          return item.kind === 'consultation' && item.visibility === 'public';
        if (filter === 'mine')
          return item.kind === 'consultation' && item.requesterUid === actor.uid;
        if (filter === 'in_progress')
          return item.kind === 'consultation' && item.status === 'in_progress';
        if (filter === 'resolved')
          return item.kind === 'consultation' && ['resolved', 'closed'].includes(item.status);
        return true;
      })
      .sort((left, right) => {
        const leftPinned = left.kind === 'announcement' && left.pinned;
        const rightPinned = right.kind === 'announcement' && right.pinned;
        if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }

  async getFeedDetail(
    actor: AuthorizationContext,
    kind: 'announcement' | 'consultation',
    id: string,
  ) {
    const item = (await this.listFeed(actor, 'all')).find(
      (candidate) => candidate.kind === kind && candidate.id === id,
    );
    if (!item) return null;
    const replies = (await this.store.informationReplies.list()).filter(
      (reply) => reply.targetType === kind && reply.targetId === id && reply.status === 'visible',
    );
    return {
      item: {
        ...item,
        replyCount: replies.length,
      },
      replies: replies
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((reply) => ({
          id: reply.id,
          targetType: reply.targetType,
          targetId: reply.targetId,
          authorUid: reply.authorUid,
          kind: reply.kind,
          body: reply.body,
          createdAt: reply.createdAt,
          updatedAt: reply.updatedAt,
        })),
    };
  }

  async createReply(
    actor: AuthorizationContext,
    kind: 'announcement' | 'consultation',
    id: string,
    input: { kind: 'reply' | 'supplement'; body: string },
  ) {
    const detail = await this.getFeedDetail(actor, kind, id);
    if (!detail || !detail.item.canReply) return null;
    if (
      input.kind === 'supplement' &&
      (detail.item.kind !== 'consultation' || detail.item.requesterUid !== actor.uid)
    ) {
      throw new HttpError(403, 'supplement_forbidden', 'Only the requester may add a supplement');
    }
    const scope =
      detail.item.kind === 'consultation' && detail.item.visibility === 'private'
        ? detail.item.scope
        : { type: 'public', id: '*' };
    return this.store.informationReplies.create({
      targetType: kind,
      targetId: id,
      authorUid: actor.uid,
      kind: input.kind,
      body: input.body,
      status: 'visible',
      ownerUid: actor.uid,
      scope,
    });
  }

  async setLike(
    actor: AuthorizationContext,
    kind: 'announcement' | 'consultation',
    id: string,
    liked: boolean,
  ): Promise<{ liked: boolean }> {
    const detail = await this.getFeedDetail(actor, kind, id);
    if (!detail) throw new HttpError(404, 'information_not_found', 'Information not found');
    if (detail.item.kind === 'consultation' && detail.item.visibility === 'private') {
      throw new HttpError(409, 'private_information_like', 'Private consultations cannot be liked');
    }
    const existing = (await this.store.informationLikes.list()).find(
      (like) => like.targetType === kind && like.targetId === id && like.userUid === actor.uid,
    );
    if (liked && !existing) {
      await this.store.informationLikes.create({
        targetType: kind,
        targetId: id,
        userUid: actor.uid,
        status: 'active',
        ownerUid: actor.uid,
        scope: { type: 'public', id: '*' },
      });
    }
    if (!liked && existing) await this.store.informationLikes.delete(existing.id);
    return { liked };
  }

  async listAnnouncements(
    filters: ListFilters,
    actor: AuthorizationContext | null,
  ): Promise<AnnouncementRecord[]> {
    const records = await this.store.announcements.list(filters);
    return records.filter(
      (record) =>
        (record.status === 'published' &&
          record.scope.type === 'public' &&
          record.scope.id === '*') ||
        (actor !== null &&
          (permitted(actor, 'information.announcement.create', 'announcement', record.scope) ||
            permitted(actor, 'information.announcement.publish', 'announcement', record.scope))),
    );
  }

  async createAnnouncement(
    actorUid: string,
    input: AnnouncementInput,
  ): Promise<AnnouncementRecord> {
    return this.store.announcements.create({ ...input, ownerUid: actorUid });
  }

  async updateAnnouncement(
    actor: AuthorizationContext,
    id: string,
    patch: AnnouncementPatch,
  ): Promise<AnnouncementRecord | null> {
    return this.store.transaction(async (transactionStore) => {
      const current = await transactionStore.announcements.getForUpdate(id);
      if (current === null) return null;
      const targetScope = patch.scope ?? current.scope;
      if (
        !permitted(actor, 'information.announcement.create', 'announcement', current.scope) ||
        !permitted(actor, 'information.announcement.create', 'announcement', targetScope) ||
        (current.status === 'published' &&
          (!permitted(actor, 'information.announcement.publish', 'announcement', current.scope) ||
            !permitted(actor, 'information.announcement.publish', 'announcement', targetScope)))
      ) {
        throw new HttpError(404, 'announcement_not_found', 'Announcement not found');
      }
      return transactionStore.announcements.update(id, patch);
    });
  }

  async transitionAnnouncement(
    actor: AuthorizationContext,
    id: string,
    to: AnnouncementStatus,
  ): Promise<AnnouncementRecord | null> {
    const result = await this.store.transaction<TransitionResult<AnnouncementRecord>>(
      async (transactionStore) => {
        const current = await transactionStore.announcements.getForUpdate(id);
        if (current === null) return { kind: 'missing' };
        if (!permitted(actor, 'information.announcement.publish', 'announcement', current.scope)) {
          throw new HttpError(404, 'announcement_not_found', 'Announcement not found');
        }
        const from = current.status as AnnouncementStatus;
        if (
          !Object.hasOwn(ANNOUNCEMENT_TRANSITIONS, from) ||
          !canTransition(ANNOUNCEMENT_TRANSITIONS, from, to)
        ) {
          return { kind: 'rejected', from, to, scope: current.scope };
        }
        const updated = await transactionStore.announcements.update(id, { status: to });
        if (updated === null) return { kind: 'missing' };
        await recordAuditEvent(transactionStore, {
          actorUid: actor.uid,
          action: 'information.announcement.status_changed',
          resourceType: 'announcement',
          resourceId: id,
          details: { from, to, outcome: 'accepted', scope: updated.scope },
        });
        return { kind: 'updated', record: updated };
      },
    );
    if (result.kind === 'missing') return null;
    if (result.kind === 'rejected') {
      await recordAuditEvent(this.store, {
        actorUid: actor.uid,
        action: 'information.announcement.status_changed',
        resourceType: 'announcement',
        resourceId: id,
        details: { from: result.from, to: result.to, outcome: 'rejected', scope: result.scope },
      });
      throw new HttpError(409, 'invalid_state_transition', 'Invalid announcement state transition');
    }
    return result.record;
  }

  async listConsultations(
    filters: ListFilters,
    actor: AuthorizationContext,
  ): Promise<ConsultationRecord[]> {
    const records = await this.store.consultations.list(filters);
    return records.filter(
      (record) =>
        record.requesterUid === actor.uid ||
        permitted(actor, 'information.consultation.read', 'consultation', record.scope) ||
        permitted(actor, 'information.consultation.triage', 'consultation', record.scope),
    );
  }

  async createConsultation(
    actorUid: string,
    input: ConsultationInput,
  ): Promise<ConsultationRecord> {
    return this.store.consultations.create({
      ...input,
      visibility: input.visibility ?? 'private',
      dueAt: null,
      requesterUid: actorUid,
      assigneeUid: null,
      reply: null,
      status: 'open',
      ownerUid: actorUid,
      scope: { type: 'user', id: actorUid },
    });
  }

  async updateConsultation(
    actor: AuthorizationContext,
    id: string,
    patch: ConsultationPatch,
  ): Promise<ConsultationRecord | null> {
    return this.store.transaction(async (transactionStore) => {
      const current = await transactionStore.consultations.getForUpdate(id);
      if (current === null) return null;
      const canEditOwnOpen =
        current.requesterUid === actor.uid &&
        current.status === 'open' &&
        permitted(actor, 'information.consultation.create', 'consultation', current.scope);
      if (!canEditOwnOpen) {
        throw new HttpError(404, 'consultation_not_found', 'Consultation not found');
      }
      if (current.visibility === 'public' && patch.visibility === 'private') {
        const replies = await transactionStore.informationReplies.listForUpdate();
        if (replies.some((reply) => reply.targetType === 'consultation' && reply.targetId === id)) {
          throw new HttpError(
            409,
            'visibility_locked',
            'Public feedback with replies cannot be made private',
          );
        }
      }
      return transactionStore.consultations.update(id, {
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.body === undefined ? {} : { body: patch.body }),
        ...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
      });
    });
  }

  async updateConsultationHandling(
    actor: AuthorizationContext,
    id: string,
    patch: ConsultationHandlingPatch,
  ): Promise<ConsultationRecord | null> {
    return this.store.transaction(async (transactionStore) => {
      const current = await transactionStore.consultations.getForUpdate(id);
      if (current === null) return null;
      if (!permitted(actor, 'information.consultation.triage', 'consultation', current.scope)) {
        throw new HttpError(404, 'consultation_not_found', 'Consultation not found');
      }
      if (patch.assigneeUid !== undefined && patch.assigneeUid !== null) {
        const subjects = await transactionStore.subjects.list({ query: patch.assigneeUid });
        if (!subjects.some((subject) => subject.uid === patch.assigneeUid)) {
          throw new HttpError(400, 'invalid_assignee', 'Assignee does not exist');
        }
      }
      const updated = await transactionStore.consultations.update(id, patch);
      if (updated === null) return null;
      await recordAuditEvent(transactionStore, {
        actorUid: actor.uid,
        action: 'information.consultation.handling_updated',
        resourceType: 'consultation',
        resourceId: id,
        details: { fields: Object.keys(patch).sort(), scope: current.scope },
      });
      return updated;
    });
  }

  async transitionConsultation(
    actor: AuthorizationContext,
    id: string,
    to: ConsultationStatus,
  ): Promise<ConsultationRecord | null> {
    const result = await this.store.transaction<TransitionResult<ConsultationRecord>>(
      async (transactionStore) => {
        const current = await transactionStore.consultations.getForUpdate(id);
        if (current === null) return { kind: 'missing' };
        if (!permitted(actor, 'information.consultation.triage', 'consultation', current.scope)) {
          throw new HttpError(404, 'consultation_not_found', 'Consultation not found');
        }
        const from = current.status as ConsultationStatus;
        if (
          !Object.hasOwn(CONSULTATION_TRANSITIONS, from) ||
          !canTransition(CONSULTATION_TRANSITIONS, from, to)
        ) {
          return { kind: 'rejected', from, to, scope: current.scope };
        }
        const updated = await transactionStore.consultations.update(id, { status: to });
        if (updated === null) return { kind: 'missing' };
        await recordAuditEvent(transactionStore, {
          actorUid: actor.uid,
          action: 'information.consultation.status_changed',
          resourceType: 'consultation',
          resourceId: id,
          details: { from, to, outcome: 'accepted', scope: current.scope },
        });
        return { kind: 'updated', record: updated };
      },
    );
    if (result.kind === 'missing') return null;
    if (result.kind === 'rejected') {
      await recordAuditEvent(this.store, {
        actorUid: actor.uid,
        action: 'information.consultation.status_changed',
        resourceType: 'consultation',
        resourceId: id,
        details: { from: result.from, to: result.to, outcome: 'rejected', scope: result.scope },
      });
      throw new HttpError(409, 'invalid_state_transition', 'Invalid consultation state transition');
    }
    return result.record;
  }
}
