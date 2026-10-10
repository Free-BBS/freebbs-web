import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import type { ApiClient } from '../../core/api/client.js';
import { CollectionsLandingPage } from './CollectionsLandingPage.js';

describe('CollectionsLandingPage', () => {
  it.each([
    ['open', '开放中'],
    ['upcoming', '即将开放'],
    ['closed', '已结束'],
  ])('shows the actual %s registration state', async (status, label) => {
    const request = vi.fn().mockResolvedValue({
      featured: [
        {
          id: 'state-test',
          source: 'native_collection',
          title: '状态测试活动',
          description: '',
          organizer: '',
          closesAt: null,
          status,
        },
      ],
      showcase: [],
      canCreate: false,
    });
    render(
      <MemoryRouter>
        <CollectionsLandingPage client={{ request } as unknown as ApiClient} />
      </MemoryRouter>,
    );
    const card = await screen.findByRole('link', { name: /状态测试活动/ });
    expect(within(card).getByText(label, { exact: true })).toBeInTheDocument();
  });
  it('retries a failed dashboard request and keeps creation available inside the board for eligible members', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ featured: [], showcase: [], canCreate: true });
    render(
      <MemoryRouter>
        <CollectionsLandingPage client={{ request } as unknown as ApiClient} />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('暂无开放活动')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: '打开告示板' });
    await userEvent.click(trigger);
    const create = screen.getByRole('link', { name: /创建表单/ });
    expect(create).toHaveAttribute('href', '/collections/workbench/new');
    await userEvent.tab({ shift: true });
    expect(create).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('opens the released Map guide from the homepage and shows an honest empty activity state', async () => {
    const request = vi.fn().mockResolvedValue({ featured: [], showcase: [], canCreate: false });
    render(
      <MemoryRouter>
        <CollectionsLandingPage client={{ request } as unknown as ApiClient} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('暂无开放活动')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '浏览报名入口' })).toHaveAttribute(
      'href',
      '/collections/registrations',
    );
    expect(screen.queryByRole('link', { name: /秋季工作坊许愿池/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^frEE bbs MAP/ }));
    expect(screen.getByRole('dialog', { name: 'frEE bbs MAP' })).toHaveTextContent('已发布');
  });

  it('keeps actual activity links accessible once and restricts form creation in the noticeboard', async () => {
    const request = vi.fn().mockResolvedValue({
      featured: [
        {
          id: 'real-activity',
          source: 'development_activity',
          title: '校园音乐会',
          description: '一起来听歌',
          organizer: '文艺中心',
          coverUrl: null,
          opensAt: null,
          closesAt: null,
          location: '音乐厅',
          capacity: null,
          registrationCount: null,
          registered: false,
          status: 'open',
        },
      ],
      showcase: [],
      canCreate: false,
    });
    render(
      <MemoryRouter>
        <CollectionsLandingPage client={{ request } as unknown as ApiClient} />
      </MemoryRouter>,
    );
    const links = await screen.findAllByRole('link', { name: /校园音乐会/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute(
      'href',
      '/collections/activities/development_activity/real-activity',
    );
    await userEvent.click(screen.getByRole('button', { name: '走近看看' }));
    expect(screen.getByRole('link', { name: /报名入口/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /创建表单/ })).not.toBeInTheDocument();
  });
  it('uses the 萬事屋 name and keeps an explicit route to the complete activity catalog', async () => {
    const request = vi.fn().mockResolvedValue({ featured: [], showcase: [], canCreate: false });

    render(
      <MemoryRouter>
        <CollectionsLandingPage client={{ request } as unknown as ApiClient} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '萬事屋' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '全部活动' })).toHaveAttribute(
      'href',
      '/collections/activities',
    );
    expect(screen.getByLabelText('萬事屋告示板')).toBeInTheDocument();
  });
});
