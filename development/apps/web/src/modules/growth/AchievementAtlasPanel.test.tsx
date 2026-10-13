import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AchievementAtlas, MapConnectionStatus } from '@freebbs-development/contracts';
import { ApiError } from '../../core/api/client.js';
import { AchievementAtlasPanel } from './AchievementAtlasPanel.js';

const atlas: AchievementAtlas = {
  version: 1,
  uid: 'one',
  showcaseIds: ['campus-first'],
  showcaseRevision: 4,
  map: { configured: true, linked: false },
  counts: { registration: 8, verifiedActivity: 2, mapExploration: 3 },
  sources: { learning: 'unavailable' },
  updatedAt: '2026-10-12T03:00:00Z',
  achievements: ['learning', 'creation', 'campus', 'contribution', 'map'].map((family, i) => ({
    id: `${family}-first`,
    title: ['回路初亮', '初次发声', '初次登场', '相遇发起人', '开拓先声'][i],
    description: `完成${i + 1}次核验记录`,
    family: family as AchievementAtlas['achievements'][number]['family'],
    icon: 'spark',
    unlocked: i > 0,
    progress: i,
    target: i + 1,
    available: i > 0,
    source: ['学习记录', '原创发布', '核验到场', '活动发布', 'Map纪念'][i],
  })),
};
type Init = { method?: string; body?: BodyInit | null };
function setup(handler?: (path: string, init?: Init) => Promise<unknown>) {
  const request = vi.fn(handler ?? (async () => atlas));
  const client = { request: request as <T>(path: string, init?: Init) => Promise<T> };
  return { request, client, view: render(<AchievementAtlasPanel client={client} uid="one" />) };
}
afterEach(() => vi.useRealTimers());

describe('AchievementAtlasPanel', () => {
  it('separates shared daily check-ins from learning and preserves retired showcase items', async () => {
    const old = {
      ...atlas.achievements[4],
      id: 'builder',
      title: '建设者',
      unlocked: true,
      source: '旧版地图收藏',
    };
    const daily = {
      ...atlas.achievements[0],
      id: 'learning-checkin-7',
      title: '日积月累',
      family: 'daily' as const,
      description: '学习端与发展端共用的平台每日签到',
      source: '平台每日签到',
      available: true,
      unlocked: true,
      progress: 7,
      target: 7,
    };
    setup(async () => ({
      ...atlas,
      achievements: [...atlas.achievements, daily],
      archivedAchievements: [old],
      showcaseIds: ['builder'],
      showcaseAchievements: [old],
    }));
    await screen.findByRole('button', { name: '日积月累 查看详情' });
    fireEvent.click(screen.getByRole('button', { name: '日常成长' }));
    expect(
      within(screen.getByLabelText('成就收藏')).getAllByRole('button', { name: /查看详情/ }),
    ).toHaveLength(1);
    expect(within(screen.getByLabelText('成就陈列')).getByText('建设者')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/往期收藏/));
    expect(screen.getByRole('button', { name: '建设者 查看详情' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '日积月累 查看详情' }));
    expect(
      within(screen.getByRole('dialog')).getByText('学习端与发展端共用的平台每日签到'),
    ).toBeInTheDocument();
  });
  it('filters all five families and keeps unavailable learning progress honest', async () => {
    setup();
    await screen.findByRole('button', { name: '回路初亮 查看详情' });
    expect(within(screen.getByLabelText('已结束报名')).getByText('8')).toBeInTheDocument();
    expect(within(screen.getByLabelText('已核验参加')).getByText('2')).toBeInTheDocument();
    for (const [label, title] of [
      ['学习探索', '回路初亮'],
      ['创作表达', '初次发声'],
      ['校园同行', '初次登场'],
      ['组织贡献', '相遇发起人'],
      ['地图收藏', '开拓先声'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(screen.getAllByRole('button', { name: /查看详情/ })).toHaveLength(1);
      expect(screen.getByRole('button', { name: `${title} 查看详情` })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: '学习探索' }));
    fireEvent.click(screen.getByRole('button', { name: '回路初亮 查看详情' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('完成1次核验记录')).toBeInTheDocument();
    expect(within(dialog).getByText('学习记录')).toBeInTheDocument();
    expect(within(dialog).getByText('来源暂不可用')).toBeInTheDocument();
    expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '解锁后可陈列' })).toBeDisabled();
  });

  it('saves showcase with the server revision and reloads on a cross-device conflict', async () => {
    const next = { ...atlas, showcaseIds: ['map-first'], showcaseRevision: 5 };
    let atlasReads = 0;
    const { request } = setup(async (path, init) => {
      if (init?.method === 'PUT') throw new ApiError(409, 'showcase_conflict', 'conflict', null);
      return path === '/growth/atlas' && ++atlasReads > 1 ? next : atlas;
    });
    await screen.findByRole('button', { name: '初次发声 查看详情' });
    fireEvent.click(screen.getByRole('button', { name: '初次发声 查看详情' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '加入陈列' }));
    await screen.findByText('陈列已在另一端更新，已载入最新选择，请重新选择。');
    expect(request).toHaveBeenCalledWith(
      '/growth/showcase',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ ids: ['campus-first', 'creation-first'], revision: 4 }),
      }),
    );
    expect(within(screen.getByLabelText('成就陈列')).getByText('开拓先声')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('成就陈列')).queryByText('初次登场'),
    ).not.toBeInTheDocument();
  });

  it('shows a claimed Map account before explicit confirmation and refreshes its atlas', async () => {
    const pending = {
      id: 'binding-1',
      code: '12345678',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: 'pending' as const,
    };
    let status: MapConnectionStatus = { configured: true, linked: false, pending };
    const { request } = setup(async (path) => {
      if (path === '/growth/map/binding') return pending;
      if (path === '/growth/map/status') return status;
      if (path.endsWith('/confirm')) return { configured: true, linked: true, publicId: 'EE2026' };
      return atlas;
    });
    await screen.findByRole('button', { name: '获取绑定码' });
    fireEvent.click(screen.getByRole('button', { name: '获取绑定码' }));
    expect(await screen.findByText('12345678')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认连接此账号' })).not.toBeInTheDocument();
    status = { ...status, pending: { ...pending, status: 'claimed', publicId: 'EE2026' } };
    fireEvent.click(screen.getByRole('button', { name: '刷新连接状态' }));
    const confirm = await screen.findByRole('button', { name: '确认连接此账号' });
    expect(screen.getByText('EE2026')).toBeInTheDocument();
    fireEvent.click(confirm);
    await screen.findByText('已连接');
    expect(request).toHaveBeenCalledWith('/growth/map/binding/binding-1/confirm', {
      method: 'POST',
    });
    await waitFor(() =>
      expect(request.mock.calls.filter(([path]) => path === '/growth/atlas')).toHaveLength(2),
    );
  });

  it('polls only a pending connection and disables confirmation after expiry', async () => {
    vi.useFakeTimers();
    const pending = {
      id: 'expired',
      code: '87654321',
      expiresAt: new Date(Date.now() + 5_000).toISOString(),
      status: 'claimed' as const,
      publicId: 'EE1',
    };
    const { request } = setup(async (path) =>
      path === '/growth/map/status'
        ? { ...atlas.map, pending }
        : { ...atlas, map: { ...atlas.map, pending } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: '确认连接此账号' })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(screen.getByText('绑定码已过期，请重新获取。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认连接此账号' })).not.toBeInTheDocument();
    expect(request.mock.calls.some(([path]) => path === '/growth/map/status')).toBe(true);
  });

  it('clears the old account immediately and ignores late showcase writes', async () => {
    let resolveSave!: (value: AchievementAtlas) => void;
    const { view, client } = setup(async (path, init) => {
      if (init?.method === 'PUT')
        return new Promise<AchievementAtlas>((resolve) => {
          resolveSave = resolve;
        });
      return atlas;
    });
    await screen.findByRole('button', { name: '初次发声 查看详情' });
    fireEvent.click(screen.getByRole('button', { name: '初次发声 查看详情' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '加入陈列' }));
    const nextClient = {
      request: vi.fn(async () => ({ ...atlas, uid: 'two', achievements: [], showcaseIds: [] })) as <
        T,
      >(
        path: string,
      ) => Promise<T>,
    };
    view.rerender(<AchievementAtlasPanel client={nextClient} uid="two" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('初次登场')).not.toBeInTheDocument();
    await screen.findByText('还没有可展示的成就。');
    await act(async () => resolveSave({ ...atlas, showcaseIds: ['creation-first'] }));
    expect(screen.queryByText('初次发声')).not.toBeInTheDocument();
    expect(client.request).toHaveBeenCalled();
  });

  it('keeps slots unchanged on a failed save and fills an existing empty slot', async () => {
    const ids = ['campus-first', null, 'map-first', null, null, null];
    const { request } = setup(async (_path, init) => {
      if (init?.method === 'PUT') throw new Error('offline');
      return { ...atlas, showcaseIds: ids };
    });
    fireEvent.click(await screen.findByRole('button', { name: '初次发声 查看详情' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '加入陈列' }));
    await screen.findByText('陈列保存失败，当前选择未变，请重试。');
    expect(request).toHaveBeenCalledWith('/growth/showcase', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['campus-first', 'creation-first', 'map-first', null, null, null],
        revision: 4,
      }),
    });
    expect(
      within(screen.getByLabelText('成就陈列')).queryByText('初次发声'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('陈列已保存。')).not.toBeInTheDocument();
  });

  it('does not claim to have reloaded a revision conflict when that reload fails', async () => {
    let reads = 0;
    setup(async (_path, init) => {
      if (init?.method === 'PUT')
        throw new ApiError(409, 'showcase_revision_conflict', 'conflict', null);
      if (++reads > 1) throw new Error('offline');
      return atlas;
    });
    fireEvent.click(await screen.findByRole('button', { name: '初次发声 查看详情' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '加入陈列' }));
    await screen.findByText('最新陈列暂时无法获取，请刷新图鉴后再选择。');
    expect(
      screen.queryByText('陈列已在另一端更新，已载入最新选择，请重新选择。'),
    ).not.toBeInTheDocument();
  });

  it('suspends automatic connection reads while explicit confirmation is in flight', async () => {
    vi.useFakeTimers();
    let resolveConfirm!: (value: MapConnectionStatus) => void;
    const pending = {
      id: 'in-flight',
      code: 'ABCDEFGH',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: 'claimed' as const,
      publicId: 'EE0009',
    };
    const { request } = setup(async (path) => {
      if (path.endsWith('/confirm'))
        return new Promise<MapConnectionStatus>((resolve) => {
          resolveConfirm = resolve;
        });
      if (path === '/growth/map/status') return { configured: true, linked: false, pending };
      return { ...atlas, map: { ...atlas.map, pending } };
    });
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: '确认连接此账号' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(request.mock.calls.some(([path]) => path === '/growth/map/status')).toBe(false);
    await act(async () => {
      resolveConfirm({ configured: true, linked: true, publicId: 'EE0009' });
    });
    expect(screen.getByText('已连接')).toBeInTheDocument();
  });

  it('requires explicit unlink confirmation and reloads retained achievements afterward', async () => {
    const { request } = setup(async (path, init) => {
      if (path === '/growth/map/binding' && init?.method === 'DELETE')
        return { configured: true, linked: false };
      return { ...atlas, map: { configured: true, linked: true, publicId: 'EE0007' } };
    });
    fireEvent.click(await screen.findByRole('button', { name: '解除连接' }));
    expect(request.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '确认解除连接' }));
    await screen.findByText('尚未连接');
    expect(request).toHaveBeenCalledWith('/growth/map/binding', { method: 'DELETE' });
    expect(screen.getByRole('button', { name: '开拓先声 查看详情' })).toBeInTheDocument();
  });
  it('isolates a replacement client for the same uid from delayed binding and showcase writes', async () => {
    let resolveBinding!: (value: unknown) => void;
    let resolveSave!: (value: AchievementAtlas) => void;
    const loaded = vi.fn();
    const oldClient = {
      request: vi.fn(async (path: string, init?: Init) => {
        if (path === '/growth/map/binding')
          return new Promise((resolve) => {
            resolveBinding = resolve;
          });
        if (init?.method === 'PUT')
          return new Promise<AchievementAtlas>((resolve) => {
            resolveSave = resolve;
          });
        return atlas;
      }) as <T>(path: string, init?: Init) => Promise<T>,
    };
    const view = render(
      <AchievementAtlasPanel client={oldClient} uid="one" onAtlasLoaded={loaded} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '获取绑定码' }));
    fireEvent.click(screen.getByRole('button', { name: '初次发声 查看详情' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '加入陈列' }));
    const next = { ...atlas, achievements: [], showcaseIds: [] };
    const nextClient = { request: vi.fn(async () => next) as <T>(path: string) => Promise<T> };
    view.rerender(<AchievementAtlasPanel client={nextClient} uid="one" onAtlasLoaded={loaded} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await screen.findByText('还没有可展示的成就。');
    const callbacks = loaded.mock.calls.length;
    await act(async () => {
      resolveBinding({
        id: 'old',
        code: 'OLDSECRET',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      resolveSave({ ...atlas, showcaseIds: ['creation-first'] });
    });
    expect(screen.queryByText('OLDSECRET')).not.toBeInTheDocument();
    expect(screen.queryByText('初次发声')).not.toBeInTheDocument();
    expect(loaded).toHaveBeenCalledTimes(callbacks);
  });

  it('rejects another user atlas and ignores reads after unmount', async () => {
    let resolveRead!: (value: AchievementAtlas) => void;
    const loaded = vi.fn();
    const client = {
      request: vi.fn(
        () =>
          new Promise<AchievementAtlas>((resolve) => {
            resolveRead = resolve;
          }),
      ) as <T>(path: string) => Promise<T>,
    };
    const view = render(<AchievementAtlasPanel client={client} uid="one" onAtlasLoaded={loaded} />);
    view.unmount();
    await act(async () => resolveRead(atlas));
    expect(loaded).not.toHaveBeenCalled();
    render(
      <AchievementAtlasPanel
        client={{
          request: (async () => ({ ...atlas, uid: 'other' })) as <T>(path: string) => Promise<T>,
        }}
        uid="one"
      />,
    );
    await screen.findByText('成就图鉴暂时无法加载，请稍后重试。');
    expect(screen.queryByRole('button', { name: '获取绑定码' })).not.toBeInTheDocument();
  });

  it('does not request a private atlas or binding in identity preview', async () => {
    const client = {
      previewUser: 'one',
      request: vi.fn(async () => atlas) as <T>(path: string) => Promise<T>,
    };
    render(<AchievementAtlasPanel client={client} uid="one" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(client.request).not.toHaveBeenCalled();
    expect(screen.getByText('请切回本人账号后查看成就图鉴和管理地图连接。')).toBeInTheDocument();
  });
  it('ignores old status reads when the same account gets a new client', async () => {
    let resolveStatus!: (value: MapConnectionStatus) => void;
    const { view } = setup(async (path) => {
      if (path === '/growth/map/status')
        return new Promise<MapConnectionStatus>((resolve) => {
          resolveStatus = resolve;
        });
      return atlas;
    });
    fireEvent.click(await screen.findByRole('button', { name: '刷新连接状态' }));
    const next = { ...atlas, map: { configured: true, linked: true, publicId: 'NEW' } };
    const client = { request: (async () => next) as <T>(path: string) => Promise<T> };
    view.rerender(<AchievementAtlasPanel client={client} uid="one" />);
    await screen.findByText('NEW');
    await act(async () => resolveStatus({ configured: true, linked: true, publicId: 'OLD' }));
    expect(screen.getByText('NEW')).toBeInTheDocument();
    expect(screen.queryByText('OLD')).not.toBeInTheDocument();
  });

  it('clears cards immediately and discards a delayed atlas when preview begins', async () => {
    let resolveRead!: (value: AchievementAtlas) => void;
    const loaded = vi.fn();
    const client = {
      previewUser: null as string | null,
      request: vi.fn(
        () =>
          new Promise<AchievementAtlas>((resolve) => {
            resolveRead = resolve;
          }),
      ) as <T>(path: string) => Promise<T>,
    };
    const view = render(<AchievementAtlasPanel client={client} uid="one" onAtlasLoaded={loaded} />);
    client.previewUser = 'one';
    view.rerender(<AchievementAtlasPanel client={client} uid="one" onAtlasLoaded={loaded} />);
    await act(async () => resolveRead(atlas));
    expect(loaded).not.toHaveBeenCalled();
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('初次发声')).not.toBeInTheDocument();
  });
});
