import { describe, expect, it } from 'vitest';

import {
  COMMUNITY_CHANNELS,
  COMMUNITY_POST_KINDS,
  COMMUNITY_WISH_STATUSES,
  type CommunityFeedItem,
} from './community.js';

describe('community contracts', () => {
  it('defines independent feed kinds, channels, and the four wish states', () => {
    expect(COMMUNITY_POST_KINDS).toEqual(['daily', 'wish', 'festival_showcase']);
    expect(COMMUNITY_CHANNELS).toEqual(['all', 'daily', 'wishes', 'student_festival', 'rights']);
    expect(COMMUNITY_WISH_STATUSES).toEqual(['collecting', 'responded', 'planning', 'realized']);
  });

  it('represents an anonymous wish without exposing a real author identifier', () => {
    const item: CommunityFeedItem = {
      id: 'post-1',
      kind: 'wish',
      title: '想要滑冰工作坊',
      body: '希望可以认识基础装备和动作。',
      tags: ['新生许愿池'],
      author: { mode: 'anonymous', displayName: '匿名小羊 1', avatarUrl: null, isViewer: false },
      status: 'active',
      wishStatus: 'collecting',
      officialResponse: null,
      conversionStatus: 'none',
      linkedActivityId: null,
      createdAt: '2026-09-29T00:00:00.000Z',
      updatedAt: '2026-09-29T00:00:00.000Z',
      likeCount: 0,
      commentCount: 0,
      likedByViewer: false,
      capabilities: {
        canEdit: false,
        canDelete: false,
        canComment: true,
        canSupplement: false,
        canReport: true,
        canModerate: false,
        canRespondToWish: false,
        canTransitionWish: false,
        canRequestConversion: false,
        canApproveConversion: false,
      },
    };

    expect(item.author).not.toHaveProperty('uid');
    expect(item.wishStatus).toBe('collecting');
  });
});
