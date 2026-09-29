import { describe, expect, it } from 'vitest';

import { BASE_STUDENT_PERMISSIONS, ROLE_PERMISSION_CATALOG } from '../../core/authorization/permission-catalog.js';
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
    expect((await store.activities.list()).filter(({ sourceCommunityPostId }) => sourceCommunityPostId === post.id)).toHaveLength(1);
    expect((await service.getThread(student, post.id)).item).toMatchObject({
      wishStatus: 'planning',
      linkedActivityId: first.id,
      officialResponse: '新生组正在联系讲师。',
    });
  });
});
