import { describe, expect, it } from 'vitest';

import type { CommunityFeedItem } from '@freebbs-development/contracts';
import {
  COMMUNITY_CHANNEL_OPTIONS,
  toggleFeedLike,
  wishStatusLabel,
} from './community-view-model.js';

const item: CommunityFeedItem = {
  id: 'post-1',
  kind: 'wish',
  title: '滑冰工作坊',
  body: '想学习基础动作。',
  tags: ['新生许愿池'],
  author: { mode: 'anonymous', displayName: '匿名小羊 1', avatarUrl: null, isViewer: false },
  status: 'active',
  wishStatus: 'collecting',
  officialResponse: null,
  conversionStatus: 'none',
  linkedActivityId: null,
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
  likeCount: 2,
  commentCount: 1,
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

describe('community view model', () => {
  it('keeps the five agreed channels in a stable order', () => {
    expect(COMMUNITY_CHANNEL_OPTIONS.map(({ label }) => label)).toEqual([
      '综合',
      '校园日常',
      '新生许愿池',
      '学生节舞台',
      '生权反馈',
    ]);
  });

  it('uses readable labels for every wish state', () => {
    expect(
      (['collecting', 'responded', 'planning', 'realized'] as const).map(wishStatusLabel),
    ).toEqual(['征集中', '已回应', '筹备中', '已实现']);
  });

  it('optimistically toggles a like without producing negative counts', () => {
    expect(toggleFeedLike(item)).toMatchObject({ likedByViewer: true, likeCount: 3 });
    expect(toggleFeedLike({ ...item, likedByViewer: true, likeCount: 0 })).toMatchObject({
      likedByViewer: false,
      likeCount: 0,
    });
  });
});
