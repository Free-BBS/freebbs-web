import { act, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, matchRoutes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';

import { appRouter } from './router.js';

const { mockRequest, mockUseAuth } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockUseAuth: vi.fn(),
}));

vi.mock('../core/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/api/client.js')>()),
  createApiClient: () => ({ request: mockRequest }),
}));

vi.mock('../core/auth/AuthProvider.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/auth/AuthProvider.js')>()),
  useAuth: mockUseAuth,
}));

const student: UserContext = {
  uid: 'student-1',
  displayName: '林同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};

function leafRoute(pathname: string) {
  const matches = matchRoutes(appRouter.routes, pathname);
  return matches?.at(-1)?.route;
}

function redirectTarget(pathname: string) {
  return (leafRoute(pathname) as unknown as { element?: { props?: { to?: string } } }).element
    ?.props?.to;
}

describe('application routes', () => {
  it('opens the unified information hub at the module entry point', () => {
    const route = leafRoute('/information');

    expect(route?.path).toBe('information');
    expect(redirectTarget('/information')).toBeUndefined();
    expect(route && 'element' in route ? route.element : undefined).toBeDefined();
  });

  it.each([
    ['/knowledge/entry-1', 'knowledge/:entryId'],
    ['/information/announcements', 'information/announcements'],
    ['/information/consultations', 'information/consultations'],
    ['/information/triage', 'information/triage'],
    ['/information/proposals', 'information/proposals'],
    ['/information/proposals/proposal-1', 'information/proposals/:proposalId'],
    ['/events/activity-1', 'events/:activityId'],
    ['/sports/team-1', 'sports/:teamId'],
    ['/liaison/problems/problem-1', 'liaison/problems/:problemId'],
  ])('matches %s to its focused module route', (pathname, expectedPath) => {
    expect(leafRoute(pathname)?.path).toBe(expectedPath);
  });

  it('opens the growth archive and redirects retired interest-group URLs there', () => {
    expect(leafRoute('/growth')?.path).toBe('growth');
    expect(redirectTarget('/clubs')).toBe('/growth');
    expect(redirectTarget('/interest-groups')).toBe('/growth');
  });

  it('keeps unknown paths on the dashboard fallback', () => {
    const route = leafRoute('/not-a-module');

    expect(route?.path).toBe('*');
    expect(redirectTarget('/not-a-module')).toBe('/dashboard');
  });

  it('redirects an unauthorized administrator to the dashboard', async () => {
    mockRequest.mockResolvedValue([]);
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      user: student,
      error: null,
      reload: vi.fn(),
      authMode: 'main',
      demoUser: null,
      setDemoUser: vi.fn(),
      loginUrl: '/login',
      client: { request: mockRequest },
    });

    await act(async () => {
      await appRouter.navigate('/admin');
    });
    render(<RouterProvider router={appRouter} />);

    await waitFor(() => expect(appRouter.state.location.pathname).toBe('/development/dashboard'));
  });

  it('loads and displays the requested proposal on a direct detail route', async () => {
    mockRequest.mockImplementation(async (path: string) => {
      if (path === '/modules') return [];
      if (path === '/information/proposals/proposal-1') {
        return {
          id: 'proposal-1',
          title: '改善自习空间照明',
          problemDescription: '晚间照明不足。',
          proposedSolution: '增加阅读灯。',
          category: 'facilities',
          submitterUid: 'student-1',
          assigneeUid: null,
          dueAt: null,
          publicProgress: '正在收集意见。',
          status: 'reviewing',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        };
      }
      return [];
    });
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      user: student,
      error: null,
      reload: vi.fn(),
      authMode: 'main',
      demoUser: null,
      setDemoUser: vi.fn(),
      loginUrl: '/login',
      client: { request: mockRequest },
    });

    await act(async () => {
      await appRouter.navigate('/information/proposals/proposal-1');
    });
    render(<RouterProvider router={appRouter} />);

    expect(await screen.findByRole('heading', { name: '改善自习空间照明' })).toBeInTheDocument();
    expect(mockRequest).toHaveBeenCalledWith('/information/proposals/proposal-1');
  });
});
