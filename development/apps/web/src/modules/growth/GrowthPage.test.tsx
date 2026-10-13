import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { AchievementAtlas, GrowthSummary } from '@freebbs-development/contracts';
import { GrowthPage } from './GrowthPage.js';

const summary: GrowthSummary = {
  total: 2,
  basis: 'completed_registration',
  byDomain: [
    { key: 'arts', label: '文艺', count: 1 },
    { key: 'sports', label: '体育', count: 1 },
  ],
  achievements: [
    {
      id: 'first-step',
      title: '初次登场',
      description: '完成 1 次活动报名经历',
      unlocked: true,
      progress: 2,
      target: 1,
    },
    {
      id: 'steady-explorer',
      title: '持续探索',
      description: '累积 5 次活动报名经历',
      unlocked: false,
      progress: 2,
      target: 5,
    },
  ],
  activities: [
    {
      id: 'festival',
      title: '学生节演出',
      endsAt: '2026-01-01T00:00:00.000Z',
      domain: 'arts',
      status: 'published',
    },
    {
      id: 'race',
      title: '校园运动会',
      endsAt: '2026-01-02T00:00:00.000Z',
      domain: 'sports',
      status: 'finished',
    },
  ],
};

function pageClient(
  request: (path: string) => Promise<unknown>,
  uid: string | (() => string) = 'one',
) {
  return {
    request: vi.fn(async (path: string) => {
      if (path !== '/growth/atlas') return request(path);
      return {
        version: 1,
        uid: typeof uid === 'function' ? uid() : uid,
        achievements: summary.achievements.map((badge) => ({
          ...badge,
          family: 'campus',
          icon: 'spark',
          available: true,
          source: '活动核验',
        })),
        showcaseIds: [],
        showcaseRevision: 0,
        map: { configured: false, linked: false },
        counts: { registration: 2, verifiedActivity: 1, mapExploration: 0 },
        sources: { learning: 'not_configured' },
        updatedAt: '2026-10-12T00:00:00Z',
      } satisfies AchievementAtlas;
    }) as <T>(path: string) => Promise<T>,
  };
}

describe('GrowthPage', () => {
  it('resets timeline filters when the account changes and ignores stale requests', async () => {
    let resolveOld!: (value: GrowthSummary) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce(summary)
      .mockImplementationOnce(
        () =>
          new Promise<GrowthSummary>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...summary, activities: [summary.activities[0]] });
    let currentUid = 'one';
    const client = pageClient(request, () => currentUid);
    const view = render(
      <MemoryRouter>
        <GrowthPage client={client} uid="one" displayName="林" />
      </MemoryRouter>,
    );
    await screen.findByText('学生节演出');
    fireEvent.change(screen.getByLabelText('领域'), { target: { value: 'sports' } });
    currentUid = 'two';
    view.rerender(
      <MemoryRouter>
        <GrowthPage client={client} uid="two" displayName="陈" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    currentUid = 'three';
    view.rerender(
      <MemoryRouter>
        <GrowthPage client={client} uid="three" displayName="李" />
      </MemoryRouter>,
    );
    await screen.findByText('学生节演出');
    await act(async () => {
      resolveOld({ ...summary, activities: [summary.activities[1]] });
      await Promise.resolve();
    });
    expect(screen.getByLabelText('领域')).toHaveValue('all');
    expect(screen.queryByText('校园运动会')).not.toBeInTheDocument();
  });
  it('filters the timeline and safely groups missing dates', async () => {
    const request = vi.fn(async () => ({
      ...summary,
      activities: [
        ...summary.activities,
        {
          id: 'unknown',
          title: '待补充日期',
          domain: 'arts',
          endsAt: 'invalid',
          status: 'archived',
        },
      ],
    }));
    render(
      <MemoryRouter>
        <GrowthPage client={pageClient(request)} uid="one" displayName="林" />
      </MemoryRouter>,
    );
    await screen.findByText('学生节演出');
    expect(screen.getByRole('heading', { name: '日期待补充' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('领域'), { target: { value: 'sports' } });
    expect(screen.queryByText('学生节演出')).not.toBeInTheDocument();
    expect(screen.getByText('校园运动会')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('年份'), { target: { value: 'undated' } });
    expect(screen.getByText('当前筛选下暂无活动足迹。')).toBeInTheDocument();
  });
  it('retries failed requests and offers the registration collection for empty records', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ...summary,
        total: 0,
        byDomain: [],
        achievements: [],
        activities: [],
      });
    render(
      <MemoryRouter>
        <GrowthPage client={pageClient(request)} uid="one" displayName="林" />
      </MemoryRouter>,
    );
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('还没有可展示的活动足迹。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '发现更多活动' })).toHaveAttribute(
      'href',
      '/collections/registrations',
    );
  });
  it('shows account-scoped activity totals, domain counts and earned titles', async () => {
    const request = vi.fn(async () => summary);
    render(
      <MemoryRouter>
        <GrowthPage
          client={pageClient(request, 'student-1')}
          uid="student-1"
          displayName="林同学"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '个人成长档案' })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/growth/summary');
    expect(screen.getByText('林同学的成长足迹')).toBeInTheDocument();
    expect(within(screen.getByLabelText('已结束的活动报名')).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('文艺 · 1 次')).toBeInTheDocument();
    expect(screen.getByText('体育 · 1 次')).toBeInTheDocument();
    expect(await screen.findByText('初次登场')).toBeInTheDocument();
    expect(screen.getByText('持续探索')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '学生节演出' })).toHaveAttribute(
      'href',
      '/events/festival',
    );
    expect(screen.queryByRole('link', { name: '校园运动会' })).not.toBeInTheDocument();
  });
  it('preserves growth records when the private atlas is unavailable', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/growth/summary') return summary;
      throw new Error('map_unavailable');
    });
    render(
      <MemoryRouter>
        <GrowthPage
          client={{ request: request as <T>(path: string) => Promise<T> }}
          uid="one"
          displayName="林"
        />
      </MemoryRouter>,
    );
    await screen.findByText('成就图鉴暂时无法加载，请稍后重试。');
    expect(screen.getByRole('link', { name: '学生节演出' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('解锁成就')).getByText('—')).toBeInTheDocument();
  });

  it('preserves preview summary without fetching private atlas or Map bindings', async () => {
    const client = {
      previewUser: 'one',
      request: vi.fn(async () => summary) as <T>(path: string) => Promise<T>,
    };
    render(
      <MemoryRouter>
        <GrowthPage client={client} uid="one" displayName="林" />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: '学生节演出' });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith('/growth/summary');
    expect(screen.getByText('请切回本人账号后查看成就图鉴和管理地图连接。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '获取绑定码' })).not.toBeInTheDocument();
  });
});
