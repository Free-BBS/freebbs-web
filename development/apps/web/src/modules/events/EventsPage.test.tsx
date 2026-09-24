import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import {
  EventsPage,
  conciseActivitySummary,
  localDateTimeInputToUtcInstant,
  type DevelopmentApi,
  utcInstantToLocalDateTimeInput,
} from './EventsPage.js';

const scope = { type: 'public', id: '*' } as const;
const activityScope = { type: 'activity', id: 'activity-workflow' } as const;
const maintainer = {
  uid: 'maintainer',
  displayName: '活动维护者',
  avatarUrl: null,
  baseRole: 'student' as const,
  roles: [],
  tags: [],
  policies: [
    { id: 'read', action: 'events.read', resource: 'activity', effect: 'allow' as const },
    { id: 'create', action: 'events.create', resource: 'activity', effect: 'allow' as const },
    { id: 'update', action: 'events.update', resource: 'activity', effect: 'allow' as const },
    { id: 'approve', action: 'events.approve', resource: 'activity', effect: 'allow' as const },
    {
      id: 'support',
      action: 'events.technical_support',
      resource: 'activity',
      effect: 'allow' as const,
    },
    {
      id: 'register',
      action: 'events.register',
      resource: 'activity_registration',
      effect: 'allow' as const,
      scope: activityScope,
    },
    {
      id: 'cancel',
      action: 'events.cancel_registration',
      resource: 'activity_registration',
      effect: 'allow' as const,
      scope: activityScope,
    },
  ],
};

function renderPage(client: DevelopmentApi) {
  return render(
    <MemoryRouter basename="/development" initialEntries={['/development/events']}>
      <EventsPage client={client} user={maintainer} />
    </MemoryRouter>,
  );
}

describe('EventsPage', () => {
  it('runs the approval, support, and registration workflow from server-confirmed state', async () => {
    const user = userEvent.setup();
    const startsAtLocal = '2026-09-01T18:30';
    let current = {
      id: 'activity-workflow',
      title: '校园夜跑',
      description: '五公里轻松跑。',
      status: 'draft',
      clubId: 'club-running' as string | null,
      startsAt: '2026-08-01T11:00:00.000Z' as string | null,
      endsAt: '2026-08-01T13:00:00.000Z' as string | null,
      location: '紫荆操场',
      registrationDeadline: '2026-07-31T16:00:00.000Z' as string | null,
      capacity: 120 as number | null,
      contact: 'running@example.edu.cn',
      standingActivity: true,
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null as string | null,
      scope,
    };
    let registration: { id: string; status: 'registered' | 'cancelled' } | null = null;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/events/activities' && init === undefined) return [current];
      if (path.endsWith('/registrations') && init === undefined) return registration;
      if (path.endsWith('/transitions')) {
        const body = JSON.parse(String(init?.body)) as { to: typeof current.status };
        current = { ...current, status: body.to };
        return current;
      }
      if (path.endsWith('/technical-support')) {
        const body = JSON.parse(String(init?.body)) as {
          to: 'requested' | 'confirmed';
          note?: string;
        };
        current = {
          ...current,
          technicalSupportStatus: body.to,
          technicalSupportNote: body.note ?? current.technicalSupportNote,
        };
        return current;
      }
      if (path.endsWith('/registrations') && init?.method === 'POST') {
        registration = { id: 'registration-1', status: 'registered' };
        return registration;
      }
      if (path.endsWith('/registrations') && init?.method === 'DELETE') {
        registration = { id: 'registration-1', status: 'cancelled' };
        return undefined;
      }
      if (path === '/events/activities' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as {
          title: string;
          description: string;
          clubId: string | null;
          startsAt: string | null;
        };
        current = { ...current, ...body };
        return current;
      }
      if (path === '/events/activities' && init?.method === 'POST') return current;
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPage({ request: request as DevelopmentApi['request'] });
    expect(screen.getByRole('heading', { name: '無活动' })).toBeInTheDocument();
    const festivalEntry = screen.getByRole('link', { name: /我要上学生节/ });
    expect(festivalEntry).toHaveTextContent('我要上学生节');
    expect(festivalEntry).not.toHaveTextContent('「');
    expect(
      within(festivalEntry).getByRole('img', {
        name: '小羊在学生节舞台演唱，台下小羊观众正在观看',
      }),
    ).toHaveAttribute('src', expect.stringContaining('student-festival-stage'));
    let card = await screen.findByRole('article', { name: '校园夜跑' });
    expect(within(card).getByText('管理活动').closest('details')).not.toHaveAttribute('open');
    expect(within(card).getByText('报名与联系信息').closest('details')).not.toHaveAttribute('open');
    expect(within(card).getByText('常设活动')).toBeInTheDocument();
    expect(within(card).getByLabelText('完整活动介绍：五公里轻松跑。')).toBeInTheDocument();
    await user.click(within(card).getByText('报名与联系信息'));
    expect(within(card).getByText('地点：紫荆操场')).toBeInTheDocument();
    expect(within(card).getByText(/结束时间：/)).toBeInTheDocument();
    expect(within(card).getByText(/报名截止：/)).toBeInTheDocument();
    expect(within(card).getByText('容量：120 人')).toBeInTheDocument();
    expect(within(card).getByText('联系人：running@example.edu.cn')).toBeInTheDocument();
    expect(within(card).queryByText('查看所属趣缘群体')).not.toBeInTheDocument();
    expect(within(card).getByRole('link', { name: '查看详情与时间线' })).toHaveAttribute(
      'href',
      '/development/events/activity-workflow',
    );

    await user.click(within(card).getByText('管理活动'));
    await user.click(within(card).getByRole('button', { name: '编辑校园夜跑' }));
    const editor = screen.getByRole('dialog', { name: '编辑活动' });
    await user.clear(within(editor).getByLabelText('活动名称'));
    await user.type(within(editor).getByLabelText('活动名称'), '校园荧光夜跑');
    expect(within(editor).queryByLabelText('所属趣缘群体 ID（可选）')).not.toBeInTheDocument();
    const startsAt = within(editor).getByLabelText('开始时间（可选）');
    await user.clear(startsAt);
    await user.type(startsAt, startsAtLocal);
    await user.click(within(editor).getByRole('button', { name: '保存活动' }));
    card = await screen.findByRole('article', { name: '校园荧光夜跑' });
    expect(current.clubId).toBe('club-running');
    expect(current.startsAt).toBe(new Date(startsAtLocal).toISOString());

    await user.click(within(card).getByRole('button', { name: '提交审核' }));
    await user.click(await within(card).findByRole('button', { name: '批准活动' }));
    await user.click(await within(card).findByRole('button', { name: '发布活动' }));
    await user.click(await within(card).findByRole('button', { name: '报名活动' }));
    expect(await within(card).findByRole('button', { name: '取消报名' })).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: '取消报名' }));

    await user.click(within(card).getByRole('button', { name: '申请技术支持' }));
    await user.click(await within(card).findByRole('button', { name: '确认技术支持' }));
    await user.click(within(card).getByRole('button', { name: '结束活动' }));
    await user.click(await within(card).findByRole('button', { name: '归档活动' }));

    await waitFor(() => expect(current.status).toBe('archived'));
    expect(current.technicalSupportStatus).toBe('confirmed');
    expect(registration).toEqual(expect.objectContaining({ status: 'cancelled' }));
  });

  it('keeps stored instants exact through datetime-local fields and exposes a semantic concise summary', () => {
    const instant = '2026-09-01T10:20:30.456Z';
    expect(localDateTimeInputToUtcInstant(utcInstantToLocalDateTimeInput(instant))).toBe(instant);
    expect(conciseActivitySummary('一二三四五六七八九十'.repeat(20))).toMatch(/…$/);
  });
});
