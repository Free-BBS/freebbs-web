import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserContext } from '@freebbs-development/contracts';
import { appRouter } from '../../app/router.js';

const { request, useAuth } = vi.hoisted(() => ({ request: vi.fn(), useAuth: vi.fn() }));
vi.mock('../../core/api/client.js', async (original) => ({
  ...(await original<typeof import('../../core/api/client.js')>()),
  createApiClient: () => ({ request }),
}));
vi.mock('../../core/auth/AuthProvider.js', async (original) => ({
  ...(await original<typeof import('../../core/auth/AuthProvider.js')>()),
  useAuth,
}));

const student: UserContext = {
  uid: 'student-1',
  displayName: '林同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};
const entry = {
  id: 'entry-1',
  title: '第一次筹备活动',
  body: '整理流程与场地安排。',
  type: 'workflow',
  status: 'published',
  audience: 'general',
  ownerUid: 'student-1',
  scope: { type: 'public', id: '*' },
};

function renderRoute(route: string) {
  const router = createMemoryRouter(appRouter.routes, { initialEntries: [route] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (path: string) => {
    if (path.startsWith('/knowledge/entries')) return [entry];
    return [];
  });
  useAuth.mockReturnValue({
    status: 'authenticated',
    user: student,
    authMode: 'main',
    demoUser: null,
    error: null,
    reload: vi.fn(),
    setDemoUser: vi.fn(),
    loginUrl: '/login',
    client: { request },
  });
});

describe('無尽书桌', () => {
  it('offers three named books on a single development shell', async () => {
    renderRoute('/desk');
    expect(await screen.findByRole('heading', { name: '無尽书桌', level: 2 })).toBeInTheDocument();
    const books = screen.getByRole('group', { name: '选择一本书' });
    for (const name of ['打开通知册', '打开咨询手记', '打开经验集']) {
      expect(within(books).getByRole('button', { name })).toBeEnabled();
    }
    expect(screen.getAllByRole('complementary', { name: '发展平台侧栏' })).toHaveLength(1);
  });

  it.each([
    ['打开通知册', '/desk/information', 'official', '官方发布'],
    ['打开咨询手记', '/desk/information', 'mine', '我的咨询'],
  ])('opens %s with the existing information filter', async (name, pathname, filter, tab) => {
    const router = renderRoute('/desk');
    await userEvent.click(await screen.findByRole('button', { name }));
    await waitFor(() => expect(router.state.location.pathname).toBe(pathname));
    expect(router.state.location.search).toBe(`?filter=${filter}`);
    expect(await screen.findByRole('heading', { name: '信息与咨询' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    expect(request).toHaveBeenCalledWith(`/information/feed?filter=${filter}`);
    expect(screen.getByRole('button', { name: '提交反馈' })).toBeInTheDocument();
    expect(screen.getAllByRole('complementary', { name: '发展平台侧栏' })).toHaveLength(1);
  });

  it('switches books without leaving an old information filter behind', async () => {
    renderRoute('/desk/information?filter=official');
    await userEvent.click(await screen.findByRole('button', { name: '打开咨询手记' }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '我的咨询' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(request).toHaveBeenCalledWith('/information/feed?filter=mine');
  });

  it('reopens the same notice book after switching the information tab internally', async () => {
    const router = renderRoute('/desk/information?filter=official');
    const user = userEvent.setup();
    expect(await screen.findByRole('tab', { name: '官方发布' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('tab', { name: '我的咨询' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/information/feed?filter=mine'));
    await user.click(screen.getByRole('button', { name: '打开通知册' }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '官方发布' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(router.state.location.search).toBe('?filter=official');
    expect(screen.getByRole('button', { name: '打开通知册' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '打开咨询手记' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await waitFor(() =>
      expect(
        request.mock.calls.filter(([path]) => path === '/information/feed?filter=official'),
      ).toHaveLength(2),
    );
  });

  it('synchronizes tabs, book selection and history while preserving other query parameters', async () => {
    const router = renderRoute('/desk/information?filter=official&origin=desk');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: '我的咨询' }));
    await waitFor(() => expect(router.state.location.search).toBe('?filter=mine&origin=desk'));
    expect(screen.getByRole('button', { name: '打开咨询手记' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '官方发布' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(router.state.location.search).toBe('?filter=official&origin=desk');
    expect(screen.getByRole('button', { name: '打开通知册' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('opens the existing experience list and reader inside the desk', async () => {
    const router = renderRoute('/desk');
    await userEvent.click(await screen.findByRole('button', { name: '打开经验集' }));
    expect(router.state.location.pathname).toBe('/desk/knowledge');
    await userEvent.click(await screen.findByRole('link', { name: '第一次筹备活动' }));
    expect(await screen.findByRole('region', { name: '经验阅读' })).toHaveTextContent(
      '整理流程与场地安排。',
    );
    expect(screen.getByRole('heading', { name: '無尽书桌', level: 2 })).toBeInTheDocument();
    expect(screen.getAllByRole('complementary', { name: '发展平台侧栏' })).toHaveLength(1);
  });

  it.each([
    ['/information?filter=mine', '信息与咨询', '/information/feed?filter=mine'],
    ['/information/announcements', '信息与咨询', '/information/feed?filter=official'],
    ['/knowledge/entry-1', '第一次筹备活动', '/knowledge/entries?audience=general'],
  ])('keeps the old deep link %s usable within the desk', async (route, heading, endpoint) => {
    renderRoute(route);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '無尽书桌', level: 2 })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(endpoint);
  });

  it('respects a disabled knowledge module for both book and direct reader routes', async () => {
    request.mockImplementation(async (path: string) =>
      path === '/modules' ? [{ id: 'knowledge', status: 'disabled' }] : [],
    );
    const router = renderRoute('/desk');
    expect(await screen.findByRole('button', { name: '打开经验集' })).toBeDisabled();
    await act(async () => {
      await router.navigate('/desk/knowledge/entry-1');
    });
    expect(await screen.findByRole('status')).toHaveTextContent('经验集暂未开放');
    expect(request).not.toHaveBeenCalledWith('/knowledge/entries?audience=general');
  });
});
