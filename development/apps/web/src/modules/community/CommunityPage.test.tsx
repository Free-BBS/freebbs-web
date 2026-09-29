import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type {
  CommunityFeedItem,
  CommunityThreadDetail,
  CommunityTrendingPayload,
} from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { CommunityPage } from './CommunityPage.js';

const capabilities = {
  canEdit: false,
  canDelete: false,
  canComment: true,
  canSupplement: false,
  canReport: true,
  canModerate: false,
  canRespondToWish: true,
  canTransitionWish: true,
  canRequestConversion: true,
  canApproveConversion: true,
};

const wish: CommunityFeedItem = {
  id: 'wish-1',
  kind: 'wish',
  title: '想要滑冰工作坊',
  body: '希望从装备和基础动作开始。',
  tags: ['新生许愿池', '运动'],
  author: { mode: 'anonymous', displayName: '匿名小羊 1', avatarUrl: null, isViewer: false },
  status: 'active',
  wishStatus: 'responded',
  officialResponse: '新生组正在联系讲师。',
  conversionStatus: 'requested',
  linkedActivityId: null,
  createdAt: '2026-09-29T08:00:00.000Z',
  updatedAt: '2026-09-29T09:00:00.000Z',
  likeCount: 12,
  commentCount: 4,
  likedByViewer: false,
  capabilities,
};

const thread: CommunityThreadDetail = { item: wish, comments: [], supplements: [] };
const trends: CommunityTrendingPayload = {
  items: [{ postId: wish.id, title: wish.title, kind: wish.kind, score: 12.8, rankChange: null }],
  generatedAt: '2026-09-29T12:00:00.000Z',
};

describe('CommunityPage', () => {
  it('renders the five channels, feed, hot list, and anonymous composer', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/community/feed?channel=all') return [wish];
      if (path === '/community/trending') return trends;
      if (path === '/community/posts' && init?.method === 'POST') return { id: 'post-new' };
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<CommunityPage client={{ request } as unknown as ApiClient} />);

    expect(await screen.findByRole('heading', { name: '無界广场' })).toBeInTheDocument();
    for (const label of ['综合', '校园日常', '新生许愿池', '学生节舞台', '生权反馈']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
    expect(await screen.findByRole('button', { name: '打开想要滑冰工作坊' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '实时热榜' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '发布新内容' }));
    await user.click(screen.getByRole('radio', { name: '匿名展示' }));
    await user.type(screen.getByLabelText('标题'), '今晚操场散步');
    await user.type(screen.getByLabelText('内容'), '想找几位同学一起走走。');
    await user.click(screen.getByRole('button', { name: '确认发布' }));
    expect(request).toHaveBeenCalledWith(
      '/community/posts',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"displayMode":"anonymous"'),
      }),
    );
  });

  it('opens a wish and exposes only capability-backed workflow controls', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/community/feed?channel=all') return [wish];
      if (path === '/community/trending') return trends;
      if (path === '/community/posts/wish-1' && !init) return thread;
      if (path === '/community/posts/wish-1/comments' && init?.method === 'POST') return {};
      if (path === '/community/posts/wish-1/reports' && init?.method === 'POST') return {};
      if (path === '/community/wishes/wish-1/responses' && init?.method === 'POST') return {};
      if (
        path === '/community/wishes/wish-1/conversion-requests/approve' &&
        init?.method === 'POST'
      ) {
        return { id: 'activity-1' };
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<CommunityPage client={{ request } as unknown as ApiClient} />);

    await user.click(await screen.findByRole('button', { name: '打开想要滑冰工作坊' }));
    expect(await screen.findByRole('dialog', { name: '想要滑冰工作坊' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准转为活动草稿' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '匿名回复' }));
    await user.type(screen.getByLabelText('写下回复'), '我也想参加。');
    await user.click(screen.getByRole('button', { name: '发送回复' }));
    expect(request).toHaveBeenCalledWith(
      '/community/posts/wish-1/comments',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"displayMode":"anonymous"'),
      }),
    );
    await user.click(screen.getByRole('button', { name: '举报帖子' }));
    await user.type(screen.getByLabelText('举报理由'), '疑似包含不适当内容');
    await user.click(screen.getByRole('button', { name: '提交举报' }));
    expect(request).toHaveBeenCalledWith(
      '/community/posts/wish-1/reports',
      expect.objectContaining({ method: 'POST' }),
    );
    await user.type(screen.getByLabelText('官方回应'), '已经找到场地。');
    await user.click(screen.getByRole('button', { name: '发布官方回应' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/community/wishes/wish-1/responses',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('lets the author add a supplement and opens a routed post directly', async () => {
    const ownerThread: CommunityThreadDetail = {
      ...thread,
      item: {
        ...wish,
        capabilities: { ...capabilities, canSupplement: true, canReport: false },
      },
    };
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/community/feed?channel=all') return [ownerThread.item];
      if (path === '/community/trending') return trends;
      if (path === '/community/posts/wish-1' && !init) return ownerThread;
      if (path === '/community/posts/wish-1/supplements' && init?.method === 'POST') return {};
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<CommunityPage client={{ request } as unknown as ApiClient} initialPostId="wish-1" />);

    expect(await screen.findByRole('dialog', { name: '想要滑冰工作坊' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('作者补充'), '集合地点改到西操场入口。');
    await user.click(screen.getByRole('button', { name: '发布补充' }));
    expect(request).toHaveBeenCalledWith(
      '/community/posts/wish-1/supplements',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.queryByRole('button', { name: '举报帖子' })).not.toBeInTheDocument();
  });
});
