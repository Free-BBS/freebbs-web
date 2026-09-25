import {
  canReviewFestival,
  type FestivalSubmission,
  type FestivalSubmissionList,
} from '@freebbs-development/contracts';
import { recordAuditEvent } from '../../core/audit/audit-service.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { DevelopmentStore, FestivalSubmissionRecord } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';

export const canViewFestivalMedia = (
  actor: AuthorizationContext,
  record: FestivalSubmissionRecord,
) => canReviewFestival(actor) || (record.displayConsent && record.status === 'approved');
function dto(actor: AuthorizationContext, record: FestivalSubmissionRecord): FestivalSubmission {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    authorName: record.authorName,
    ownerUid: record.ownerUid,
    status: record.status,
    displayConsent: record.displayConsent,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    reviewedAt: record.reviewedAt,
    reviewNote: actor.uid === record.ownerUid || canReviewFestival(actor) ? record.reviewNote : '',
    canViewMedia: canViewFestivalMedia(actor, record),
  };
}
export class FestivalService {
  constructor(
    private readonly store: DevelopmentStore,
    private readonly maxUploadBytes: number,
  ) {}
  async list(
    actor: AuthorizationContext,
    view: 'showcase' | 'mine' | 'review',
    page: number,
  ): Promise<FestivalSubmissionList> {
    const canReview = canReviewFestival(actor);
    if (view === 'review' && !canReview)
      throw new HttpError(403, 'review_forbidden', '只有文艺部及相关负责人可以查看投稿审核。');
    const records = (
      await this.store.festivalSubmissions.list(
        view === 'showcase' ? { status: 'approved' } : undefined,
      )
    )
      .filter((record) =>
        view === 'showcase'
          ? record.displayConsent && record.status === 'approved'
          : view === 'mine'
            ? record.ownerUid === actor.uid
            : true,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return {
      items: records.slice((page - 1) * 12, page * 12).map((record) => dto(actor, record)),
      total: records.length,
      page,
      pageSize: 12,
      canReview,
      maxUploadBytes: this.maxUploadBytes,
    };
  }
  async create(
    actor: AuthorizationContext,
    input: {
      title: string;
      description: string;
      displayConsent: boolean;
      storageKey: string;
      mimeType: string;
      sizeBytes: number;
    },
  ): Promise<FestivalSubmission> {
    return this.store.transaction(async (store) => {
      const record = await store.festivalSubmissions.create({
        ...input,
        status: input.displayConsent ? 'pending' : 'private',
        ownerUid: actor.uid,
        authorName: actor.displayName,
        scope: { type: 'social_organization', id: 'arts_center' },
        reviewerUid: null,
        reviewedAt: null,
        reviewNote: '',
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'festival.submitted',
        resourceType: 'festival_submission',
        resourceId: record.id,
        details: {
          status: record.status,
          displayConsent: record.displayConsent,
          sizeBytes: record.sizeBytes,
        },
      });
      return dto(actor, record);
    });
  }
  async review(
    actor: AuthorizationContext,
    id: string,
    decision: 'approve' | 'reject' | 'unpublish' | 'reapprove',
    note: string,
  ): Promise<FestivalSubmission> {
    if (!canReviewFestival(actor))
      throw new HttpError(403, 'review_forbidden', '只有文艺部及相关负责人可以审核作品。');
    return this.store.transaction(async (store) => {
      const current = await store.festivalSubmissions.getForUpdate(id);
      if (!current) throw new HttpError(404, 'submission_not_found', '投稿不存在。');
      const expectedStatus =
        decision === 'unpublish' ? 'approved' : decision === 'reapprove' ? 'rejected' : 'pending';
      if (!current.displayConsent || current.status !== expectedStatus)
        throw new HttpError(
          409,
          'invalid_review_transition',
          '作品未同意展示或状态已变化，请刷新后重试。',
        );
      const status = decision === 'approve' || decision === 'reapprove' ? 'approved' : 'rejected';
      const updated = await store.festivalSubmissions.update(id, {
        status,
        reviewedAt: new Date().toISOString(),
        reviewerUid: actor.uid,
        reviewNote: note,
      });
      if (!updated) throw new HttpError(404, 'submission_not_found', '投稿不存在。');
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: `festival.${decision}`,
        resourceType: 'festival_submission',
        resourceId: id,
        details: { from: current.status, to: status },
      });
      return dto(actor, updated);
    });
  }
  async media(actor: AuthorizationContext, id: string): Promise<FestivalSubmissionRecord> {
    const record = await this.store.festivalSubmissions.get(id);
    if (!record || !canViewFestivalMedia(actor, record))
      throw new HttpError(404, 'video_not_found', '视频不存在或暂不可查看。');
    return record;
  }
}
