import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('distinguishes failed, loading and successfully empty feeds', async () => {
    let resolveFeed!: (value: CommunityFeedItem[]) => void;
    const nextFeed = new Promise<CommunityFeedItem[]>((resolve) => {
      resolveFeed = resolve;
    });
    const request = vi.fn(async (path: string) => {
      if (path === '/community/trending') return { ...trends, items: [] };
      if (path === '/community/feed?channel=all') throw new Error('Offline');
      if (path === '/community/feed?channel=daily') return nextFeed;
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<CommunityPage client={{ request } as unknown as ApiClient} />);

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'loading');
    expect(await screen.findByRole('alert')).toHaveTextContent('广场内容暂时无法加载');
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByText('这个分区还没有内容，来写下第一条吧。')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '校园日常' }));
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('这个分区还没有内容，来写下第一条吧。')).not.toBeInTheDocument();
    await act(async () => resolveFeed([]));
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'empty');
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not confuse an operation failure with a successfully empty feed', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/community/feed?channel=all') return [];
      if (path === '/community/trending') return { ...trends, items: [] };
      throw new Error('Detail unavailable');
    });
    render(<CommunityPage client={{ request } as unknown as ApiClient} initialPostId="missing" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('帖子详情暂时无法打开');
    expect(await screen.findByText('这个分区还没有内容，来写下第一条吧。')).toHaveAttribute(
      'data-state',
      'empty',
    );
  });

  it('ignores a stale thread response without discarding the current reply draft', async () => {
    let resolveOlder!: (value: CommunityThreadDetail) => void;
    const newer = { ...wish, id: 'wish-2', title: '午后散步' };
    const request = vi.fn(async (path: string) => {
      if (path.startsWith('/community/feed')) return [wish, newer];
      if (path === '/community/trending') return { ...trends, items: [] };
      if (path === '/community/posts/wish-1')
        return new Promise<CommunityThreadDetail>((resolve) => {
          resolveOlder = resolve;
        });
      if (path === '/community/posts/wish-2') return { ...thread, item: newer };
      if (path.endsWith('/views')) return {};
      throw new Error(path);
    });
    const user = userEvent.setup();
    render(<CommunityPage client={{ request } as unknown as ApiClient} />);
    await user.click(await screen.findByRole('button', { name: `打开${wish.title}` }));
    await user.click(screen.getByRole('button', { name: `打开${newer.title}` }));
    await screen.findByRole('dialog', { name: newer.title });
    await user.type(screen.getByLabelText('写下回复'), '这份回复还没发送');
    await act(async () => resolveOlder(thread));
    expect(screen.getByRole('dialog', { name: newer.title })).toBeInTheDocument();
    expect(screen.getByLabelText('写下回复')).toHaveValue('这份回复还没发送');
  });
  it('refreshes the current channel when a publication finishes after the viewer changes tabs', async () => {
    let finish!: () => void;
    const request = vi.fn(async (path: string) => {
      if (path === '/community/trending') return trends;
      if (path === '/community/feed?channel=rights') return [];
      if (path.startsWith('/community/feed')) return [wish];
      if (path === '/community/posts')
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<CommunityPage client={{ request } as unknown as ApiClient} />);
    await user.type(screen.getByLabelText('标题'), '午后操场');
    await user.type(screen.getByLabelText('内容'), '今天的夕阳很美。');
    await user.click(screen.getByRole('button', { name: '确认发布' }));
    await user.click(screen.getByRole('tab', { name: '生权反馈' }));
    await waitFor(() => expect(request).toHaveBeenLastCalledWith('/community/feed?channel=rights'));
    finish();
    await waitFor(() => expect(screen.getByText(/已发布，去广场看看/)).toBeInTheDocument());
    expect(request).toHaveBeenLastCalledWith('/community/feed?channel=rights');
    expect(screen.queryByRole('button', { name: `打开${wish.title}` })).not.toBeInTheDocument();
  });
  it('publishes from the inline composer and clears its fields only after success', async () => {
    const request = vi.fn(async (path: string) => (path === '/community/trending' ? trends : []));
    const user = userEvent.setup();
    render(<CommunityPage client={{ request } as unknown as ApiClient} />);
    const composer = screen.getByRole('region', { name: '分享校园新鲜事' });
    await user.type(within(composer).getByLabelText('标题'), '午后操场');
    await user.type(within(composer).getByLabelText('内容'), '今天的夕阳很美。');
    await user.click(within(composer).getByRole('button', { name: '确认发布' }));
    await waitFor(() => expect(within(composer).getByLabelText('内容')).toHaveValue(''));
    expect(request).toHaveBeenCalledWith(
      '/community/posts',
      expect.objectContaining({ body: expect.stringContaining('午后操场') }),
    );
    expect(within(composer).getByRole('status')).toHaveTextContent('已发布');
  });
  it('keeps failed replies editable and retries without losing the selected identity', async () => {
    let attempts = 0;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/community/feed')) return [wish];
      if (path === '/community/trending') return trends;
      if (path === '/community/posts/wish-1' && !init) return thread;
      if (path.endsWith('/views')) return {};
      if (path.endsWith('/comments')) {
        if (++attempts === 1) throw new Error('offline');
        return {};
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<CommunityPage client={{ request } as unknown as ApiClient} initialPostId="wish-1" />);
    const dialog = await screen.findByRole('dialog', { name: wish.title });
    await user.click(within(dialog).getByRole('radio', { name: '匿名回复' }));
    await user.type(within(dialog).getByLabelText('写下回复'), '我也想参加。');
    await user.click(within(dialog).getByRole('button', { name: '发送回复' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('操作失败');
    expect(within(dialog).getByLabelText('写下回复')).toHaveValue('我也想参加。');
    await user.click(within(dialog).getByRole('button', { name: '发送回复' }));
    await waitFor(() => expect(within(dialog).getByLabelText('写下回复')).toHaveValue(''));
    expect(attempts).toBe(2);
    expect(request).toHaveBeenLastCalledWith('/community/posts/wish-1');
  });

  it('prevents concurrent likes and restores the count when saving fails', async () => {
    let rejectLike!: (error: Error) => void;
    const request = vi.fn(async (path: string) => {
      if (path.startsWith('/community/feed')) return [wish];
      if (path === '/community/trending') return trends;
      if (path.endsWith('/like'))
        return new Promise((_, reject) => {
          rejectLike = reject;
        });
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<CommunityPage client={{ request } as unknown as ApiClient} />);
    const like = await screen.findByRole('button', { name: '赞 12' });
    fireEvent.click(like);
    fireEvent.click(like);
    expect(request.mock.calls.filter(([path]) => path.endsWith('/like'))).toHaveLength(1);
    expect(like).toBeDisabled();
    rejectLike(new Error('offline'));
    expect(await screen.findByRole('alert')).toHaveTextContent('点赞状态未能保存');
    expect(screen.getByRole('button', { name: '赞 12' })).toBeEnabled();
  });

  it('uses the existing festival and confidential consultation entry points for special channels', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/community/trending') return trends;
      if (path.startsWith('/events/festival/submissions'))
        return { items: [], page: 1, pageSize: 12, total: 0 };
      return [];
    });
    const user = userEvent.setup();
    render(<CommunityPage client={{ request } as unknown as ApiClient} />);
    await user.click(screen.getByRole('tab', { name: '电子系春晚' }));
    expect(screen.getByRole('link', { name: '我要上电子系春晚' })).toHaveAttribute(
      'href',
      '/development/events/student-festival',
    );
    expect(screen.queryByRole('textbox', { name: '内容' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '生权反馈' }));
    expect(screen.getByRole('link', { name: '提交生权反馈' })).toHaveAttribute(
      'href',
      '/development/information/consultations',
    );
    expect(screen.getByText(/个人反馈默认保密/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '内容' })).not.toBeInTheDocument();
  });
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
    for (const label of ['综合', '校园日常', '新生许愿池', '电子系春晚', '生权反馈']) {
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
    expect(screen.getByRole('button', { name: '进入筹备' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '标记已实现' })).not.toBeInTheDocument();
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

  it.each([
    {
      label: 'member collecting',
      status: 'collecting' as const,
      canApprove: false,
      visibleAction: null,
      transitionTarget: null,
    },
    {
      label: 'member responded',
      status: 'responded' as const,
      canApprove: false,
      visibleAction: '进入筹备',
      transitionTarget: 'planning',
    },
    {
      label: 'member planning',
      status: 'planning' as const,
      canApprove: false,
      visibleAction: null,
      transitionTarget: null,
    },
    {
      label: 'approver planning',
      status: 'planning' as const,
      canApprove: true,
      visibleAction: '标记已实现',
      transitionTarget: 'realized',
    },
    {
      label: 'approver realized',
      status: 'realized' as const,
      canApprove: true,
      visibleAction: null,
      transitionTarget: null,
    },
  ])(
    'shows only executable wish transitions for $label',
    async ({ status, canApprove, visibleAction, transitionTarget }) => {
      const scenarioItem: CommunityFeedItem = {
        ...wish,
        wishStatus: status,
        conversionStatus: 'none',
        capabilities: {
          ...capabilities,
          canApproveConversion: canApprove,
          canRespondToWish: false,
          canRequestConversion: false,
        },
      };
      const scenarioThread: CommunityThreadDetail = {
        item: scenarioItem,
        comments: [],
        supplements: [],
      };
      const request = vi.fn(async (path: string, init?: RequestInit) => {
        if (path === '/community/feed?channel=all') return [scenarioItem];
        if (path === '/community/trending') return { ...trends, items: [] };
        if (path === '/community/posts/wish-1' && !init) return scenarioThread;
        if (path === '/community/wishes/wish-1/transitions' && init?.method === 'POST') return {};
        throw new Error(`Unexpected request: ${path}`);
      });
      const user = userEvent.setup();
      render(<CommunityPage client={{ request } as unknown as ApiClient} />);

      await user.click(await screen.findByRole('button', { name: '打开想要滑冰工作坊' }));
      expect(await screen.findByRole('dialog', { name: '想要滑冰工作坊' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '进入筹备' })).toBe(
        visibleAction === '进入筹备' ? screen.getByRole('button', { name: '进入筹备' }) : null,
      );
      expect(screen.queryByRole('button', { name: '标记已实现' })).toBe(
        visibleAction === '标记已实现' ? screen.getByRole('button', { name: '标记已实现' }) : null,
      );

      if (visibleAction && transitionTarget) {
        await user.click(screen.getByRole('button', { name: visibleAction }));
        expect(request).toHaveBeenCalledWith(
          '/community/wishes/wish-1/transitions',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining(`"to":"${transitionTarget}"`),
          }),
        );
      }
    },
  );
});
