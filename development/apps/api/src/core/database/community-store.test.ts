import { describe, expect, it } from 'vitest';

import { createMemoryStore } from './memory-store.js';
import { RecordConflictError } from './record-conflict-error.js';

const publicScope = { type: 'public', id: '*' } as const;

describe('community store', () => {
  it('persists a post and its wish workflow', async () => {
    const store = createMemoryStore({ seed: false });
    const post = await store.communityPosts.create({
      kind: 'wish',
      title: '滑冰工作坊',
      body: '希望学习基础动作。',
      tags: ['新生许愿池'],
      displayMode: 'anonymous',
      sourceType: null,
      sourceId: null,
      status: 'active',
      ownerUid: 'student-a',
      scope: publicScope,
    });
    const workflow = await store.communityWishWorkflows.create({
      postId: post.id,
      wishStatus: 'collecting',
      officialResponse: null,
      responseByUid: null,
      conversionStatus: 'none',
      conversionPayload: null,
      activityId: null,
      status: 'active',
      ownerUid: 'student-a',
      scope: publicScope,
    });

    expect(await store.communityPosts.get(post.id)).toMatchObject({ kind: 'wish' });
    expect(await store.communityWishWorkflows.get(workflow.id)).toMatchObject({
      postId: post.id,
      wishStatus: 'collecting',
    });
  });

  it('enforces one active identity per like, alias, workflow, and converted activity', async () => {
    const store = createMemoryStore({ seed: false });
    const like = {
      targetType: 'post' as const,
      targetId: 'post-a',
      userUid: 'student-a',
      status: 'active',
      ownerUid: 'student-a',
      scope: publicScope,
    };
    const alias = {
      threadId: 'post-a',
      userUid: 'student-a',
      aliasIndex: 1,
      status: 'active',
      ownerUid: 'student-a',
      scope: publicScope,
    };
    const workflow = {
      postId: 'post-a',
      wishStatus: 'collecting' as const,
      officialResponse: null,
      responseByUid: null,
      conversionStatus: 'none' as const,
      conversionPayload: null,
      activityId: null,
      status: 'active',
      ownerUid: 'student-a',
      scope: publicScope,
    };

    await store.communityLikes.create(like);
    await expect(store.communityLikes.create(like)).rejects.toBeInstanceOf(RecordConflictError);
    await store.communityAliases.create(alias);
    await expect(store.communityAliases.create(alias)).rejects.toBeInstanceOf(RecordConflictError);
    await store.communityWishWorkflows.create(workflow);
    await expect(store.communityWishWorkflows.create(workflow)).rejects.toBeInstanceOf(
      RecordConflictError,
    );

    const activity = {
      title: '滑冰工作坊',
      description: '从许愿池转来的草稿',
      clubId: null,
      startsAt: null,
      endsAt: null,
      location: '',
      organizationId: 'tuanwei' as const,
      standingActivity: false,
      sourceCommunityPostId: 'post-a',
      technicalSupportStatus: 'not_requested' as const,
      technicalSupportNote: null,
      status: 'draft',
      ownerUid: 'freshman-leader',
      scope: publicScope,
    };
    await store.activities.create(activity);
    await expect(store.activities.create(activity)).rejects.toBeInstanceOf(RecordConflictError);
  });
});
