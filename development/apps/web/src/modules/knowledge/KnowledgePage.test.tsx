import { render as renderView, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

function render(ui: ReactNode) {
  return renderView(<MemoryRouter>{ui}</MemoryRouter>);
}
import { describe, expect, it, vi } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import { ApiError, type ApiClient } from '../../core/api/client.js';
import { KnowledgePage } from './KnowledgePage.js';

const admin: UserContext = {
  uid: 'demo-admin',
  displayName: '发展端管理员',
  avatarUrl: null,
  baseRole: 'student',
  roles: ['platform.super_admin'],
  tags: [],
};

const draft = {
  id: 'knowledge-1',
  type: 'retrospective' as const,
  title: '活动复盘模板',
  body: '记录目标、执行情况和改进项。',
  status: 'draft' as 'draft' | 'published' | 'archived',
  ownerUid: 'demo-admin',
  scope: { type: 'public', id: '*' },
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
};

describe('KnowledgePage', () => {
  it('offers a linked preview without rendering the full long body on the directory', async () => {
    const entry = { ...draft, summary: '简短摘要', body: '完整正文'.repeat(150) };
    const request = vi.fn().mockResolvedValue([entry]);
    render(<KnowledgePage client={{ request } as unknown as ApiClient} user={admin} />);
    expect(await screen.findByRole('link', { name: '活动复盘模板' })).toHaveAttribute(
      'href',
      '/knowledge/knowledge-1',
    );
    expect(screen.getByText('简短摘要')).toBeInTheDocument();
    expect(screen.queryByText(entry.body)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑 活动复盘模板' })).toBeInTheDocument();
  });
  it('searches title, summary, tags and body, and edits readability metadata in a drawer', async () => {
    const entry = {
      ...draft,
      category: '活动运营',
      tags: ['交接', '复盘'],
      summary: '活动结束后的经验整理。',
      maintainedAt: '2026-09-01T00:00:00.000Z',
      maintainerUid: 'demo-admin',
    };
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/knowledge/entries?audience=general') return [entry];
      if (path === '/knowledge/entries' && init?.method === 'PATCH') return entry;
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    render(<KnowledgePage client={{ request } as unknown as ApiClient} user={admin} />);

    await screen.findByText('活动复盘模板');
    expect(screen.getByText('活动结束后的经验整理。')).toBeInTheDocument();
    expect(screen.getByText('交接')).toBeInTheDocument();
    expect(screen.getByText('维护于 2026-09-01')).toBeInTheDocument();
    expect(screen.getByText('维护人：demo-admin')).toBeInTheDocument();
    const search = screen.getByRole('search', { name: '搜索经验库' });
    await user.type(within(search).getByLabelText('搜索'), '记录目标');
    expect(screen.getByText('活动复盘模板')).toBeInTheDocument();
    await user.clear(within(search).getByLabelText('搜索'));
    await user.type(within(search).getByLabelText('搜索'), '复盘');
    expect(screen.getByText('活动复盘模板')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '编辑 活动复盘模板' }));
    expect(screen.getByRole('dialog', { name: '编辑经验' })).toBeInTheDocument();
    expect(screen.getByLabelText('摘要')).toHaveValue('活动结束后的经验整理。');
    expect(screen.getByLabelText('维护日期')).toHaveValue('2026-09-01T00:00:00.000Z');
    expect(screen.getByLabelText('维护人')).toHaveValue('demo-admin');
    await user.clear(screen.getByLabelText('分类'));
    await user.type(screen.getByLabelText('分类'), '经验沉淀');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    expect(request).toHaveBeenCalledWith(
      '/knowledge/entries',
      expect.objectContaining({ body: expect.stringContaining('"category":"经验沉淀"') }),
    );
  });

  it('distinguishes loading, empty, error and successful list states', async () => {
    let resolveList!: (value: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => {
      resolveList = resolve;
    });
    const loadingClient = { request: vi.fn().mockReturnValue(pending) } as unknown as ApiClient;
    const loadingView = render(<KnowledgePage client={loadingClient} user={admin} />);
    expect(screen.getByText('正在加载…')).toBeInTheDocument();
    resolveList([draft]);
    expect(await screen.findByText('活动复盘模板')).toBeInTheDocument();
    loadingView.unmount();

    const emptyClient = {
      request: vi.fn().mockResolvedValue([]),
    } as unknown as ApiClient;
    const emptyView = render(<KnowledgePage client={emptyClient} user={admin} />);
    expect(await screen.findByText('经验库中还没有内容')).toBeInTheDocument();
    emptyView.unmount();

    const errorClient = {
      request: vi.fn().mockRejectedValue(new ApiError(503, 'module_disabled', '暂时不可用', null)),
    } as unknown as ApiClient;
    render(<KnowledgePage client={errorClient} user={admin} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法加载经验库');
  });

  it('validates and creates a draft, then publishes it and refreshes the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const entries = [draft];
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (path === '/knowledge/entries?audience=general' && method === 'GET') return [...entries];
      if (path === '/knowledge/entries' && method === 'POST') {
        const input = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const created = { ...draft, id: 'knowledge-2', ...input };
        entries.push(created as typeof draft);
        return created;
      }
      if (path === '/knowledge/entries/knowledge-1/transitions' && method === 'POST') {
        entries[0] = { ...entries[0], status: 'published' };
        return entries[0];
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    const user = userEvent.setup();
    render(<KnowledgePage client={{ request } as unknown as ApiClient} user={admin} />);

    await screen.findByText('活动复盘模板');
    await user.click(screen.getByRole('button', { name: '新建经验' }));
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(screen.getByText('标题和正文不能为空')).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText('经验标题'), '部门交接清单');
    await user.type(screen.getByLabelText('经验正文'), '列出账号、联系人和周期任务。');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(await screen.findByRole('status')).toHaveTextContent('草稿已创建');
    expect(request).toHaveBeenCalledWith(
      '/knowledge/entries',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          category: 'general',
          tags: [],
          summary: '',
          maintainedAt: null,
          maintainerUid: null,
          type: 'workflow',
          title: '部门交接清单',
          body: '列出账号、联系人和周期任务。',
          status: 'draft',
          audience: 'general',
          organizationId: null,
          scope: { type: 'public', id: '*' },
        }),
      }),
    );
    expect(await screen.findByText('部门交接清单')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '发布 活动复盘模板' }));
    expect(await screen.findByRole('status')).toHaveTextContent('经验已发布');
    expect(request).toHaveBeenCalledWith(
      '/knowledge/entries/knowledge-1/transitions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ to: 'published' }),
      }),
    );
    expect(screen.queryByRole('button', { name: '发布 活动复盘模板' })).not.toBeInTheDocument();
    expect(
      request.mock.calls.filter(
        ([path, init]) => path === '/knowledge/entries?audience=general' && !init,
      ),
    ).toHaveLength(3);
  });

  it('edits content and confirms publish, withdraw, and archive without optimistic corruption', async () => {
    const entries = [{ ...draft }];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (path === '/knowledge/entries?audience=general' && method === 'GET')
        return structuredClone(entries);
      if (path === '/knowledge/entries' && method === 'PATCH') {
        const input = JSON.parse(String(init?.body)) as {
          id: string;
          title?: string;
          body?: string;
        };
        entries[0] = { ...entries[0], ...input };
        return structuredClone(entries[0]);
      }
      if (path === '/knowledge/entries/knowledge-1/transitions' && method === 'POST') {
        const input = JSON.parse(String(init?.body)) as { to: typeof draft.status };
        entries[0] = { ...entries[0], status: input.to };
        return structuredClone(entries[0]);
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    const user = userEvent.setup();
    render(<KnowledgePage client={{ request } as unknown as ApiClient} user={admin} />);

    await screen.findByText('活动复盘模板');
    expect(screen.getByText('草稿')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '编辑 活动复盘模板' }));
    await user.clear(screen.getByLabelText('编辑标题'));
    await user.type(screen.getByLabelText('编辑标题'), '活动复盘与改进');
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    expect(confirm).toHaveBeenCalledWith('确认保存“活动复盘模板”的修改吗？');
    expect(await screen.findByText('活动复盘与改进')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      '/knowledge/entries',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.not.stringContaining('status'),
      }),
    );

    await user.click(screen.getByRole('button', { name: '发布 活动复盘与改进' }));
    expect(confirm).toHaveBeenCalledWith('确认发布“活动复盘与改进”吗？');
    expect(await screen.findByText('已发布')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '撤回 活动复盘与改进' }));
    expect(confirm).toHaveBeenCalledWith('确认撤回“活动复盘与改进”吗？');
    expect(await screen.findByText('草稿')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '发布 活动复盘与改进' }));
    expect(await screen.findByText('已发布')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '归档 活动复盘与改进' }));
    expect(confirm).toHaveBeenCalledWith('确认归档“活动复盘与改进”吗？');
    expect(await screen.findByText('已归档')).toBeInTheDocument();
  });

  it('shows the server error and preserves the visible published state when archiving fails', async () => {
    const published = { ...draft, status: 'published' as const };
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/knowledge/entries?audience=general' && (init?.method ?? 'GET') === 'GET')
        return [published];
      throw new ApiError(409, 'invalid_state_transition', '状态已经发生变化', 'request-1');
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<KnowledgePage client={{ request } as unknown as ApiClient} user={admin} />);

    await screen.findByText('已发布');
    await user.click(screen.getByRole('button', { name: '归档 活动复盘模板' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('状态已经发生变化');
    expect(screen.getByText('已发布')).toBeInTheDocument();
    expect(screen.queryByText('已归档')).not.toBeInTheDocument();
  });
});
