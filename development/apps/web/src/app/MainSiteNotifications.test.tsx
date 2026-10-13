import type { ApiClient } from '../core/api/client.js';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
