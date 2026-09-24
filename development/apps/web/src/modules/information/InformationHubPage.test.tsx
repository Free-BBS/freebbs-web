import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { InformationFeedItem, UserContext } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { InformationHubPage } from './InformationHubPage.js';

const student: UserContext = {
  uid: 'demo-student',
  displayName: '普通同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};
const admin: UserContext = {
  ...student,
  uid: 'demo-admin',
  displayName: '管理员',
  roles: ['platform.super_admin'],
};
const items: InformationFeedItem[] = [
  {
    kind: 'announcement',
    id: 'a-1',
    title: '服务时间更新',
    body: '本周服务台延长开放。',
    status: 'published',
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
    pinned: true,
    createdAt: '2026-09-24T08:00:00.000Z',
    updatedAt: '2026-09-24T08:00:00.000Z',
    likeCount: 6,
    replyCount: 2,
    likedByViewer: false,
    canReply: true,
    canManage: false,
  },
  {
    kind: 'consultation',
    id: 'c-1',
    title: '我的场地咨询',
    body: '想了解场地开放时间。',
    status: 'open',
    visibility: 'private',
    requesterUid: 'demo-student',
    assigneeUid: null,
    dueAt: null,
    scope: { type: 'user', id: 'demo-student' },
    createdAt: '2026-09-24T07:00:00.000Z',
    updatedAt: '2026-09-24T07:00:00.000Z',
    likeCount: 0,
    replyCount: 0,
    likedByViewer: false,
    canReply: true,
    canManage: true,
  },
];

describe('InformationHubPage', () => {
  it('renders a mixed feed, private lock treatment and feedback composer', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/information/feed') && !init) return structuredClone(items);
      if (path === '/information/consultations' && init?.method === 'POST') {
        return { ...items[1], id: 'c-2', ...(JSON.parse(String(init.body)) as object) };
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<InformationHubPage client={{ request } as unknown as ApiClient} user={student} />);

    expect(await screen.findByRole('heading', { name: '信息与咨询' })).toBeInTheDocument();
    expect(screen.getAllByText('官方发布')).toHaveLength(2);
    expect(screen.getByText(/仅你与负责人可见/)).toBeInTheDocument();
    expect(screen.queryByText('0 人赞同')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '提交反馈' }));
    await user.click(screen.getByRole('radio', { name: '公开反馈' }));
    await user.type(screen.getByLabelText('标题'), '开放时间建议');
    await user.type(screen.getByLabelText('内容'), '希望延长至晚上十点。');
    await user.click(screen.getByRole('button', { name: '发布反馈' }));
    expect(request).toHaveBeenCalledWith(
      '/information/consultations',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"visibility":"public"'),
      }),
    );
  });

  it('opens a feed item and posts a public reply', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/information/feed?filter=all') return structuredClone(items);
      if (path === '/information/feed/announcement/a-1' && !init) {
        return { item: items[0], replies: [] };
      }
      if (path === '/information/feed/announcement/a-1/replies' && init?.method === 'POST') {
        return { id: 'r-1', authorUid: 'demo-student', kind: 'reply', body: '收到，谢谢。' };
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<InformationHubPage client={{ request } as unknown as ApiClient} user={student} />);
    await user.click(await screen.findByRole('button', { name: /服务时间更新/ }));
    expect(await screen.findByRole('dialog', { name: '服务时间更新' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('写下回复'), '收到，谢谢。');
    await user.click(screen.getByRole('button', { name: '发送回复' }));
    expect(request).toHaveBeenCalledWith(
      '/information/feed/announcement/a-1/replies',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('收到，谢谢。') }),
    );
  });

  it('lets an authorized manager publish official information', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/information/feed?filter=all') return [];
      if (path === '/information/announcements' && init?.method === 'POST') return { id: 'a-new' };
      if (path === '/information/announcements/a-new/transitions' && init?.method === 'POST')
        return {};
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<InformationHubPage client={{ request } as unknown as ApiClient} user={admin} />);
    await user.click(await screen.findByRole('button', { name: '发布信息' }));
    await user.type(screen.getByLabelText('标题'), '正式通知');
    await user.type(screen.getByLabelText('内容'), '新的服务安排。');
    await user.click(screen.getByRole('button', { name: '确认发布' }));
    expect(request).toHaveBeenCalledWith(
      '/information/announcements/a-new/transitions',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
