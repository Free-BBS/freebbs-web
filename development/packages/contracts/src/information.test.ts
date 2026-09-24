import { describe, expect, it } from 'vitest';

import type { InformationFeedItem, InformationReply } from './information.js';

describe('information contracts', () => {
  it('represents feed cards and replies with stable discriminators', () => {
    const item: InformationFeedItem = {
      kind: 'consultation',
      id: 'consultation-1',
      title: '场地反馈',
      body: '希望延长开放时间',
      status: 'open',
      visibility: 'public',
      requesterUid: 'student-1',
      assigneeUid: null,
      dueAt: null,
      scope: { type: 'user', id: 'student-1' },
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
      likeCount: 2,
      replyCount: 1,
      likedByViewer: true,
      canReply: true,
      canManage: false,
    };
    const reply: InformationReply = {
      id: 'reply-1',
      targetType: 'consultation',
      targetId: item.id,
      authorUid: 'student-1',
      kind: 'supplement',
      body: '补充说明',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };

    expect([item.kind, reply.kind]).toEqual(['consultation', 'supplement']);
  });
});
