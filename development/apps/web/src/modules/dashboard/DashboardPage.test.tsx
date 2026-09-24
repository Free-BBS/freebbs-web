import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../../core/api/client.js';
import { DashboardPage } from './DashboardPage.js';

function renderDashboard(request: ReturnType<typeof vi.fn>) {
  render(
    <MemoryRouter>
      <DashboardPage client={{ request } as unknown as ApiClient} />
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  it('keeps the dashboard a concise overview instead of a second module navigation', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/information/announcements') {
        return [
          {
            id: 'announcement-1',
            title: '秋季场地开放安排',
            status: 'published',
            updatedAt: '2026-09-12T08:00:00.000Z',
          },
        ];
      }
      if (path === '/events/activities') {
        return [
          {
            id: 'activity-1',
            title: '马约翰杯',
            status: 'published',
            startsAt: '2026-10-10T08:00:00.000Z',
          },
        ];
      }
      throw new Error(`unexpected path: ${path}`);
    });

    renderDashboard(request);

    expect(screen.getByRole('heading', { name: '发展端工作台' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '发展端工作台' })).toBeInTheDocument();
    expect(screen.getByText('了解校园近况，让想法与伙伴在这里相遇。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看近期活动' })).toHaveAttribute('href', '/events');
    expect(screen.getByRole('link', { name: '查看近期活动' })).toHaveClass('primary-action-link');
    expect(await screen.findByText('秋季场地开放安排')).toBeInTheDocument();
    expect(screen.getByText('马约翰杯')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '最近公开内容' })).toHaveClass('dashboard-recent-list');
    expect(screen.getByRole('heading', { name: '行动提示' })).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-module-card')).not.toBeInTheDocument();
    expect(screen.queryByText('权限与模块管理')).not.toBeInTheDocument();
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/information/announcements',
      '/events/activities',
    ]);
  });

  it('keeps the overview and primary action available when recent content cannot load', async () => {
    const request = vi.fn().mockRejectedValue(new Error('offline'));

    renderDashboard(request);

    expect(await screen.findByRole('alert')).toHaveTextContent('最近内容暂时无法同步');
    expect(screen.getByRole('link', { name: '查看近期活动' })).toHaveAttribute('href', '/events');
    expect(screen.getByRole('heading', { name: '行动提示' })).toBeInTheDocument();
  });
});
