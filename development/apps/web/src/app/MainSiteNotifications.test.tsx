import type { ApiClient } from '../core/api/client.js';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MainSiteNotifications } from './MainSiteNotifications.js';
const { main } = vi.hoisted(() => ({ main: vi.fn() }));
vi.mock('./main-site-api.js', () => ({ requestMainSite: main, mainSiteHref: (s: string) => s }));
describe('development notification inbox', () => {
  it('shows subscribed activity notices in demo and marks them read using development API', async () => {
    const notice = {
      id: 'notice',
      source: 'development_activity',
      activityId: 'event',
      title: '新活动动态',
      body: '报名已开放',
      link: '',
      createdAt: '2026-10-09T09:00:00Z',
      readAt: null,
    };
    const request = vi.fn(async (path: string) =>
      path.includes('/read')
        ? { readAt: '2026-10-09T10:00:00Z' }
        : path === '/notifications'
          ? []
          : path.endsWith('/unread-count')
            ? { unreadCount: 0 }
            : { notifications: [notice], unreadCount: 1, nextCursor: null },
    );
    render(
      <MainSiteNotifications
        authMode="demo"
        userUid="student"
        client={{ request: request as ApiClient['request'] }}
      />,
    );
    fireEvent.click(screen.getByTitle('通知'));
    expect(await screen.findByText('新活动动态')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /新活动动态/ }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/events/notifications/development_activity/event/notice/read',
        { method: 'POST' },
      ),
    );
    expect(main).not.toHaveBeenCalled();
  });
  it('combines both counters, clears both channels and rejects stale identity responses', async () => {
    main.mockReset();
    const request = vi.fn(async (path: string) =>
      path === '/notifications'
        ? []
        : path.endsWith('/unread-count')
          ? { unreadCount: 2 }
          : { notifications: [], unreadCount: 1, nextCursor: null },
    );
    const view = render(
      <MainSiteNotifications
        authMode="main"
        userUid="a"
        client={{ request: request as ApiClient['request'] }}
      />,
    );
    await screen.findByRole('button', { name: '通知，3 条未读' });
    fireEvent.click(screen.getByTitle('通知'));
    fireEvent.click(await screen.findByRole('button', { name: '全部已读' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/events/notifications/read-all', { method: 'POST' }),
    );
    expect(request).toHaveBeenCalledWith('/notifications/read-all', { method: 'POST' });
    expect(main).not.toHaveBeenCalled();
    view.rerender(
      <MainSiteNotifications
        authMode="demo"
        userUid="b"
        client={{
          request: vi.fn(async (path: string) =>
            path === '/notifications'
              ? []
              : { notifications: [], unreadCount: 0, nextCursor: null },
          ) as ApiClient['request'],
        }}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('reads own system notices with isolated endpoints and never calls the learning inbox', async () => {
    main.mockReset();
    const request = vi.fn(async (path: string) => {
      if (path === '/notifications')
        return [
          {
            id: 'system-1',
            kind: 'announcement',
            title: '发展端提醒',
            body: '新通知',
            authorUid: 'admin',
            authorDisplayName: '管理员',
            link: null,
            readAt: null,
            createdAt: '2026-10-13T09:00:00Z',
          },
        ];
      if (path.endsWith('/unread-count')) return { unreadCount: 1 };
      if (path === '/events/notifications')
        return { notifications: [], unreadCount: 0, nextCursor: null };
      if (path === '/notifications/system-1/read') return { updated: true, id: 'system-1' };
      throw new Error(path);
    });
    render(
      <MainSiteNotifications
        authMode="main"
        userUid="a"
        client={{ request: request as ApiClient['request'] }}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '通知，1 条未读' }));
    fireEvent.click(await screen.findByRole('button', { name: /发展端提醒/ }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/notifications/system-1/read', { method: 'POST' }),
    );
    expect(main).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'ignores a refresh started before a read succeeds (single=%s)',
    async (single) => {
      const notice = {
        id: 'a',
        source: 'development_activity',
        activityId: 'event',
        title: '延迟通知',
        body: '',
        link: '',
        createdAt: '2026-10-09T09:00:00Z',
        readAt: null,
      };
      let resolveRefresh!: (value: unknown) => void;
      let defer = false;
      const request = vi.fn(async (path: string) => {
        if (path.endsWith('read-all') || path.endsWith('/read')) return {};
        if (path === '/notifications') return [];
        if (path.endsWith('unread-count')) return { unreadCount: 0 };
        if (defer)
          return new Promise((resolve) => {
            resolveRefresh = resolve;
          });
        return { notifications: [notice], unreadCount: 1, nextCursor: null };
      });
      render(
        <MainSiteNotifications
          authMode="demo"
          userUid="a"
          client={{ request: request as ApiClient['request'] }}
        />,
      );
      fireEvent.click(await screen.findByRole('button', { name: '通知，1 条未读' }));
      await screen.findByText('延迟通知');
      await waitFor(() => expect(screen.getByRole('button', { name: '全部已读' })).toBeEnabled());
      defer = true;
      fireEvent(window, new Event('focus'));
      await waitFor(() => expect(resolveRefresh).toBeTypeOf('function'));
      fireEvent.click(screen.getByRole('button', { name: single ? /延迟通知/ : '全部已读' }));
      await screen.findByRole('button', { name: '通知，无未读' });
      await act(async () =>
        resolveRefresh({ notifications: [notice], unreadCount: 1, nextCursor: null }),
      );
      expect(screen.getByRole('button', { name: '通知，无未读' })).toBeInTheDocument();
      expect(screen.getByText('延迟通知').closest('article')).not.toHaveClass('is-unread');
    },
  );
  it('preserves the exhausted older-page cursor when refreshing new notices', async () => {
    const notice = (id: string) => ({
      id,
      source: 'development_activity',
      activityId: 'event',
      title: id,
      body: '',
      link: '',
      createdAt: '2026-10-09T09:00:00Z',
      readAt: null,
    });
    const request = vi.fn(async (path: string) => {
      if (path === '/notifications') return [];
      if (path.endsWith('unread-count')) return { unreadCount: 0 };
      return path.includes('?before=')
        ? { notifications: [notice('older')], unreadCount: 2, nextCursor: null }
        : { notifications: [notice('newest')], unreadCount: 2, nextCursor: 'older-page' };
    });
    render(
      <MainSiteNotifications
        authMode="demo"
        userUid="a"
        client={{ request: request as ApiClient['request'] }}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '通知，2 条未读' }));
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await screen.findByText('older');
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent(window, new Event('focus'));
    });
    expect(screen.getByText('older')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });
});
