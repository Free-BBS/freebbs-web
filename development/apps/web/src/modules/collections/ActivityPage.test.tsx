import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityWorkspace } from '@freebbs-development/contracts';
import { ApiError, type ApiClient } from '../../core/api/client.js';
import { ActivityPage } from './ActivityPage.js';

const workspace: ActivityWorkspace = {
  source: 'development_activity',
  activityId: 'one',
  revision: 1,
  activity: {
    id: 'one',
    source: 'development_activity',
    title: '校园相遇',
    description: '活动介绍',
    organizer: '体育中心',
    coverUrl: null,
    opensAt: null,
    closesAt: null,
    location: '操场',
    capacity: null,
    registrationCount: 0,
    registered: false,
    status: 'closed',
    endsAt: '2099-01-01',
  },
  intro: [{ id: 'p1', kind: 'paragraph', text: '初始介绍', assetId: null, caption: '' }],
  updates: [],
  recaps: [],
  assets: [],
  following: false,
  canEdit: true,
  canRecap: false,
  ended: false,
};
function show(request: ApiClient['request']) {
  return render(
    <MemoryRouter>
      <ActivityPage
        source="development_activity"
        activityId="one"
        client={{ request, download: vi.fn() }}
      />
    </MemoryRouter>,
  );
}
describe('independent activity workspace', () => {
  it('edits an existing timeline update using its id and the current revision', async () => {
    const update = {
      id: 'update-one',
      label: '初赛',
      description: '原安排',
      occursAt: '2026-10-10T10:00:00Z',
      authorUid: 'a',
      createdAt: '2026-10-09',
      updatedAt: '2026-10-09',
    };
    const request = vi.fn(async (_path: string, init?: RequestInit) => ({
      ...workspace,
      revision: init ? 2 : 1,
      updates: [{ ...update, description: init ? '新安排' : '原安排' }],
    }));
    show(request as ApiClient['request']);
    fireEvent.click(await screen.findByRole('button', { name: '编辑动态：初赛' }));
    expect(screen.getByLabelText('动态名称')).toHaveValue('初赛');
    fireEvent.change(screen.getByLabelText('动态说明'), { target: { value: '新安排' } });
    fireEvent.click(screen.getByRole('button', { name: '保存动态' }));
    await waitFor(() => expect(screen.queryByLabelText('动态说明')).not.toBeInTheDocument());
    expect(screen.getByText('新安排')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      '/events/workspaces/development_activity/one/updates/update-one',
      expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"revision":1') }),
    );
  });

  it('reopens an existing rich recap and saves edited content without creating a duplicate', async () => {
    const recap = {
      id: 'recap-one',
      title: '旧标题',
      blocks: workspace.intro,
      authorUid: 'a',
      createdAt: '2026-10-09',
      updatedAt: '2026-10-09',
    };
    const request = vi.fn(async (_path: string, init?: RequestInit) => ({
      ...workspace,
      ended: true,
      canRecap: true,
      recaps: [{ ...recap, title: init ? '新标题' : '旧标题' }],
    }));
    show(request as ApiClient['request']);
    fireEvent.click(await screen.findByRole('button', { name: '编辑复盘' }));
    fireEvent.change(screen.getByLabelText('复盘标题'), { target: { value: '新标题' } });
    fireEvent.change(screen.getByLabelText('段落内容 1'), { target: { value: '新的图文介绍' } });
    fireEvent.click(screen.getByRole('button', { name: '保存复盘' }));
    await screen.findByRole('heading', { name: '新标题' });
    expect(request).toHaveBeenCalledWith(
      '/events/workspaces/development_activity/one/recaps/recap-one',
      expect.objectContaining({ method: 'PUT', body: expect.stringContaining('新的图文介绍') }),
    );
  });
  it('starts a timeline entry with a valid time and a one-click status suggestion', async () => {
    show(vi.fn(async () => workspace) as ApiClient['request']);
    fireEvent.click(await screen.findByRole('button', { name: '添加动态' }));
    expect(screen.getByLabelText('日期与时间')).not.toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '开放报名' }));
    expect(screen.getByLabelText('动态名称')).toHaveValue('开放报名');
  });

  it('keeps unsaved introduction text when the prominent editing entry is pressed again', async () => {
    show(vi.fn(async () => workspace) as ApiClient['request']);
    fireEvent.click(await screen.findByRole('button', { name: '编辑活动' }));
    fireEvent.change(screen.getByLabelText('段落内容 1'), { target: { value: '继续完善的介绍' } });
    fireEvent.click(screen.getByRole('button', { name: '编辑活动' }));
    expect(screen.getByLabelText('段落内容 1')).toHaveValue('继续完善的介绍');
  });
  it('offers a clear editing entry that opens introduction layout controls', async () => {
    show(vi.fn(async () => workspace) as ApiClient['request']);
    fireEvent.click(await screen.findByRole('button', { name: '编辑活动' }));
    expect(screen.getByLabelText('段落内容 1')).toHaveValue('初始介绍');
    expect(screen.getByRole('button', { name: '保存介绍' })).toBeInTheDocument();
  });

  it('preserves a finished recap draft after a server error and publishes it on retry', async () => {
    let fail = true;
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (fail) {
          fail = false;
          throw new Error('网络中断');
        }
        return {
          ...workspace,
          ended: true,
          canRecap: true,
          revision: 2,
          recaps: [
            {
              id: 'r',
              title: '我们的回顾',
              blocks: [],
              authorUid: 'a',
              createdAt: '2026-10-09',
              updatedAt: '2026-10-09',
            },
          ],
        };
      }
      return { ...workspace, ended: true, canRecap: true };
    });
    show(request as ApiClient['request']);
    fireEvent.click(await screen.findByRole('button', { name: '写复盘' }));
    fireEvent.change(screen.getByLabelText('复盘标题'), { target: { value: '我们的回顾' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ 段落' }));
    fireEvent.change(screen.getByLabelText('段落内容 1'), { target: { value: '精彩的回忆' } });
    fireEvent.click(screen.getByRole('button', { name: '发布复盘' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
    expect(screen.getByLabelText('段落内容 1')).toHaveValue('精彩的回忆');
    fireEvent.click(screen.getByRole('button', { name: '发布复盘' }));
    await screen.findByRole('heading', { name: '我们的回顾' });
    const payload = JSON.parse(
      request.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body as string,
    );
    expect(payload.blocks[0].text).toBe('精彩的回忆');
  });
  it('sets actual completion separately from the registration deadline before enabling recap', async () => {
    const request = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? { ...workspace, revision: 2, ended: true, canRecap: true }
        : workspace,
    );
    show(request as ApiClient['request']);
    fireEvent.click(await screen.findByRole('button', { name: '编辑活动安排' }));
    fireEvent.click(screen.getByLabelText('活动已结束'));
    fireEvent.click(screen.getByRole('button', { name: '保存活动安排' }));
    await screen.findByRole('button', { name: '写复盘' });
    const payload = JSON.parse(
      request.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]?.body as string,
    );
    expect(payload).toEqual({
      revision: 1,
      startsAt: null,
      endsAt: new Date(workspace.activity.endsAt!).toISOString(),
      finished: true,
    });
  });
  it('retains introduction drafts across revision conflict and explicit reload', async () => {
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') throw new ApiError(409, 'revision_conflict', '内容已更新', null);
      return workspace;
    });
    show(request as ApiClient['request']);
    fireEvent.click(await screen.findByRole('button', { name: '编辑介绍' }));
    fireEvent.change(screen.getByLabelText('段落内容 1'), { target: { value: '未保存的介绍' } });
    fireEvent.click(screen.getByRole('button', { name: '保存介绍' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('段落内容 1')).toHaveValue('未保存的介绍');
    fireEvent.click(screen.getByRole('button', { name: '加载最新内容并保留草稿' }));
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => !init).length).toBe(2));
    expect(screen.getByLabelText('段落内容 1')).toHaveValue('未保存的介绍');
    expect(screen.queryByRole('button', { name: '写复盘' })).not.toBeInTheDocument();
  });
  it('publishes a custom dated timeline update and refreshes notification inboxes', async () => {
    const listener = vi.fn();
    window.addEventListener('freebbs-development-notifications-changed', listener);
    const request = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? {
            ...workspace,
            revision: 2,
            updates: [
              {
                id: 'u',
                label: '集合时间调整',
                description: '南门集合',
                occursAt: '2026-10-10T10:30:00Z',
                authorUid: 'a',
                createdAt: '2026-10-09',
                updatedAt: '2026-10-09',
              },
            ],
          }
        : workspace,
    );
    show(request as ApiClient['request']);
    fireEvent.click(await screen.findByRole('button', { name: '添加动态' }));
    fireEvent.change(screen.getByLabelText('动态名称'), { target: { value: '集合时间调整' } });
    fireEvent.change(screen.getByLabelText('日期与时间'), {
      target: { value: '2026-10-10T18:30' },
    });
    fireEvent.change(screen.getByLabelText('动态说明'), { target: { value: '南门集合' } });
    fireEvent.click(screen.getByRole('button', { name: '发布动态' }));
    await screen.findByText('集合时间调整');
    expect(listener).toHaveBeenCalledOnce();
    const payload = JSON.parse(
      request.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body as string,
    );
    expect(payload.revision).toBe(1);
    expect(payload.label).toBe('集合时间调整');
    expect(Number.isNaN(Date.parse(payload.occursAt))).toBe(false);
    window.removeEventListener('freebbs-development-notifications-changed', listener);
  });
  it('hides authoring controls for ordinary readers and toggles the bookmark', async () => {
    const request = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'PUT' ? { following: true } : { ...workspace, canEdit: false },
    );
    show(request as ApiClient['request']);
    fireEvent.click(await screen.findByRole('button', { name: '关注活动' }));
    await screen.findByRole('button', { name: '已关注活动' });
    expect(screen.queryByRole('button', { name: '编辑介绍' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加动态' })).not.toBeInTheDocument();
  });
});
