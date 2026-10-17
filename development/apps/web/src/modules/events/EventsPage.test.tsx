import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import {
  EventsPage,
  canCreateActivity,
  conciseActivitySummary,
  localDateTimeInputToUtcInstant,
  type DevelopmentApi,
  type EventsPageProps,
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

function metadataFixture(status = 'published', organizationId: string | null = 'sports_center') {
  let current = {
    id: 'activity-workflow',
    title: '体育中心公开训练',
    description: '训练安排与报名说明。',
    status,
    organizationId,
    ownerUid: 'maintainer',
    scope,
    startsAt: '2099-09-01T10:20:30.456Z',
    endsAt: '2099-09-01T12:20:30.456Z',
    location: '原场地',
    contact: 'old@example.edu.cn',
    capacity: 30,
    registrationDeadline: '2099-08-31T16:00:00.000Z',
    technicalSupportStatus: 'not_requested',
    technicalSupportNote: null,
  };
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/events/activities' && !init) return [current];
    if (path.endsWith('/registrations') && !init) return null;
    if (path === '/events/activities' && init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body));
      if ('startsAt' in patch || 'endsAt' in patch) throw new Error('请在活动工作区调整活动安排');
      current = { ...current, ...patch };
      return current;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  return { request, current: () => current };
}

function renderMetadataPage(
  fixture: ReturnType<typeof metadataFixture>,
  user: EventsPageProps['user'],
  managementOnly = false,
) {
  return render(
    <MemoryRouter>
      <EventsPage
        client={{ request: fixture.request as DevelopmentApi['request'] }}
        user={user}
        managementOnly={managementOnly}
      />
    </MemoryRouter>,
  );
}

describe('EventsPage', () => {
  it('shows normal create for an executive with scoped create policies and only the four union organizations', async () => {
    const fixture = metadataFixture();
    const actor: EventsPageProps['user'] = {
      ...maintainer,
      roles: ['student_union.executive_president'],
      policies: [
        ...['arts_center', 'sports_center', 'liaison_center', 'rights_development_center'].map(
          (id) => ({
            action: 'events.create',
            resource: 'activity',
            effect: 'allow' as const,
            scope: { type: 'social_organization', id },
          }),
        ),
      ],
    };
    expect(canCreateActivity(actor)).toBe(true);
    renderMetadataPage(fixture, actor);
    await userEvent.click(await screen.findByRole('button', { name: '创建活动' }));
    const values = within(screen.getByLabelText('主办组织'))
      .getAllByRole('option')
      .map((el) => el.getAttribute('value'));
    expect(values).toEqual(
      expect.arrayContaining([
        'arts_center',
        'sports_center',
        'liaison_center',
        'rights_development_center',
      ]),
    );
    expect(values).not.toContain('sast');
    expect(values).not.toContain('tuanwei');
  });
  it('honors public denies and never creates for a foreign organization or during preview', () => {
    const actor: EventsPageProps['user'] = {
      ...maintainer,
      roles: ['department.arts_member'],
      policies: [
        {
          action: 'events.create',
          resource: 'activity',
          effect: 'allow',
          scope: { type: 'social_organization', id: 'sports_center' },
        },
      ],
    };
    expect(canCreateActivity(actor)).toBe(false);
    expect(
      canCreateActivity({
        ...actor,
        roles: ['student_union.presidium'],
        policies: [
          ...actor.policies!,
          { action: 'events.create', resource: 'activity', effect: 'deny', scope },
        ],
      }),
    ).toBe(false);
    expect(canCreateActivity({ ...maintainer, previewing: true })).toBe(false);
  });
  it.each(['counselor.youth_league', 'student_union.presidium'] as const)(
    'lets %s manage a union activity using its organization policy',
    async (role) => {
      const fixture = metadataFixture();
      renderMetadataPage(fixture, {
        ...maintainer,
        roles: [role],
        policies: [
          {
            action: 'events.update',
            resource: 'activity',
            effect: 'allow',
            scope: { type: 'social_organization', id: 'sports_center' },
          },
        ],
      });
      const card = await screen.findByRole('article', { name: '体育中心公开训练' });
      await userEvent.click(within(card).getByText('管理活动'));
      expect(
        within(card).getByRole('button', { name: '编辑体育中心公开训练' }),
      ).toBeInTheDocument();
    },
  );
  it.each(['published', 'finished'])(
    'lets current organization managers edit %s metadata without resubmitting workspace dates',
    async (status) => {
      const user = userEvent.setup();
      const fixture = metadataFixture(status);
      renderMetadataPage(fixture, { ...maintainer, roles: ['department.sports_director'] });
      const card = await screen.findByRole('article', { name: '体育中心公开训练' });
      await user.click(within(card).getByText('管理活动'));
      await user.click(within(card).getByRole('button', { name: '编辑体育中心公开训练' }));
      const editor = screen.getByRole('dialog', { name: '编辑活动' });
      expect(within(editor).queryByLabelText('开始时间（可选）')).not.toBeInTheDocument();
      expect(within(editor).queryByLabelText('结束时间（可选）')).not.toBeInTheDocument();
      for (const [label, value] of [
        ['活动名称', '训练日新安排'],
        ['地点', '新场地'],
        ['联系人', 'new@example.edu.cn'],
        ['容量（可选）', '45'],
      ] as const) {
        await user.clear(within(editor).getByLabelText(label));
        await user.type(within(editor).getByLabelText(label), value);
      }
      await user.clear(within(editor).getByLabelText('报名截止（可选）'));
      await user.type(within(editor).getByLabelText('报名截止（可选）'), '2099-08-31T10:30');
      await user.click(within(editor).getByRole('button', { name: '保存活动' }));
      expect(await screen.findByRole('article', { name: '训练日新安排' })).toBeInTheDocument();
      expect(fixture.current()).toMatchObject({
        title: '训练日新安排',
        location: '新场地',
        contact: 'new@example.edu.cn',
        capacity: 45,
        registrationDeadline: new Date('2099-08-31T10:30').toISOString(),
        startsAt: '2099-09-01T10:20:30.456Z',
        endsAt: '2099-09-01T12:20:30.456Z',
      });
      const patch = fixture.request.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1];
      expect(JSON.parse(String(patch?.body))).not.toHaveProperty('startsAt');
      expect(JSON.parse(String(patch?.body))).not.toHaveProperty('endsAt');
    },
  );
  it('omits unchanged draft dates from metadata saves when a workspace already controls the schedule', async () => {
    const user = userEvent.setup();
    const fixture = metadataFixture('draft');
    renderMetadataPage(fixture, { ...maintainer, roles: ['department.sports_member'] });
    const card = await screen.findByRole('article', { name: '体育中心公开训练' });
    await user.click(within(card).getByText('管理活动'));
    await user.click(within(card).getByRole('button', { name: '编辑体育中心公开训练' }));
    const editor = screen.getByRole('dialog', { name: '编辑活动' });
    expect(within(editor).getByLabelText('开始时间（可选）')).toHaveValue(
      utcInstantToLocalDateTimeInput(fixture.current().startsAt),
    );
    await user.clear(within(editor).getByLabelText('地点'));
    await user.type(within(editor).getByLabelText('地点'), '另一个场地');
    await user.click(within(editor).getByRole('button', { name: '保存活动' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fixture.current().location).toBe('另一个场地');
  });
  it.each(['draft', 'published', 'finished'])(
    'hides %s owner and manager actions after organization membership changes',
    async (status) => {
      const fixture = metadataFixture(status, 'arts_center');
      renderMetadataPage(fixture, { ...maintainer, roles: ['department.sports_director'] });
      const card = await screen.findByRole('article', { name: '体育中心公开训练' });
      expect(
        within(card).queryByRole('button', { name: '编辑体育中心公开训练' }),
      ).not.toBeInTheDocument();
      for (const name of ['提交审核', '结束活动', '归档活动', '申请技术支持'])
        expect(within(card).queryByRole('button', { name })).not.toBeInTheDocument();
    },
  );
  it('hides another organization activity in the management view even when stale owner and broad update policies remain', async () => {
    const fixture = metadataFixture('published', 'arts_center');
    renderMetadataPage(
      fixture,
      {
        ...maintainer,
        roles: ['department.sports_director'],
        policies: maintainer.policies.filter(({ action }) => action !== 'events.technical_support'),
      },
      true,
    );
    await screen.findByText('暂无可管理的活动，创建后草稿会出现在这里。');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('keeps a current organization member owner from using draft creation permission to edit published metadata', async () => {
    const fixture = metadataFixture();
    renderMetadataPage(fixture, { ...maintainer, roles: ['department.sports_member'] });
    const card = await screen.findByRole('article', { name: '体育中心公开训练' });
    expect(
      within(card).queryByRole('button', { name: '编辑体育中心公开训练' }),
    ).not.toBeInTheDocument();
  });
  it('keeps current organization members able to open published activity workspaces from management', async () => {
    const fixture = metadataFixture();
    renderMetadataPage(
      fixture,
      { ...maintainer, uid: 'another-member', roles: ['department.sports_member'] },
      true,
    );
    const card = await screen.findByRole('article', { name: '体育中心公开训练' });
    expect(within(card).getByRole('link', { name: /编辑页面 · 动态与复盘/ })).toHaveAttribute(
      'href',
      '/collections/activities/development_activity/activity-workflow',
    );
    expect(
      within(card).queryByRole('button', { name: '编辑体育中心公开训练' }),
    ).not.toBeInTheDocument();
  });
  it('preserves global business admin editing and honors explicit update denies', async () => {
    const user = userEvent.setup();
    const fixture = metadataFixture('published', 'arts_center');
    const admin = { ...maintainer, roles: ['platform.admin' as const], businessAdmin: true };
    const view = renderMetadataPage(fixture, admin);
    let card = await screen.findByRole('article', { name: '体育中心公开训练' });
    await user.click(within(card).getByText('管理活动'));
    expect(within(card).getByRole('button', { name: '编辑体育中心公开训练' })).toBeInTheDocument();
    view.rerender(
      <MemoryRouter>
        <EventsPage
          client={{ request: fixture.request as DevelopmentApi['request'] }}
          user={{
            ...admin,
            policies: [
              ...admin.policies,
              { action: 'events.update', resource: 'activity', effect: 'deny', scope },
            ],
          }}
        />
      </MemoryRouter>,
    );
    card = await screen.findByRole('article', { name: '体育中心公开训练' });
    expect(
      within(card).queryByRole('button', { name: '编辑体育中心公开训练' }),
    ).not.toBeInTheDocument();
  });
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
    expect(screen.getByRole('heading', { name: '萬事屋' })).toBeInTheDocument();
    const festivalEntry = screen.getByRole('link', { name: /我要上电子系春晚/ });
    expect(festivalEntry).toHaveTextContent('我要上电子系春晚');
    expect(festivalEntry).not.toHaveTextContent('「');
    expect(
      within(festivalEntry).getByRole('img', {
        name: '小羊在春晚舞台演唱，台下小羊观众正在观看',
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
