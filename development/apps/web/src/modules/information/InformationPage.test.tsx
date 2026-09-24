import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import { ApiError, type ApiClient } from '../../core/api/client.js';
import { InformationPage } from './InformationPage.js';

const admin: UserContext & { policies: Array<{ action: string; effect: 'allow' }> } = {
  uid: 'demo-admin',
  displayName: '发展端管理员',
  avatarUrl: null,
  baseRole: 'student',
  roles: ['platform.super_admin'],
  tags: [],
  policies: [{ action: '*', effect: 'allow' }],
};
const student: UserContext = {
  uid: 'demo-student',
  displayName: '普通同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};
const announcement = {
  id: 'announcement-1',
  title: '发展平台开放测试',
  body: '欢迎提交建议和问题。',
  status: 'draft' as const,
  ownerUid: 'demo-admin',
  scope: { type: 'public', id: '*' },
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
};
const consultation = {
  dueAt: null,
  id: 'consultation-1',
  title: '活动场地咨询',
  body: '希望了解申请入口。',
  status: 'open' as const,
  requesterUid: 'demo-student',
  assigneeUid: null,
  reply: null,
  ownerUid: 'demo-student',
  scope: { type: 'user', id: 'demo-student' },
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
};

function clientFor(announcements = [announcement], consultations = [consultation]) {
  return {
    request: vi.fn(async (path: string) =>
      path.endsWith('/announcements')
        ? structuredClone(announcements)
        : structuredClone(consultations),
    ),
  } as unknown as ApiClient;
}

describe('InformationPage', () => {
  it('renders ordinary own-consultation view with open editing and submission', async () => {
    const consultations = [{ ...consultation }];
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (path.endsWith('/announcements') && method === 'GET')
        return [{ ...announcement, status: 'published' }];
      if (path.endsWith('/consultations') && method === 'GET')
        return structuredClone(consultations);
      if (path.endsWith('/consultations') && method === 'POST') {
        const input = JSON.parse(String(init?.body));
        const created = { ...consultation, id: 'consultation-2', ...input };
        consultations.push(created);
        return created;
      }
      if (path.endsWith('/consultations') && method === 'PATCH') {
        const input = JSON.parse(String(init?.body));
        consultations[0] = { ...consultations[0], ...input };
        return consultations[0];
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    const user = userEvent.setup();
    render(<InformationPage client={{ request } as unknown as ApiClient} user={student} />);
    expect(await screen.findByText('我的咨询')).toBeInTheDocument();
    expect(screen.queryByText('咨询处理队列')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '编辑 活动场地咨询' }));
    await user.clear(screen.getByLabelText('编辑咨询标题'));
    await user.type(screen.getByLabelText('编辑咨询标题'), '场地开放时间咨询');
    await user.click(screen.getByRole('button', { name: '保存咨询修改' }));
    expect(await screen.findByText('场地开放时间咨询')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      '/information/consultations',
      expect.objectContaining({ method: 'PATCH', body: expect.not.stringContaining('status') }),
    );
  });

  it('evaluates management controls against each record scope', async () => {
    const scopedManager: UserContext & {
      policies: Array<{
        action: string;
        effect: 'allow' | 'deny';
        scope?: { type: string; id: string };
      }>;
    } = {
      uid: 'scoped-manager',
      displayName: 'Scoped manager',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
      policies: [
        {
          action: 'information.consultation.triage',
          effect: 'allow',
          scope: { type: 'user', id: 'user-a' },
        },
      ],
    };
    const authorized = {
      ...consultation,
      id: 'consultation-a',
      title: '用户 A 咨询',
      requesterUid: 'scoped-manager',
      ownerUid: 'scoped-manager',
      scope: { type: 'user', id: 'user-a' },
    };
    const ownOutOfScope = {
      ...consultation,
      id: 'consultation-own',
      title: '我的咨询',
      requesterUid: 'scoped-manager',
      ownerUid: 'scoped-manager',
      scope: { type: 'user', id: 'scoped-manager' },
    };
    const request = vi.fn(async (path: string) =>
      path.endsWith('/announcements') ? [] : [authorized, ownOutOfScope],
    );
    render(<InformationPage client={{ request } as unknown as ApiClient} user={scopedManager} />);

    expect(await screen.findByRole('button', { name: '开始处理 用户 A 咨询' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑 用户 A 咨询' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始处理 我的咨询' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑 我的咨询' })).toBeInTheDocument();
  });
  it('creates and edits announcement drafts without using generic PATCH for status', async () => {
    const announcements = [{ ...announcement }];
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (path === '/information/announcements' && method === 'GET')
        return structuredClone(announcements);
      if (path === '/information/consultations' && method === 'GET') return [];
      if (path === '/information/announcements' && method === 'POST') {
        const input = JSON.parse(String(init?.body));
        const created = { ...announcement, id: 'announcement-2', ...input };
        announcements.push(created);
        return created;
      }
      if (path === '/information/announcements' && method === 'PATCH') {
        const input = JSON.parse(String(init?.body));
        announcements[0] = { ...announcements[0], ...input };
        return announcements[0];
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    const actor = userEvent.setup();
    render(<InformationPage client={{ request } as unknown as ApiClient} user={admin} />);
    await screen.findByText('发展平台开放测试');
    await actor.type(screen.getByLabelText('公告标题'), '服务时间说明');
    await actor.type(screen.getByLabelText('公告正文'), '服务台工作日开放。');
    await actor.click(screen.getByRole('button', { name: '保存公告草稿' }));
    expect(await screen.findByText('服务时间说明')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      '/information/announcements',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"status":"draft"'),
      }),
    );

    await actor.click(screen.getByRole('button', { name: '编辑 发展平台开放测试' }));
    await actor.clear(screen.getByLabelText('编辑公告标题'));
    await actor.type(screen.getByLabelText('编辑公告标题'), '发展平台正式开放');
    await actor.click(screen.getByRole('button', { name: '保存公告修改' }));
    expect(await screen.findByText('发展平台正式开放')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      '/information/announcements',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.not.stringContaining('status'),
      }),
    );
  });
  it('shows announcement lifecycle and consultation handling actions to a manager', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const announcements = [{ ...announcement }];
    const consultations = [{ ...consultation }];
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (path === '/information/announcements' && method === 'GET')
        return structuredClone(announcements);
      if (path === '/information/consultations' && method === 'GET')
        return structuredClone(consultations);
      if (path.includes('/announcements/') && path.endsWith('/transitions')) {
        const { to } = JSON.parse(String(init?.body));
        announcements[0] = { ...announcements[0], status: to };
        return announcements[0];
      }
      if (path.endsWith('/handling')) {
        const input = JSON.parse(String(init?.body));
        consultations[0] = { ...consultations[0], ...input };
        return consultations[0];
      }
      if (path.includes('/consultations/') && path.endsWith('/transitions')) {
        const { to } = JSON.parse(String(init?.body));
        consultations[0] = { ...consultations[0], status: to };
        return consultations[0];
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    const user = userEvent.setup();
    render(<InformationPage client={{ request } as unknown as ApiClient} user={admin} />);
    expect(await screen.findByText('咨询处理队列')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '发布 发展平台开放测试' }));
    expect(await screen.findByText('已发布')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '处理 活动场地咨询' }));
    await user.type(screen.getByLabelText('负责人 UID'), 'demo-admin');
    await user.type(screen.getByLabelText('咨询回复'), '请在服务台提交材料。');
    await user.type(screen.getByLabelText('计划完成时间'), '2026-09-20T16:00');
    await user.click(screen.getByRole('button', { name: '保存处理信息' }));
    expect(await screen.findByText('请在服务台提交材料。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '开始处理 活动场地咨询' }));
    expect(await screen.findByText('处理中')).toBeInTheDocument();
    const expectedDueAt = new Date('2026-09-20T16:00').toISOString();
    expect(request).toHaveBeenCalledWith(
      '/information/consultations/consultation-1/handling',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining(`"dueAt":"${expectedDueAt}"`),
      }),
    );
  });

  it('preserves server-confirmed state when a transition fails', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET')
        return path.endsWith('/announcements') ? [announcement] : [consultation];
      throw new ApiError(409, 'invalid_state_transition', '状态已经发生变化', 'request-1');
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<InformationPage client={{ request } as unknown as ApiClient} user={admin} />);
    await screen.findByText('草稿');
    await user.click(screen.getByRole('button', { name: '发布 发展平台开放测试' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('状态已经发生变化');
    expect(screen.getByText('草稿')).toBeInTheDocument();
  });

  it('distinguishes loading, empty and error states', async () => {
    const success = render(<InformationPage client={clientFor([], [])} user={student} />);
    expect(screen.getByText('正在加载信息与咨询…')).toBeInTheDocument();
    expect(await screen.findByText('目前没有公开信息')).toBeInTheDocument();
    success.unmount();
    const errorClient = {
      request: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as ApiClient;
    render(<InformationPage client={errorClient} user={student} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法加载信息与咨询');
  });
});
