import { describe, expect, it } from 'vitest';

import {
  BASE_STUDENT_PERMISSIONS,
  ROLE_PERMISSION_CATALOG,
} from '../../core/authorization/permission-catalog.js';
import type { AuthorizationContext, PermissionRule } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { HttpError } from '../../core/errors/http-error.js';
import { CommunityService } from './service.js';

import type { RoleKey } from '@freebbs-development/contracts';
import type { DevelopmentStore } from '../../core/database/types.js';

const now = () => new Date('2026-09-29T12:00:00.000Z');

function actor(uid: string, role?: RoleKey): AuthorizationContext {
  const roleRules: readonly PermissionRule[] = role ? ROLE_PERMISSION_CATALOG[role] : [];
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: role ? [role] : [],
    tags: [],
    policies: [...BASE_STUDENT_PERMISSIONS, ...roleRules].map((rule, index) => ({
      ...rule,
      id: `test-${uid}-${index}`,
      effect: 'allow' as const,
    })),
  };
}

async function addSubject(store: DevelopmentStore, context: AuthorizationContext) {
  await store.subjects.create({
    uid: context.uid,
    displayName: context.displayName,
    avatarUrl: context.avatarUrl,
    status: 'active',
    ownerUid: context.uid,
    scope: { type: 'public', id: '*' },
  });
}

describe('community service', () => {
  async function wishFixture(...contexts: AuthorizationContext[]) {
    const store = createMemoryStore({ seed: false });
    const student = actor('wish-author');
    for (const context of [student, ...contexts]) await addSubject(store, context);
    const service = new CommunityService(store, now);
    const post = await service.createPost(student, {
      kind: 'wish',
      title: '新生工作坊',
      body: '希望一起学习。',
      tags: [],
      displayMode: 'named',
    });
    return { store, service, post };
  }
  it.each(['counselor.youth_league_secretary', 'counselor.youth_league'] as const)(
    'keeps global supervisor %s able to handle and convert wishes',
    async (role) => {
      const supervisor = actor('global-supervisor', role);
      const { service, post } = await wishFixture(supervisor);
      await service.respondToWish(supervisor, post.id, '已安排。');
      await service.requestWishConversion(supervisor, post.id, {
        title: '实践活动',
        description: '活动内容',
        organizationId: 'sast',
        startsAt: null,
      });
      expect(await service.approveWishConversion(supervisor, post.id)).toMatchObject({
        organizationId: 'sast',
      });
    },
  );
  it.each([
    'counselor.practice',
    'counselor.innovation',
    'youth_league.organization.member',
    'science_association.chair',
  ] as const)('does not give %s newcomer workflow authority', async (role) => {
    const foreign = actor('foreign', role);
    const { service, post } = await wishFixture(foreign);
    await expect(service.respondToWish(foreign, post.id, '越权')).rejects.toMatchObject({
      status: 403,
    });
    expect((await service.getThread(foreign, post.id)).item.capabilities.canRespondToWish).toBe(
      false,
    );
  });
  it.each(['student_union.executive_president', 'student_union.presidium'] as const)(
    'allows %s conversion only to an explicitly owned union center',
    async (role) => {
      const supervisor = actor('union-supervisor', role);
      const { service, post, store } = await wishFixture(supervisor);
      await expect(
        service.respondToWish(supervisor, post.id, '非新生组回应'),
      ).rejects.toMatchObject({ status: 403 });
      expect((await service.getThread(supervisor, post.id)).item.capabilities).toMatchObject({
        canRespondToWish: false,
        canRequestConversion: true,
      });
      const payload = {
        title: '校园活动',
        description: '活动内容',
        organizationId: 'arts_center',
        startsAt: null,
      };
      await service.requestWishConversion(supervisor, post.id, payload);
      const audit = await store.auditLogs.list();
      await expect(
        service.requestWishConversion(supervisor, post.id, { ...payload, organizationId: 'sast' }),
      ).rejects.toMatchObject({ status: 403 });
      expect(await store.auditLogs.list()).toEqual(audit);
      expect(await service.approveWishConversion(supervisor, post.id)).toMatchObject({
        organizationId: 'arts_center',
      });
    },
  );
  it('rechecks the selected conversion target before approval and an idempotent retry', async () => {
    const global = actor('global', 'counselor.youth_league');
    const newcomer = actor('newcomer', 'youth_league.freshman.leader');
    const { service, store, post } = await wishFixture(global, newcomer);
    await service.requestWishConversion(global, post.id, {
      title: '科协活动',
      description: '活动内容',
      organizationId: 'sast',
      startsAt: null,
    });
    const audit = await store.auditLogs.list();
    await expect(service.approveWishConversion(newcomer, post.id)).rejects.toMatchObject({
      status: 403,
    });
    expect(await store.activities.list()).toEqual([]);
    expect(await store.auditLogs.list()).toEqual(audit);
    await service.approveWishConversion(global, post.id);
    await expect(service.approveWishConversion(newcomer, post.id)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('checks the existing linked activity target during an idempotent approval', async () => {
    const newcomer = actor('newcomer', 'youth_league.freshman.leader');
    const { service, store, post } = await wishFixture(newcomer);
    await service.requestWishConversion(newcomer, post.id, {
      title: '活动',
      description: '活动内容',
      organizationId: 'tuanwei',
      startsAt: null,
    });
    const activity = await service.approveWishConversion(newcomer, post.id);
    await store.activities.update(activity.id, { organizationId: 'sast' });
    await expect(service.approveWishConversion(newcomer, post.id)).rejects.toMatchObject({
      status: 403,
    });
  });
  it.each(['public', 'department', 'social_organization'] as const)(
    'lets a %s scope deny beat a scoped newcomer allow',
    async (scopeType) => {
      const newcomer = actor('newcomer', 'youth_league.freshman.leader');
      newcomer.policies!.push({
        id: 'newcomer-deny',
        action: 'community.wish.*',
        resource: 'community_wish',
        effect: 'deny',
        scope: {
          type: scopeType,
          id:
            scopeType === 'public'
              ? '*'
              : scopeType === 'department'
                ? 'youth_league.freshman'
                : 'tuanwei',
        },
      });
      const { service, store, post } = await wishFixture(newcomer);
      const audit = await store.auditLogs.list();
      await expect(service.respondToWish(newcomer, post.id, '禁止回应')).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        service.requestWishConversion(newcomer, post.id, {
          title: '新生活动',
          description: '活动内容',
          organizationId: 'tuanwei',
          startsAt: null,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(await store.auditLogs.list()).toEqual(audit);
    },
  );
  it('keeps anonymous identities stable inside a thread and redacts real ids', async () => {
    const store = createMemoryStore({ seed: false });
    const author = actor('student-a');
    const viewer = actor('student-b');
    await addSubject(store, author);
    await addSubject(store, viewer);
    const service = new CommunityService(store, now);

    const post = await service.createPost(author, {
      kind: 'wish',
      title: '想要滑冰工作坊',
      body: '希望从基础装备开始。',
      tags: ['运动'],
      displayMode: 'anonymous',
    });
    await service.createComment(author, post.id, {
      body: '我可以补充场地建议。',
      parentId: null,
      displayMode: 'anonymous',
    });
    const thread = await service.getThread(viewer, post.id);

    expect(thread.item.tags).toEqual(['新生许愿池', '运动']);
    expect(thread.item.author).toEqual({
      mode: 'anonymous',
      displayName: '匿名小羊 1',
      avatarUrl: null,
      isViewer: false,
    });
    expect(thread.comments[0]?.author.displayName).toBe('匿名小羊 1');
    expect(thread.item.author).not.toHaveProperty('uid');
    expect(thread.comments[0]?.author).not.toHaveProperty('uid');
  });

  it('supports supplements, likes, reports, and capability-driven feed cards', async () => {
    const store = createMemoryStore({ seed: false });
    const author = actor('student-a');
    const viewer = actor('student-b');
    await addSubject(store, author);
    await addSubject(store, viewer);
    const service = new CommunityService(store, now);
    const post = await service.createPost(author, {
      kind: 'daily',
      title: '今天草坪见',
      body: '欢迎带上桌游。',
      tags: ['校园日常'],
      displayMode: 'named',
    });

    await service.createSupplement(author, post.id, '时间改为晚上七点。');
    await service.setLike(viewer, 'post', post.id, true);
    await service.report(viewer, post.id, '信息可能过期');
    const [card] = await service.listFeed(viewer, 'daily');
    const detail = await service.getThread(author, post.id);

    expect(card).toMatchObject({ likeCount: 1, likedByViewer: true });
    expect(card?.capabilities).toMatchObject({ canEdit: false, canComment: true });
    expect(detail.item.capabilities).toMatchObject({ canEdit: true, canSupplement: true });
    expect(detail.supplements).toHaveLength(1);
    expect(await store.communityReports.list()).toHaveLength(1);
  });

  it('requires newcomer roles for workflow actions and leader approval', async () => {
    const store = createMemoryStore({ seed: false });
    const student = actor('student-a');
    const member = actor('freshman-member', 'youth_league.freshman.member');
    const leader = actor('freshman-leader', 'youth_league.freshman.leader');
    for (const context of [student, member, leader]) await addSubject(store, context);
    const service = new CommunityService(store, now);
    const post = await service.createPost(student, {
      kind: 'wish',
      title: 'Unity 工作坊',
      body: '希望做一个入门实践。',
      tags: [],
      displayMode: 'named',
    });

    await expect(service.respondToWish(student, post.id, '收到')).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
    await service.respondToWish(member, post.id, '新生组正在联系讲师。');
    await service.requestWishConversion(member, post.id, {
      title: 'Unity 入门工作坊',
      description: '从界面和场景搭建开始。',
      organizationId: 'tuanwei',
      startsAt: null,
    });
    expect((await service.getThread(member, post.id)).item.conversionStatus).toBe('requested');
    await expect(service.approveWishConversion(member, post.id)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);

    const first = await service.approveWishConversion(leader, post.id);
    const second = await service.approveWishConversion(leader, post.id);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({
      status: 'draft',
      sourceCommunityPostId: post.id,
      organizationId: 'tuanwei',
    });
    expect(
      (await store.activities.list()).filter(
        ({ sourceCommunityPostId }) => sourceCommunityPostId === post.id,
      ),
    ).toHaveLength(1);
    expect((await service.getThread(student, post.id)).item).toMatchObject({
      wishStatus: 'planning',
      linkedActivityId: first.id,
      officialResponse: '新生组正在联系讲师。',
    });
  });
});
