import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrowthSummary } from '@freebbs-development/contracts';
import { GrowthPage } from './GrowthPage.js';

const summary: GrowthSummary = {
  total: 1,
  basis: 'completed_registration',
  byDomain: [{ key: 'arts', label: '文艺', count: 1 }],
  activities: [],
  achievements: [
    {
      id: 'first-step',
      title: '初次登场',
      description: '累积 1 次已结束且未取消的活动报名记录',
      series: 'milestone',
      icon: 'sprout',
      unlocked: true,
      progress: 1,
      target: 1,
    },
    {
      id: 'specialty-arts',
      title: '舞台拾光者',
      description: '累积文艺领域 3 次已结束且未取消的活动报名记录',
      series: 'specialty',
      icon: 'arts',
      unlocked: false,
      progress: 1,
      target: 3,
    },
    {
      id: 'multi-domain',
      title: '跨界体验家',
      description: '在 3 个已知领域拥有已结束且未取消的活动报名记录（不含「其他」）',
      series: 'diversity',
      icon: 'compass',
      unlocked: false,
      progress: 1,
      target: 3,
    },
    {
      id: 'two-months',
      title: '月间拾光',
      description: '覆盖 2 个不同月份（按北京时间的有效结束日期统计，无需连续）',
      series: 'rhythm',
      icon: 'calendar',
      unlocked: false,
      progress: 1,
      target: 2,
    },
  ],
};

function setup(uid = 'one', data = summary) {
  const request = vi.fn(async () => data);
  const client = { request: request as <T>(path: string) => Promise<T> };
  const view = render(
    <MemoryRouter>
      <GrowthPage client={client} uid={uid} displayName="林" />
    </MemoryRouter>,
  );
  return { ...view, client };
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

describe('growth achievement collection', () => {
  it('filters all four badge series while keeping a relevant next goal', async () => {
    setup();
    const album = await screen.findByRole('list', { name: '徽章收藏' });
    expect(within(album).getAllByRole('listitem')).toHaveLength(4);
    for (const [name, title] of [
      ['领域专长', '舞台拾光者'],
      ['跨界探索', '跨界体验家'],
      ['成长节奏', '月间拾光'],
      ['成长里程', '初次登场'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
      expect(within(album).getAllByRole('listitem')).toHaveLength(1);
      expect(within(album).getByText(title)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: '全部成就' }));
    expect(within(album).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('region', { name: '下一枚收藏' })).toHaveTextContent('月间拾光');
  });

  it('shows exact locked conditions and progress, closes with Escape and returns focus', async () => {
    const user = userEvent.setup();
    setup();
    const trigger = await screen.findByRole('button', { name: '查看舞台拾光者详情' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '舞台拾光者' });
    expect(dialog).toHaveTextContent(summary.achievements[1].description);
    expect(within(dialog).getByRole('progressbar')).toHaveAttribute('value', '1');
    expect(dialog).toHaveTextContent('1 / 3');
    expect(within(dialog).getByRole('button', { name: '解锁后可展示' })).toBeDisabled();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('persists only unlocked display titles locally and isolates account changes', async () => {
    const view = setup();
    fireEvent.click(await screen.findByRole('button', { name: '查看初次登场详情' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '设为展示称号' }),
    );
    expect(screen.getByLabelText('成长档案展示称号')).toHaveTextContent('初次登场');
    expect(localStorage.getItem('freebbs:growth-title:one')).toBe('first-step');
    expect(view.client.request).toHaveBeenCalledTimes(1);
    view.rerender(
      <MemoryRouter>
        <GrowthPage client={view.client} uid="two" displayName="陈" />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText('成长档案展示称号')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('成长档案展示称号')).toHaveTextContent('尚未选择');
    expect(localStorage.getItem('freebbs:growth-title:two')).toBeNull();
    view.rerender(
      <MemoryRouter>
        <GrowthPage client={view.client} uid="one" displayName="林" />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('成长档案展示称号')).toHaveTextContent('初次登场');
    fireEvent.click(screen.getByRole('button', { name: '清除展示称号' }));
    expect(localStorage.getItem('freebbs:growth-title:one')).toBeNull();
  });

  it('never displays a stored title absent from the current unlocked list', async () => {
    localStorage.setItem('freebbs:growth-title:one', 'specialty-arts');
    setup();
    expect(await screen.findByLabelText('成长档案展示称号')).toHaveTextContent('尚未选择');
  });

  it('continues displaying a session choice when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '查看初次登场详情' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '设为展示称号' }),
    );
    expect(screen.getByLabelText('成长档案展示称号')).toHaveTextContent('初次登场');
    expect(screen.getByRole('status')).toHaveTextContent('本次选择仅在当前页面展示');
  });
});
