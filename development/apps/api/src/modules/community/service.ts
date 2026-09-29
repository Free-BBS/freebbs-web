import type {
  CommunityChannel,
  CommunityComment,
  CommunityDisplayMode,
  CommunityFeedItem,
  CommunityPostKind,
  CommunitySupplement,
  CommunityThreadDetail,
  CommunityWishConversionInput,
  CommunityWishStatus,
  CreateCommunityCommentInput,
  CreateCommunityPostInput,
  SocialOrganizationId,
} from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  ActivityRecord,
  CommunityCommentRecord,
  CommunityPostRecord,
  CommunityWishWorkflowRecord,
  DevelopmentStore,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';

const publicScope = { type: 'public', id: '*' } as const;
const wishTransitions: Readonly<Record<CommunityWishStatus, readonly CommunityWishStatus[]>> = {
  collecting: ['responded'],
  responded: ['collecting', 'planning'],
  planning: ['responded', 'realized'],
  realized: [],
};

function allowed(actor: AuthorizationContext, action: string, resource: string): boolean {
  return authorize(actor, { action, resource }).allowed;
}

function forbidden(message = 'Community permission is required'): HttpError {
  return new HttpError(403, 'forbidden', message);
}

function missingPost(): HttpError {
  return new HttpError(404, 'community_post_not_found', 'Community post not found');
}

function missingWish(): HttpError {
  return new HttpError(404, 'community_wish_not_found', 'Community wish not found');
}

function uniqueTags(kind: CommunityPostKind, tags: readonly string[]): string[] {
  const systemTag =
    kind === 'wish' ? '新生许愿池' : kind === 'festival_showcase' ? '学生节舞台' : '校园日常';
  return [systemTag, ...tags.filter((tag) => tag !== systemTag)].filter(
    (tag, index, values) => values.indexOf(tag) === index,
  );
}

export class CommunityService {
  constructor(
    private readonly store: DevelopmentStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createPost(
    actor: AuthorizationContext,
    input: CreateCommunityPostInput,
  ): Promise<CommunityPostRecord> {
    if (!allowed(actor, 'community.post.create', 'community_post')) throw forbidden();
    return this.store.transaction(async (store) => {
      const post = await store.communityPosts.create({
        ...input,
        tags: uniqueTags(input.kind, input.tags),
        sourceType: null,
        sourceId: null,
        status: 'active',
        ownerUid: actor.uid,
        scope: publicScope,
      });
      if (input.displayMode === 'anonymous') await this.createFirstAlias(store, post.id, actor.uid);
      if (input.kind === 'wish') {
        await store.communityWishWorkflows.create({
          postId: post.id,
          wishStatus: 'collecting',
          officialResponse: null,
          responseByUid: null,
          conversionStatus: 'none',
          conversionPayload: null,
          activityId: null,
          status: 'active',
          ownerUid: actor.uid,
          scope: publicScope,
        });
      }
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'community.post.created',
        resourceType: 'community_post',
        resourceId: post.id,
        details: { kind: post.kind, displayMode: post.displayMode },
      });
      return post;
    });
  }

  async listFeed(actor: AuthorizationContext, channel: CommunityChannel): Promise<CommunityFeedItem[]> {
    const posts = (await this.store.communityPosts.list()).filter(
      (post) =>
        post.status === 'active' &&
        (channel === 'all' ||
          (channel === 'daily' && post.kind === 'daily') ||
          (channel === 'wishes' && post.kind === 'wish') ||
          (channel === 'student_festival' && post.kind === 'festival_showcase')),
    );
    if (channel === 'rights') return [];
    return Promise.all(posts.map((post) => this.toFeedItem(actor, post)));
  }

  async updatePost(
    actor: AuthorizationContext,
    postId: string,
    patch: { title?: string; body?: string; tags?: string[] },
  ): Promise<CommunityPostRecord> {
    return this.store.transaction(async (store) => {
      const post = await store.communityPosts.getForUpdate(postId);
      if (post === null || post.status !== 'active' || post.ownerUid !== actor.uid) {
        throw missingPost();
      }
      if (post.kind === 'wish') {
        const { workflow } = await this.findWish(store, postId, true);
        if (workflow.wishStatus !== 'collecting' || workflow.officialResponse !== null) {
          throw new HttpError(409, 'community_post_locked', 'Handled wishes use supplements');
        }
      }
      const updated = await store.communityPosts.update(postId, {
        ...patch,
        ...(patch.tags === undefined ? {} : { tags: uniqueTags(post.kind, patch.tags) }),
      });
      if (updated === null) throw missingPost();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'community.post.updated',
        resourceType: 'community_post',
        resourceId: postId,
        details: { fields: Object.keys(patch).sort() },
      });
      return updated;
    });
  }

  async deletePost(actor: AuthorizationContext, postId: string): Promise<void> {
    await this.store.transaction(async (store) => {
      const post = await store.communityPosts.getForUpdate(postId);
      if (
        post === null ||
        post.status !== 'active' ||
        (post.ownerUid !== actor.uid &&
          !allowed(actor, 'community.content.moderate', 'community_post'))
      ) {
        throw missingPost();
      }
      await store.communityPosts.update(postId, { status: 'deleted' });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'community.post.deleted',
        resourceType: 'community_post',
        resourceId: postId,
      });
    });
  }

  async getThread(actor: AuthorizationContext, postId: string): Promise<CommunityThreadDetail> {
    const post = await this.store.communityPosts.get(postId);
    if (post === null || post.status !== 'active') throw missingPost();
    const comments = (await this.store.communityComments.list({ query: postId })).filter(
      (comment) => comment.postId === postId && comment.status === 'active',
    );
    const supplements = (await this.store.communitySupplements.list({ query: postId })).filter(
      (supplement) => supplement.postId === postId && supplement.status === 'active',
    );
    return {
      item: await this.toFeedItem(actor, post),
      comments: await Promise.all(comments.map((comment) => this.toComment(actor, comment))),
      supplements: supplements.map(
        (supplement): CommunitySupplement => ({
          id: supplement.id,
          postId: supplement.postId,
          body: supplement.body,
          createdAt: supplement.createdAt,
          updatedAt: supplement.updatedAt,
        }),
      ),
    };
  }

  async createComment(
    actor: AuthorizationContext,
    postId: string,
    input: CreateCommunityCommentInput,
  ): Promise<CommunityComment> {
    if (!allowed(actor, 'community.post.interact', 'community_post')) throw forbidden();
    return this.store.transaction(async (store) => {
      const post = await store.communityPosts.getForUpdate(postId);
      if (post === null || post.status !== 'active') throw missingPost();
      if (input.parentId !== null) {
        const parent = await store.communityComments.getForUpdate(input.parentId);
        if (parent === null || parent.postId !== postId || parent.status !== 'active') {
          throw new HttpError(400, 'invalid_parent_comment', 'Parent comment is invalid');
        }
      }
      if (input.displayMode === 'anonymous') await this.ensureAlias(store, postId, actor.uid);
      const comment = await store.communityComments.create({
        postId,
        parentId: input.parentId,
        authorUid: actor.uid,
        body: input.body,
        displayMode: input.displayMode,
        status: 'active',
        ownerUid: actor.uid,
        scope: publicScope,
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'community.comment.created',
        resourceType: 'community_comment',
        resourceId: comment.id,
        details: { postId, displayMode: comment.displayMode },
      });
      return this.toComment(actor, comment, store);
    });
  }

  async createSupplement(actor: AuthorizationContext, postId: string, body: string) {
    return this.store.transaction(async (store) => {
      const post = await store.communityPosts.getForUpdate(postId);
      if (post === null || post.status !== 'active') throw missingPost();
      if (post.ownerUid !== actor.uid) throw missingPost();
      const supplement = await store.communitySupplements.create({
        postId,
        authorUid: actor.uid,
        body,
        status: 'active',
        ownerUid: actor.uid,
        scope: publicScope,
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'community.supplement.created',
        resourceType: 'community_supplement',
        resourceId: supplement.id,
        details: { postId },
      });
      return supplement;
    });
  }

  async setLike(
    actor: AuthorizationContext,
    targetType: 'post' | 'comment',
    targetId: string,
    enabled: boolean,
  ) {
    if (!allowed(actor, 'community.post.interact', 'community_post')) throw forbidden();
    return this.store.transaction(async (store) => {
      if (targetType === 'post') {
        const post = await store.communityPosts.getForUpdate(targetId);
        if (post === null || post.status !== 'active') throw missingPost();
      } else {
        const comment = await store.communityComments.getForUpdate(targetId);
        if (comment === null || comment.status !== 'active') throw missingPost();
      }
      const existing = (await store.communityLikes.listForUpdate({ query: targetId })).find(
        (like) =>
          like.targetType === targetType &&
          like.targetId === targetId &&
          like.userUid === actor.uid,
      );
      if (existing !== undefined) {
        return store.communityLikes.update(existing.id, { status: enabled ? 'active' : 'inactive' });
      }
      if (!enabled) return null;
      return store.communityLikes.create({
        targetType,
        targetId,
        userUid: actor.uid,
        status: 'active',
        ownerUid: actor.uid,
        scope: publicScope,
      });
    });
  }

  async report(actor: AuthorizationContext, postId: string, reason: string) {
    if (!allowed(actor, 'community.post.report', 'community_post')) throw forbidden();
    const post = await this.store.communityPosts.get(postId);
    if (post === null || post.status !== 'active') throw missingPost();
    return this.store.communityReports.create({
      postId,
      reporterUid: actor.uid,
      reason,
      resolution: null,
      handledByUid: null,
      status: 'open',
      ownerUid: actor.uid,
      scope: { type: 'user', id: actor.uid },
    });
  }

  async recordView(actor: AuthorizationContext, postId: string): Promise<void> {
    const post = await this.store.communityPosts.get(postId);
    if (post === null || post.status !== 'active') throw missingPost();
    const bucketTime = this.now().getTime();
    const bucketStart = new Date(bucketTime - (bucketTime % (30 * 60 * 1000))).toISOString();
    await this.store.transaction(async (store) => {
      const existing = (await store.communityViews.listForUpdate({ query: postId })).find(
        (view) =>
          view.postId === postId &&
          view.userUid === actor.uid &&
          view.bucketStart === bucketStart,
      );
      if (existing !== undefined) return;
      await store.communityViews.create({
        postId,
        userUid: actor.uid,
        bucketStart,
        status: 'active',
        ownerUid: actor.uid,
        scope: publicScope,
      });
    });
  }

  async respondToWish(actor: AuthorizationContext, postId: string, response: string) {
    if (!allowed(actor, 'community.wish.respond', 'community_wish')) throw forbidden();
    return this.updateWish(actor, postId, async (store, workflow) =>
      store.communityWishWorkflows.update(workflow.id, {
        officialResponse: response,
        responseByUid: actor.uid,
        wishStatus: workflow.wishStatus === 'collecting' ? 'responded' : workflow.wishStatus,
      }),
    );
  }

  async transitionWish(actor: AuthorizationContext, postId: string, to: CommunityWishStatus) {
    if (!allowed(actor, 'community.wish.transition', 'community_wish')) throw forbidden();
    return this.updateWish(actor, postId, async (store, workflow) => {
      if (!wishTransitions[workflow.wishStatus].includes(to)) {
        throw new HttpError(409, 'invalid_wish_transition', 'Wish transition is invalid');
      }
      if (to === 'realized' && !allowed(actor, 'community.wish.convert.approve', 'community_wish')) {
        throw forbidden('Leader approval is required');
      }
      return store.communityWishWorkflows.update(workflow.id, { wishStatus: to });
    });
  }

  async requestWishConversion(
    actor: AuthorizationContext,
    postId: string,
    payload: CommunityWishConversionInput,
  ) {
    if (!allowed(actor, 'community.wish.convert.request', 'community_wish')) throw forbidden();
    if (payload.organizationId !== 'tuanwei' && !actor.roles.includes('platform.super_admin')) {
      throw forbidden('The selected organization is not available');
    }
    return this.updateWish(actor, postId, async (store, workflow) => {
      if (workflow.activityId !== null) return workflow;
      return store.communityWishWorkflows.update(workflow.id, {
        conversionStatus: 'requested',
        conversionPayload: payload,
      });
    });
  }

  async approveWishConversion(
    actor: AuthorizationContext,
    postId: string,
  ): Promise<ActivityRecord> {
    if (!allowed(actor, 'community.wish.convert.approve', 'community_wish')) throw forbidden();
    return this.store.transaction(async (store) => {
      const { workflow } = await this.findWish(store, postId, true);
      if (workflow.activityId !== null) {
        const existing = await store.activities.get(workflow.activityId);
        if (existing !== null) return existing;
      }
      if (workflow.conversionStatus !== 'requested' || workflow.conversionPayload === null) {
        throw new HttpError(409, 'conversion_not_requested', 'Wish conversion was not requested');
      }
      const payload = workflow.conversionPayload;
      const activity = await store.activities.create({
        title: payload.title,
        description: payload.description,
        clubId: null,
        startsAt: payload.startsAt,
        endsAt: null,
        location: '',
        organizationId: payload.organizationId as SocialOrganizationId,
        standingActivity: false,
        sourceCommunityPostId: postId,
        technicalSupportStatus: 'not_requested',
        technicalSupportNote: null,
        status: 'draft',
        ownerUid: actor.uid,
        scope: publicScope,
      });
      await store.communityWishWorkflows.update(workflow.id, {
        conversionStatus: 'approved',
        wishStatus: 'planning',
        activityId: activity.id,
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'community.wish.converted',
        resourceType: 'community_post',
        resourceId: postId,
        details: { activityId: activity.id, organizationId: activity.organizationId },
      });
      return activity;
    });
  }

  private async updateWish<T>(
    actor: AuthorizationContext,
    postId: string,
    update: (
      store: DevelopmentStore,
      workflow: CommunityWishWorkflowRecord,
    ) => Promise<T>,
  ): Promise<T> {
    return this.store.transaction(async (store) => {
      const { workflow } = await this.findWish(store, postId, true);
      const result = await update(store, workflow);
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'community.wish.updated',
        resourceType: 'community_post',
        resourceId: postId,
        details: { previousStatus: workflow.wishStatus },
      });
      return result;
    });
  }

  private async findWish(store: DevelopmentStore, postId: string, forUpdate = false) {
    const post = forUpdate
      ? await store.communityPosts.getForUpdate(postId)
      : await store.communityPosts.get(postId);
    if (post === null || post.kind !== 'wish' || post.status !== 'active') throw missingWish();
    const workflows = forUpdate
      ? await store.communityWishWorkflows.listForUpdate({ query: postId })
      : await store.communityWishWorkflows.list({ query: postId });
    const workflow = workflows.find((candidate) => candidate.postId === postId);
    if (workflow === undefined) throw missingWish();
    return { post, workflow };
  }

  private async toFeedItem(
    actor: AuthorizationContext,
    post: CommunityPostRecord,
  ): Promise<CommunityFeedItem> {
    const likes = (await this.store.communityLikes.list({ query: post.id })).filter(
      (like) => like.targetType === 'post' && like.targetId === post.id && like.status === 'active',
    );
    const comments = (await this.store.communityComments.list({ query: post.id })).filter(
      (comment) => comment.postId === post.id && comment.status === 'active',
    );
    const workflow =
      post.kind === 'wish'
        ? (await this.store.communityWishWorkflows.list({ query: post.id })).find(
            (candidate) => candidate.postId === post.id,
          )
        : undefined;
    const interact = allowed(actor, 'community.post.interact', 'community_post');
    const owner = post.ownerUid === actor.uid;
    return {
      id: post.id,
      kind: post.kind,
      title: post.title,
      body: post.body,
      tags: post.tags,
      author: await this.author(actor, post.id, post.ownerUid, post.displayMode),
      status: post.status,
      wishStatus: workflow?.wishStatus ?? null,
      officialResponse: workflow?.officialResponse ?? null,
      linkedActivityId: workflow?.activityId ?? null,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      likeCount: likes.length,
      commentCount: comments.length,
      likedByViewer: likes.some((like) => like.userUid === actor.uid),
      capabilities: {
        canEdit: owner,
        canDelete: owner || allowed(actor, 'community.content.moderate', 'community_post'),
        canComment: interact,
        canSupplement: owner,
        canReport: allowed(actor, 'community.post.report', 'community_post') && !owner,
        canModerate: allowed(actor, 'community.content.moderate', 'community_post'),
        canRespondToWish:
          post.kind === 'wish' && allowed(actor, 'community.wish.respond', 'community_wish'),
        canTransitionWish:
          post.kind === 'wish' && allowed(actor, 'community.wish.transition', 'community_wish'),
        canRequestConversion:
          post.kind === 'wish' &&
          allowed(actor, 'community.wish.convert.request', 'community_wish'),
        canApproveConversion:
          post.kind === 'wish' &&
          allowed(actor, 'community.wish.convert.approve', 'community_wish'),
      },
    };
  }

  private async toComment(
    actor: AuthorizationContext,
    comment: CommunityCommentRecord,
    store: DevelopmentStore = this.store,
  ): Promise<CommunityComment> {
    const likes = (await store.communityLikes.list({ query: comment.id })).filter(
      (like) =>
        like.targetType === 'comment' && like.targetId === comment.id && like.status === 'active',
    );
    return {
      id: comment.id,
      postId: comment.postId,
      parentId: comment.parentId,
      body: comment.body,
      author: await this.author(
        actor,
        comment.postId,
        comment.authorUid,
        comment.displayMode,
        store,
      ),
      status: comment.status,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      likeCount: likes.length,
      likedByViewer: likes.some((like) => like.userUid === actor.uid),
    };
  }

  private async author(
    actor: AuthorizationContext,
    threadId: string,
    uid: string,
    mode: CommunityDisplayMode,
    store: DevelopmentStore = this.store,
  ) {
    if (mode === 'anonymous') {
      const alias = (await store.communityAliases.list({ query: threadId })).find(
        (candidate) => candidate.threadId === threadId && candidate.userUid === uid,
      );
      return {
        mode,
        displayName: `匿名小羊 ${alias?.aliasIndex ?? 1}`,
        avatarUrl: null,
        isViewer: uid === actor.uid,
      } as const;
    }
    const subject = (await store.subjects.list({ query: uid })).find(
      (candidate) => candidate.uid === uid,
    );
    return {
      mode,
      displayName: subject?.displayName ?? '同学',
      avatarUrl: subject?.avatarUrl ?? null,
      isViewer: uid === actor.uid,
    } as const;
  }

  private async createFirstAlias(store: DevelopmentStore, threadId: string, uid: string) {
    return store.communityAliases.create({
      threadId,
      userUid: uid,
      aliasIndex: 1,
      status: 'active',
      ownerUid: uid,
      scope: { type: 'community_thread', id: threadId },
    });
  }

  private async ensureAlias(store: DevelopmentStore, threadId: string, uid: string) {
    const aliases = await store.communityAliases.listForUpdate({ query: threadId });
    const existing = aliases.find(
      (alias) => alias.threadId === threadId && alias.userUid === uid,
    );
    if (existing !== undefined) return existing;
    const next =
      Math.max(
        0,
        ...aliases.filter((alias) => alias.threadId === threadId).map(({ aliasIndex }) => aliasIndex),
      ) + 1;
    return store.communityAliases.create({
      threadId,
      userUid: uid,
      aliasIndex: next,
      status: 'active',
      ownerUid: uid,
      scope: { type: 'community_thread', id: threadId },
    });
  }
}
