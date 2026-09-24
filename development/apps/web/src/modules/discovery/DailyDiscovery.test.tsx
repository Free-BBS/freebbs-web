import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyDiscovery } from './DailyDiscovery.js';
import { FreeBbsMapAction } from './FreeBbsMapAction.js';
import { preferenceKey } from './model.js';

const config = {
  enabled: true,
  allowedKinds: ['activity', 'knowledge'] as const,
  excludedKeys: [],
  suggestedInterests: ['运动', '音乐'],
};
const request = vi.fn(async (path: string) => {
  if (path === '/events/activities')
    return [
      { id: 'run', title: '跑步活动', description: '运动', status: 'published', startsAt: null },
    ];
  if (path === '/knowledge/entries?audience=general')
    return [{ id: 'music', title: '音乐入门', body: '音乐指南', status: 'published' }];
  throw new Error(path);
});
const client = { request: request as <T>(path: string) => Promise<T> };
const mount = (uid = 'alice') =>
  render(
    <MemoryRouter>
      <DailyDiscovery client={client} uid={uid} config={config} />
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
describe('DailyDiscovery', () => {
  it('rotates results and saves explicit preferences across mounts per account', async () => {
    const user = userEvent.setup();
    const view = mount();
    const first = (await screen.findByRole('link', { name: '去看看' })).getAttribute('href');
    await user.click(screen.getByRole('button', { name: '换一个' }));
    expect(screen.getByRole('link', { name: '去看看' }).getAttribute('href')).not.toBe(first);
    await user.click(screen.getByRole('button', { name: '偏好设置' }));
    const drawer = within(screen.getByRole('dialog'));
    await user.click(drawer.getByRole('checkbox', { name: '活动' }));
    await user.type(drawer.getByRole('textbox', { name: '兴趣关键词' }), '音乐');
    await user.click(drawer.getByRole('button', { name: '保存偏好' }));
    expect(await screen.findByRole('heading', { name: '音乐入门' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(preferenceKey('alice')) ?? '{}').kinds).toEqual([
      'knowledge',
    ]);
    view.unmount();
    mount();
    expect(await screen.findByRole('heading', { name: '音乐入门' })).toBeInTheDocument();
    expect(localStorage.getItem(preferenceKey('bob'))).toBeNull();
  });
  it('offers recovery for partial failures and strict empty matches', async () => {
    const partial = {
      request: vi.fn(async (path: string) => {
        if (path.includes('knowledge')) throw new Error('offline');
        return request(path);
      }) as <T>(path: string) => Promise<T>,
    };
    localStorage.setItem(
      preferenceKey('alice'),
      JSON.stringify({ interests: ['天文'], explore: false }),
    );
    render(
      <MemoryRouter>
        <DailyDiscovery client={partial} uid="alice" config={config} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('暂时没有符合偏好的内容')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试加载' })).toBeInTheDocument();
  });
  it('does not request candidates when disabled', () => {
    render(
      <MemoryRouter>
        <DailyDiscovery client={client} uid="alice" config={{ ...config, enabled: false }} />
      </MemoryRouter>,
    );
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: '今日随机发现' })).not.toBeInTheDocument();
  });
  it('waits for all sources before showing a stable daily choice', async () => {
    let finishKnowledge: (value: unknown) => void = () => {};
    const delayed = {
      request: vi.fn((path: string) =>
        path.includes('knowledge')
          ? new Promise((resolve) => {
              finishKnowledge = resolve;
            })
          : request(path),
      ) as <T>(path: string) => Promise<T>,
    };
    render(
      <MemoryRouter>
        <DailyDiscovery client={delayed} uid="alice" config={config} />
      </MemoryRouter>,
    );
    await screen.findByText('正在寻找今天的新发现…');
    expect(screen.queryByRole('link', { name: '去看看' })).not.toBeInTheDocument();
    finishKnowledge([]);
    expect(await screen.findByRole('heading', { name: '跑步活动' })).toBeInTheDocument();
  });
  it('uses the live activity list and removes a just-finished recommendation', async () => {
    const activities = [{ id: 'live', title: '即时活动', status: 'published', startsAt: null }];
    const onlyActivities = { ...config, allowedKinds: ['activity'] as const };
    const view = render(
      <MemoryRouter>
        <DailyDiscovery
          client={client}
          uid="alice"
          config={onlyActivities}
          activities={activities}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: '即时活动' })).toBeInTheDocument();
    view.rerender(
      <MemoryRouter>
        <DailyDiscovery
          client={client}
          uid="alice"
          config={onlyActivities}
          activities={[{ ...activities[0]!, status: 'finished' }]}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('heading', { name: '即时活动' })).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
  it('links to a configured map or explains the missing direct link', async () => {
    const view = render(<FreeBbsMapAction url="https://wxaurl.cn/example" />);
    expect(screen.getByRole('link', { name: /frEE bbs MAP/ })).toHaveAttribute(
      'href',
      'https://wxaurl.cn/example',
    );
    view.rerender(<FreeBbsMapAction url="" />);
    await userEvent.click(screen.getByRole('button', { name: /frEE bbs MAP/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('小程序尚未发布');
  });
});
