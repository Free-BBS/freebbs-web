import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../core/api/client.js';
import { AllActivitiesPage } from './AllActivitiesPage.js';
describe('all activities catalog', () => {
  it.each([true, false])(
    'shows usable authoring entries only when the server allows creation: %s',
    async (canCreate) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ surveys: [], nextPage: null }))),
      );
      const request = vi.fn(async (path: string) =>
        path === '/collections/dashboard' ? { canCreate, featured: [], showcase: [] } : [],
      );
      render(
        <MemoryRouter>
          <AllActivitiesPage client={{ request: request as ApiClient['request'] }} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.queryByText('正在整理活动…')).not.toBeInTheDocument());
      if (canCreate) {
        expect(screen.getByRole('link', { name: '创建活动' })).toHaveAttribute(
          'href',
          '/collections/activities/manage?create=1',
        );
        expect(screen.getByRole('link', { name: '管理我的活动' })).toHaveAttribute(
          'href',
          '/collections/activities/manage',
        );
      } else {
        expect(screen.queryByRole('link', { name: '创建活动' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: '管理我的活动' })).not.toBeInTheDocument();
      }
      vi.unstubAllGlobals();
    },
  );

  it('loads archive, sorts recent first and keeps closed registration out of ended filter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ surveys: [], nextPage: null }))),
    );
    const request = vi.fn(async (path: string, init?: RequestInit) =>
      path === '/events/following'
        ? []
        : init?.method === 'PUT'
          ? { following: true }
          : [
              {
                id: 'old',
                source: 'development_activity',
                title: '旧活动',
                status: 'closed',
                startsAt: '2020-01-01',
                endsAt: '2020-01-02',
              },
              {
                id: 'future',
                source: 'development_activity',
                title: '已截止但未结束',
                status: 'closed',
                startsAt: '2099-01-01',
                endsAt: '2099-01-02',
              },
            ],
    );
    render(
      <MemoryRouter>
        <AllActivitiesPage client={{ request: request as ApiClient['request'] }} />
      </MemoryRouter>,
    );
    const catalog = await screen.findByRole('region', { name: '活动列表' });
    await screen.findByRole('link', { name: /已截止但未结束/ });
    expect(request).toHaveBeenCalledWith('/collections/registrations?includePast=true');
    expect(within(catalog).getAllByRole('article')[0]).toHaveTextContent('已截止但未结束');
    expect(screen.getByRole('link', { name: /已截止但未结束/ })).toHaveAttribute(
      'href',
      '/collections/activities/development_activity/future',
    );
    fireEvent.click(screen.getByRole('button', { name: '关注：已截止但未结束' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '取消关注：已截止但未结束' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '已结束' }));
    expect(screen.queryByRole('link', { name: /已截止但未结束/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /旧活动/ })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
