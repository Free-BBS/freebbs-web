import type { ApiClient } from '../core/api/client.js';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MainSiteNotifications } from './MainSiteNotifications.js';
const { main } = vi.hoisted(() => ({ main: vi.fn() }));
vi.mock('./main-site-api.js', () => ({ requestMainSite: main, mainSiteHref: (s: string) => s }));
describe('combined activity notification inbox', () => {
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
    main.mockImplementation(async (path: string) =>
      path.endsWith('unread-count')
        ? { unreadCount: 2 }
        : { notifications: [], unreadCount: 2, nextCursor: null },
    );
    const request = vi.fn(async () => ({ notifications: [], unreadCount: 1, nextCursor: null }));
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
    expect(main).toHaveBeenCalledWith('/notifications/read-all', { method: 'POST' });
    view.rerender(
      <MainSiteNotifications
        authMode="demo"
        userUid="b"
        client={{
          request: vi.fn(async () => ({
            notifications: [],
            unreadCount: 0,
            nextCursor: null,
          })) as ApiClient['request'],
        }}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
