import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { MainSiteHeader } from './MainSiteHeader.js';

const user = {
  uid: 'u123456',
  displayName: '林同学',
  avatarUrl: null,
  baseRole: 'student' as const,
  roles: [],
  tags: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('MainSiteHeader', () => {
  it('shows only the requested account controls and real balances', async () => {
    window.localStorage.setItem('free_bbs_auth_token', 'test-token');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/me')) {
        return {
          ok: true,
          json: async () => ({ user: { uid: user.uid, electrons: 8, manetrons: 3, heat: 2 } }),
        };
      }
      if (String(input).endsWith('/notifications/unread-count')) {
        return { ok: true, json: async () => ({ unreadCount: 2 }) };
      }
      return { ok: true, json: async () => ({ checkedInToday: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <MainSiteHeader user={user} authMode="main" themeMode="light" onToggleTheme={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('navigation', { name: '主站导航' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '设置' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '退出' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '仓库' })).toHaveAttribute('href', '/inventory');
    expect(screen.getByRole('link', { name: '商店' })).toHaveAttribute('href', '/shop');
    await waitFor(() => expect(screen.getByLabelText('电元：8')).toBeInTheDocument());
    expect(screen.getByLabelText('磁元：3')).toBeInTheDocument();
    expect(screen.getByLabelText('热力：2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开我的个人主页' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '通知，2 条未读' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: '今日已签到' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('checks in through the main-site API and refreshes balances', async () => {
    window.localStorage.setItem('free_bbs_auth_token', 'test-token');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/auth/me')) {
        return {
          ok: true,
          json: async () => ({ user: { uid: user.uid, electrons: 8, manetrons: 3 } }),
        };
      }
      if (init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            user: { uid: user.uid, electrons: 8, manetrons: 5 },
            summary: {
              checkedInToday: true,
              todayFortune: { date: '2026-09-18', score: 72 },
              records: [],
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          checkedInToday: false,
          todayFortune: { date: '2026-09-18', score: 72 },
          records: [],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <MainSiteHeader user={user} authMode="main" themeMode="light" onToggleTheme={vi.fn()} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '签到' }));
    await screen.findByRole('button', { name: '签到领取磁元' });
    expect(screen.getByRole('dialog')).toHaveClass('fortune-panel');
    expect(screen.getByRole('dialog').querySelector('.fortune-awful')).toHaveTextContent('大吉');
    fireEvent.click(screen.getByRole('button', { name: '签到领取磁元' }));
    await waitFor(() => expect(screen.getByLabelText('磁元：5')).toBeInTheDocument());
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: '今日已签到' }),
    ).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/checkin',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('uses the main-site typography preference for account numbers', () => {
    window.localStorage.setItem(
      'free_bbs_typography_preferences',
      JSON.stringify({ fontPreset: 'night-oscilloscope', typeScale: 'large' }),
    );
    const { container } = render(
      <MemoryRouter>
        <MainSiteHeader user={user} authMode="demo" themeMode="light" onToggleTheme={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container.querySelector('.main-site-header')).toHaveStyle({
      '--main-site-ui-size': '18.88px',
    });
    expect(container.querySelector('.main-site-header')).toHaveStyle({
      '--main-site-ui-font': '"Segoe UI", "Microsoft YaHei", sans-serif',
    });
  });

  it('does not invent main-site account data for a demo identity', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <MainSiteHeader user={user} authMode="demo" themeMode="light" onToggleTheme={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('电元：—')).toBeInTheDocument();
    expect(screen.getByLabelText('磁元：—')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '签到' }));
    expect(screen.getByText('请登录主站账号后签到。')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('orders the account controls like the main site and exposes the mobile theme switch', () => {
    const onToggleTheme = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <MainSiteHeader
          user={user}
          authMode="demo"
          themeMode="dark"
          onToggleTheme={onToggleTheme}
        />
      </MemoryRouter>,
    );
    const account = container.querySelector('.main-site-account');
    expect(Array.from(account?.children ?? []).map((child) => child.className)).toEqual([
      'main-site-economy',
      'main-site-user',
      'main-site-notifications',
      'main-site-mobile-theme',
    ]);
    expect(screen.getByRole('img', { name: '林同学头像' })).toHaveAttribute(
      'src',
      expect.stringContaining('avatar_placeholder.webp'),
    );
    fireEvent.click(screen.getByRole('button', { name: '切换到明亮模式' }));
    expect(onToggleTheme).toHaveBeenCalledOnce();
  });

  it('opens the main-site inbox and marks an item read', async () => {
    window.localStorage.setItem('free_bbs_auth_token', 'test-token');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/auth/me'))
        return { ok: true, json: async () => ({ user: { uid: user.uid } }) };
      if (path.endsWith('/notifications/unread-count'))
        return { ok: true, json: async () => ({ unreadCount: 1 }) };
      if (path.endsWith('/checkin'))
        return { ok: true, json: async () => ({ checkedInToday: false }) };
      if (path.endsWith('/notifications/42/read') && init?.method === 'POST')
        return { ok: true, json: async () => ({ ok: true }) };
      if (path.endsWith('/notifications'))
        return {
          ok: true,
          json: async () => ({
            notifications: [
              {
                id: '42',
                title: '新通知',
                body: '欢迎回来',
                link: '',
                readAt: null,
                createdAt: '2026-09-18T10:00:00Z',
              },
            ],
            unreadCount: 1,
            nextCursor: null,
          }),
        };
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <MainSiteHeader user={user} authMode="main" themeMode="light" onToggleTheme={vi.fn()} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '通知，1 条未读' }));
    expect(await screen.findByText('新通知')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /新通知/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '通知，无未读' })).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/notifications/42/read',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
