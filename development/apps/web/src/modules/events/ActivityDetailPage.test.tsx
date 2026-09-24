import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ActivityDetailPage, type DevelopmentApi } from './ActivityDetailPage.js';

const student = {
  uid: 'demo-student',
  displayName: '普通同学',
  avatarUrl: null,
  baseRole: 'student' as const,
  roles: [],
  tags: [],
  policies: [],
};
const maintainer = {
  ...student,
  policies: [
    { id: 'update', action: 'events.update', resource: 'activity', effect: 'allow' as const },
  ],
};

describe('ActivityDetailPage', () => {
  it('explains and disables registration after the deadline or when capacity is full', async () => {
    const registrationUser = {
      ...student,
      policies: [
        {
          id: 'register',
          action: 'events.register',
          resource: 'activity_registration',
          effect: 'allow' as const,
        },
      ],
    };
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/registrations')) return null;
      return {
        id: 'activity-full',
        title: '已满活动',
        description: '报名边界展示。',
        status: 'published',
        startsAt: null,
        endsAt: null,
        location: '',
        registrationDeadline: '2000-01-01T00:00:00.000Z',
        capacity: 1,
        registrationCount: 1,
        contact: '',
        organizationId: null,
        standingActivity: false,
        clubId: null,
        ownerUid: 'owner',
        scope: { type: 'public', id: '*' },
        milestones: [],
        fixtures: [],
        progress: null,
      };
    });
    render(
      <MemoryRouter>
        <ActivityDetailPage
          activityId="activity-full"
          client={{ request: request as DevelopmentApi['request'] }}
          user={registrationUser}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('报名状态：报名已截止')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '报名活动' })).toBeDisabled();
    expect(screen.getByText('名额已满（1 / 1）')).toBeInTheDocument();
  });

  it('renders time, location, timeline progress, and competition fixtures', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/events/activities/activity-ma') {
        return {
          id: 'activity-ma',
          title: '马约翰杯',
          description: '校级体育赛事。',
          status: 'published',
          startsAt: '2026-09-12T08:00:00.000Z',
          endsAt: '2026-09-12T18:00:00.000Z',
          location: '东大操场',
          registrationDeadline: '2026-09-10T12:00:00.000Z',
          capacity: 64,
          contact: 'sports@example.edu.cn',
          organizationId: 'sports_center',
          standingActivity: true,
          clubId: null,
          ownerUid: 'sports-owner',
          scope: { type: 'public', id: '*' },
          technicalSupportStatus: 'confirmed',
          technicalSupportNote: null,
          progress: { completed: 1, total: 2, percentage: 50 },
          milestones: [
            {
              id: 'milestone-1',
              occursAt: '2026-09-20T10:00:00.000Z',
              title: '主持人推送',
              type: 'promotion',
              description: '发布推送。',
              completed: true,
              displayOrder: 2,
            },
            {
              id: 'milestone-2',
              occursAt: '2026-09-01T10:00:00.000Z',
              title: '初赛',
              type: 'competition',
              description: '进行初赛。',
              completed: false,
              displayOrder: 1,
            },
          ],
          fixtures: [
            {
              id: 'fixture-1',
              round: '小组赛',
              participantA: '电子系',
              participantB: '自动化系',
              scheduledAt: '2026-09-12T11:00:00.000Z',
              location: '东大操场',
              score: null,
            },
          ],
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter basename="/development" initialEntries={['/development/events/activity-ma']}>
        <ActivityDetailPage
          activityId="activity-ma"
          client={{ request: request as DevelopmentApi['request'] }}
          user={student}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '马约翰杯' })).toBeInTheDocument();
    expect(screen.getAllByText('东大操场')).toHaveLength(2);
    expect(screen.getByText('报名截止')).toBeInTheDocument();
    expect(screen.getByText('64 人')).toBeInTheDocument();
    expect(screen.getByText('sports@example.edu.cn')).toBeInTheDocument();
    expect(screen.getByText('报名状态：当前不可报名')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '活动筹备进度' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    const timeline = screen.getByRole('list', { name: '活动时间线' });
    expect(
      within(timeline)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining('初赛'), expect.stringContaining('主持人推送')]);
    const fixtures = screen.getByRole('table', { name: '比赛预览' });
    expect(within(fixtures).getByText('电子系 vs 自动化系')).toBeInTheDocument();
  });

  it('shows the empty-flow state and only exposes maintenance controls to scoped maintainers', async () => {
    const request = vi.fn(async (path: string) => {
      if (path !== '/events/activities/activity-empty')
        throw new Error(`Unexpected request: ${path}`);
      return {
        id: 'activity-empty',
        title: '社团招新',
        description: '面向全校同学的招新活动。',
        status: 'draft',
        startsAt: null,
        endsAt: null,
        location: '',
        registrationDeadline: null,
        capacity: null,
        contact: '',
        organizationId: null,
        standingActivity: false,
        clubId: null,
        ownerUid: 'sports-owner',
        scope: { type: 'public', id: '*' },
        milestones: [],
        fixtures: [],
        progress: null,
      };
    });

    const { rerender } = render(
      <MemoryRouter>
        <ActivityDetailPage
          activityId="activity-empty"
          client={{ request: request as DevelopmentApi['request'] }}
          user={student}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText('尚未发布流程')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '维护活动流程' })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ActivityDetailPage
          activityId="activity-empty"
          client={{ request: request as DevelopmentApi['request'] }}
          user={maintainer}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: '维护活动流程' })).toBeInTheDocument();
  });

  it('honors organization membership and denial before showing maintenance controls', async () => {
    const request = vi.fn(async () => ({
      id: 'activity-arts',
      title: '文艺活动',
      description: '活动。',
      status: 'draft',
      startsAt: null,
      endsAt: null,
      location: '',
      registrationDeadline: null,
      capacity: null,
      contact: '',
      organizationId: 'arts_center',
      standingActivity: false,
      clubId: null,
      ownerUid: 'arts-owner',
      scope: { type: 'public', id: '*' },
      milestones: [],
      fixtures: [],
      progress: null,
    }));
    const wrongOrganization = {
      ...maintainer,
      roles: ['department.sports_director' as const],
    };
    const { rerender } = render(
      <MemoryRouter>
        <ActivityDetailPage
          activityId="activity-arts"
          client={{ request: request as DevelopmentApi['request'] }}
          user={wrongOrganization}
        />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: '文艺活动' });
    expect(screen.queryByRole('button', { name: '维护活动流程' })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ActivityDetailPage
          activityId="activity-arts"
          client={{ request: request as DevelopmentApi['request'] }}
          user={{
            ...maintainer,
            roles: ['department.arts_director' as const],
            policies: [
              {
                action: 'events.update',
                resource: 'activity',
                effect: 'deny' as const,
              },
            ],
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: '维护活动流程' })).not.toBeInTheDocument();
  });

  it('submits complete milestone and fixture payloads, then refreshes progress after completion', async () => {
    const user = userEvent.setup();
    const detail = {
      id: 'activity-manage',
      title: '维护活动',
      description: '活动。',
      status: 'draft',
      startsAt: null,
      endsAt: null,
      location: '',
      registrationDeadline: null,
      capacity: null,
      contact: '',
      organizationId: null,
      standingActivity: false,
      clubId: null,
      ownerUid: 'maintainer',
      scope: { type: 'public', id: '*' },
      progress: null,
      milestones: [
        {
          id: 'milestone-existing',
          occursAt: '2026-08-30T09:00:00.000Z',
          title: '已有节点',
          type: 'workflow',
          description: '已有说明',
          completed: false,
          displayOrder: 9,
        },
      ] as Array<{
        id: string;
        occursAt: string;
        title: string;
        type: string;
        description: string;
        completed: boolean;
        displayOrder: number;
      }>,
      fixtures: [] as Array<{
        id: string;
        round: string;
        participantA: string;
        participantB: string;
        scheduledAt: string;
        location: string;
        score: string | null;
      }>,
    };
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/events/activities/activity-manage') return structuredClone(detail);
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (path.endsWith('/milestones') && init?.method === 'POST') {
        detail.milestones.push({ id: 'milestone-new', ...body });
        return detail.milestones.at(-1);
      }
      if (path.endsWith('/milestones/milestone-new') && init?.method === 'PATCH') {
        const index = detail.milestones.findIndex(({ id }) => id === 'milestone-new');
        detail.milestones[index] = { ...detail.milestones[index], ...body };
        return detail.milestones[index];
      }
      if (path.endsWith('/fixtures') && init?.method === 'POST') return body;
      throw new Error(`Unexpected request: ${path}`);
    });
    render(
      <MemoryRouter>
        <ActivityDetailPage
          activityId="activity-manage"
          client={{ request: request as DevelopmentApi['request'] }}
          user={maintainer}
        />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: '维护活动流程' });
    await user.click(screen.getByRole('button', { name: '维护活动流程' }));
    await user.type(screen.getAllByLabelText('节点名称')[0]!, '  场地确认  ');
    await user.type(screen.getAllByLabelText('节点说明')[0]!, '  完成场地确认  ');
    await user.type(screen.getAllByLabelText('发生时间')[0]!, '2026-09-01T09:00');
    await user.click(screen.getByText('添加节点'));
    expect(request).toHaveBeenCalledWith(
      '/events/activities/activity-manage/milestones',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringMatching(/"description":"完成场地确认".*"displayOrder":10/),
      }),
    );
    expect(await screen.findByRole('progressbar', { name: '活动筹备进度' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    await user.click(screen.getByText('标记已完成：场地确认'));
    expect(await screen.findByRole('progressbar', { name: '活动筹备进度' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );

    await user.type(screen.getByLabelText('轮次'), ' 决赛 ');
    await user.type(screen.getByLabelText('参赛方 A'), '甲队');
    await user.type(screen.getByLabelText('参赛方 B'), '乙队');
    await user.type(screen.getByLabelText('比赛时间'), '2026-09-02T10:00');
    await user.click(screen.getByText('添加赛程'));
    expect(request).not.toHaveBeenCalledWith(
      '/events/activities/activity-manage/fixtures',
      expect.anything(),
    );
    await user.type(screen.getByLabelText('比赛地点'), ' 体育馆 ');
    await user.click(screen.getByText('添加赛程'));
    expect(request).toHaveBeenCalledWith(
      '/events/activities/activity-manage/fixtures',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"location":"体育馆"'),
      }),
    );
  });

  it('uses the scoped patch and delete endpoints for existing milestones and fixtures', async () => {
    const user = userEvent.setup();
    const detail = {
      id: 'activity-contracts',
      title: '合同活动',
      description: '活动。',
      status: 'draft',
      startsAt: null,
      endsAt: null,
      location: '体育馆',
      registrationDeadline: null,
      capacity: null,
      contact: '',
      organizationId: null,
      standingActivity: false,
      clubId: null,
      ownerUid: 'maintainer',
      scope: { type: 'public', id: '*' },
      progress: null,
      milestones: [
        {
          id: 'm-1',
          occursAt: '2026-09-01T09:00:00.000Z',
          title: '筹备',
          type: 'workflow',
          description: '准备',
          completed: false,
          displayOrder: 0,
        },
      ],
      fixtures: [
        {
          id: 'f-1',
          round: '半决赛',
          participantA: '甲队',
          participantB: '乙队',
          scheduledAt: '2026-09-02T09:00:00.000Z',
          location: '体育馆',
          score: null,
        },
      ],
    };
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/events/activities/activity-contracts') return structuredClone(detail);
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (path.endsWith('/milestones/m-1') && init?.method === 'PATCH') {
        detail.milestones[0] = { ...detail.milestones[0], ...body };
        return detail.milestones[0];
      }
      if (path.endsWith('/milestones/m-1') && init?.method === 'DELETE') {
        detail.milestones = [];
        return undefined;
      }
      if (path.endsWith('/fixtures/f-1') && init?.method === 'PATCH') {
        detail.fixtures[0] = { ...detail.fixtures[0], ...body };
        return detail.fixtures[0];
      }
      if (path.endsWith('/fixtures/f-1') && init?.method === 'DELETE') {
        detail.fixtures = [];
        return undefined;
      }
      return undefined;
    });
    render(
      <MemoryRouter>
        <ActivityDetailPage
          activityId="activity-contracts"
          client={{ request: request as DevelopmentApi['request'] }}
          user={maintainer}
        />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '维护活动流程' }));
    const milestoneTitle = screen.getAllByLabelText('节点名称')[1]!;
    await user.clear(milestoneTitle);
    await user.type(milestoneTitle, '更新筹备');
    await user.click(screen.getByText('保存节点：筹备'));
    expect(request).toHaveBeenCalledWith(
      '/events/activities/activity-contracts/milestones/m-1',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"title":"更新筹备"'),
      }),
    );
    expect(await screen.findByText('更新筹备')).toBeInTheDocument();
    await user.click(screen.getByText('删除节点：更新筹备'));
    expect(await screen.findByText('尚未发布流程')).toBeInTheDocument();
    const fixtureRound = screen.getAllByLabelText('轮次')[1]!;
    await user.clear(fixtureRound);
    await user.type(fixtureRound, '决赛');
    await user.click(screen.getByText('保存赛程：半决赛'));
    expect(request).toHaveBeenCalledWith(
      '/events/activities/activity-contracts/fixtures/f-1',
      expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"round":"决赛"') }),
    );
    expect(await screen.findByText('决赛')).toBeInTheDocument();
    await user.click(screen.getByText('删除赛程：决赛'));
    expect(screen.queryByRole('table', { name: '比赛预览' })).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/events/activities/activity-contracts/milestones/m-1', {
      method: 'DELETE',
    });
    expect(request).toHaveBeenCalledWith('/events/activities/activity-contracts/fixtures/f-1', {
      method: 'DELETE',
    });
  });

  it('keeps the editor recoverable when an existing milestone date is cleared', async () => {
    const detail = {
      id: 'activity-date',
      title: '日期活动',
      description: '活动。',
      status: 'draft',
      startsAt: null,
      endsAt: null,
      location: '',
      registrationDeadline: null,
      capacity: null,
      contact: '',
      organizationId: null,
      standingActivity: false,
      clubId: null,
      ownerUid: 'maintainer',
      scope: { type: 'public', id: '*' },
      progress: null,
      milestones: [
        {
          id: 'm-date',
          occursAt: '2026-09-01T09:00:00.000Z',
          title: '节点',
          type: 'workflow',
          description: '说明',
          completed: false,
          displayOrder: 0,
        },
      ],
      fixtures: [],
    };
    const request = vi.fn(async (path: string) => {
      if (path === '/events/activities/activity-date') return structuredClone(detail);
      return undefined;
    });
    render(
      <MemoryRouter>
        <ActivityDetailPage
          activityId="activity-date"
          client={{ request: request as DevelopmentApi['request'] }}
          user={maintainer}
        />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: '维护活动流程' });
    fireEvent.click(screen.getByRole('button', { name: '维护活动流程' }));
    const fields = screen.getAllByLabelText('发生时间');
    fireEvent.change(fields[1]!, { target: { value: '' } });
    fireEvent.submit(screen.getByText('保存节点：节点').closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '请填写节点名称、节点说明、有效发生时间和显示顺序',
    );
    expect(request).not.toHaveBeenCalledWith(
      '/events/activities/activity-date/milestones/m-date',
      expect.anything(),
    );
  });
});
