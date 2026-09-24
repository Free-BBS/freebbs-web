import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';

import { SportsTeamDetailPage } from './SportsTeamDetailPage.js';
import type { SportsTeamRecord, SportsUser } from './SportsPage.js';

function sportsUser(uid: string, policies: SportsUser['policies'] = []): SportsUser {
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
    policies,
  };
}

describe('SportsTeamDetailPage', () => {
  it('loads the requested team and presents its roster and training schedule', async () => {
    const request = vi.fn().mockImplementation((path: string) => {
      if (path === '/sports/teams') {
        return Promise.resolve([
          {
            id: 'team-basketball',
            name: '篮球队',
            description: '院篮球代表队。',
            season: '2026 秋季',
            trainingSchedule: '每周二 18:00，篮球馆',
            status: 'active',
            scope: { type: 'sports_team', id: 'team-basketball' },
          },
        ]);
      }
      if (path === '/sports/teams/team-basketball/members') {
        return Promise.resolve([{ id: 'member-1', memberUid: 'student-1', isCaptain: true }]);
      }
      if (path === '/sports/teams/team-basketball/checkins') return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter>
        <SportsTeamDetailPage
          client={{ request }}
          teamId="team-basketball"
          user={sportsUser('captain-1', [
            {
              action: 'sports.team.update',
              resource: 'sports_team',
              scope: { type: 'sports_team', id: 'team-basketball' },
            },
          ])}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '篮球队' })).toBeInTheDocument();
    expect(screen.getByText('2026 秋季')).toBeInTheDocument();
    expect(screen.getByText('每周二 18:00，篮球馆')).toBeInTheDocument();
    expect(await screen.findByText(/student-1/)).toBeInTheDocument();
  });

  it('previews a two-column CSV without mutation and imports only after confirmation', async () => {
    const preview = [
      { row: 2, name: '张三', studentNumber: '20260001', outcome: 'ready', blocking: false },
      {
        row: 3,
        name: '李四',
        studentNumber: '20260002',
        outcome: 'name_mismatch',
        blocking: true,
      },
    ];
    const request = vi.fn().mockImplementation((path: string) => {
      if (path === '/sports/teams') {
        return Promise.resolve([
          {
            id: 'team-basketball',
            name: '篮球队',
            description: '院篮球代表队。',
            season: '2026 秋季',
            trainingSchedule: '每周二 18:00，篮球馆',
            status: 'active',
            scope: { type: 'sports_team', id: 'team-basketball' },
          },
        ]);
      }
      if (path.endsWith('/members') || path.endsWith('/checkins')) return Promise.resolve([]);
      if (path.endsWith('/roster-import/preview')) return Promise.resolve(preview);
      if (path.endsWith('/roster-import')) {
        return Promise.resolve({ imported: 1, skipped: 1, rows: preview });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SportsTeamDetailPage
          client={{ request }}
          teamId="team-basketball"
          user={sportsUser('manager-1', [
            {
              action: 'sports.team.update',
              resource: 'sports_team',
              scope: { type: 'sports_team', id: 'team-basketball' },
            },
          ])}
        />
      </MemoryRouter>,
    );

    const csv = '姓名,学号\n张三,20260001\n李四,20260002';
    const upload = await screen.findByLabelText('选择名单 CSV（姓名,学号）');
    await user.upload(upload, new File([csv], 'roster.csv', { type: 'text/csv' }));

    expect(await screen.findByText('姓名与现有账号不一致')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/sports/teams/team-basketball/roster-import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: csv,
    });
    expect(
      request.mock.calls.some(([path]) => path === '/sports/teams/team-basketball/roster-import'),
    ).toBe(false);
    expect(screen.getByRole('button', { name: '确认导入' })).toBeDisabled();
  });

  it('only exposes operations for the exact scoped team and honours an explicit deny', async () => {
    const request = vi.fn().mockResolvedValue([
      {
        id: 'team-basketball',
        name: '篮球队',
        description: '院篮球代表队。',
        season: '2026 秋季',
        trainingSchedule: '每周二 18:00，篮球馆',
        status: 'active',
        scope: { type: 'sports_team', id: 'team-basketball' },
      },
    ]);

    render(
      <MemoryRouter>
        <SportsTeamDetailPage
          client={{ request }}
          teamId="team-basketball"
          user={sportsUser('denied-manager', [
            {
              action: 'sports.team.update',
              resource: 'sports_team',
              scope: { type: 'sports_team', id: 'team-basketball' },
            },
            {
              action: 'sports.team.update',
              resource: 'sports_team',
              effect: 'deny',
              scope: { type: 'sports_team', id: 'team-basketball' },
            },
          ])}
        />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: '篮球队' });
    expect(screen.queryByRole('button', { name: '添加成员' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('选择名单 CSV（姓名,学号）')).not.toBeInTheDocument();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  });

  it('keeps captain check-in controls on the exact team detail without loading roster management', async () => {
    const team = {
      id: 'team-basketball',
      name: '篮球队',
      description: '院篮球代表队。',
      season: '2026 秋季',
      trainingSchedule: '每周二 18:00，篮球馆',
      status: 'active',
      scope: { type: 'sports_team', id: 'team-basketball' },
    };
    const request = vi.fn().mockImplementation((path: string) => {
      if (path === '/sports/teams') return Promise.resolve([team]);
      if (path.endsWith('/checkins')) return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SportsTeamDetailPage
          client={{ request }}
          teamId="team-basketball"
          user={sportsUser('captain-1', [
            { action: 'sports.checkin.read', resource: 'sports_checkin', scope: team.scope },
            { action: 'sports.checkin.create', resource: 'sports_checkin', scope: team.scope },
          ])}
        />
      </MemoryRouter>,
    );

    const form = await screen.findByRole('form', { name: '训练签到' });
    await user.type(within(form).getByLabelText('成员 UID'), 'student-18');
    await user.type(within(form).getByLabelText('签到日期'), '2026-10-03');
    await user.click(within(form).getByRole('button', { name: '记录签到' }));

    expect(request).toHaveBeenCalledWith('/sports/teams/team-basketball/checkins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberUid: 'student-18', checkinDate: '2026-10-03' }),
    });
    expect(request.mock.calls.flat().join(' ')).not.toContain('/members');
  });

  it('does not request check-in history when a team maintainer lacks check-in read permission', async () => {
    const team = {
      id: 'team-basketball',
      name: '篮球队',
      description: '院篮球代表队。',
      season: '2026 秋季',
      trainingSchedule: '每周二 18:00，篮球馆',
      status: 'active',
      scope: { type: 'sports_team', id: 'team-basketball' },
    };
    const request = vi.fn().mockImplementation((path: string) => {
      if (path === '/sports/teams') return Promise.resolve([team]);
      if (path.endsWith('/members')) return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter>
        <SportsTeamDetailPage
          client={{ request }}
          teamId="team-basketball"
          user={sportsUser('manager-1', [
            { action: 'sports.team.update', resource: 'sports_team', scope: team.scope },
          ])}
        />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: '篮球队' });
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/sports/teams/team-basketball/members'),
    );
    expect(request.mock.calls.flat().join(' ')).not.toContain('/checkins');
    expect(screen.queryByRole('form', { name: '训练签到' })).not.toBeInTheDocument();
  });

  it('shows read-only check-ins without a create control when create permission is absent', async () => {
    const team = {
      id: 'team-basketball',
      name: '篮球队',
      description: '院篮球代表队。',
      season: '2026 秋季',
      trainingSchedule: '每周二 18:00，篮球馆',
      status: 'active',
      scope: { type: 'sports_team', id: 'team-basketball' },
    };
    const request = vi.fn().mockImplementation((path: string) => {
      if (path === '/sports/teams') return Promise.resolve([team]);
      if (path.endsWith('/checkins'))
        return Promise.resolve([
          { id: 'checkin-1', memberUid: 'student-1', checkinDate: '2026-10-01' },
        ]);
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter>
        <SportsTeamDetailPage
          client={{ request }}
          teamId="team-basketball"
          user={sportsUser('reader-1', [
            { action: 'sports.checkin.read', resource: 'sports_checkin', scope: team.scope },
          ])}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/student-1/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '训练签到' })).not.toBeInTheDocument();
  });

  it('shows create-only check-ins without requesting history when read permission is absent', async () => {
    const team = {
      id: 'team-basketball',
      name: '篮球队',
      description: '院篮球代表队。',
      season: '2026 秋季',
      trainingSchedule: '每周二 18:00，篮球馆',
      status: 'active',
      scope: { type: 'sports_team', id: 'team-basketball' },
    };
    const request = vi.fn().mockImplementation((path: string) => {
      if (path === '/sports/teams') return Promise.resolve([team]);
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter>
        <SportsTeamDetailPage
          client={{ request }}
          teamId="team-basketball"
          user={sportsUser('captain-1', [
            { action: 'sports.checkin.create', resource: 'sports_checkin', scope: team.scope },
          ])}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('form', { name: '训练签到' })).toBeInTheDocument();
    expect(request.mock.calls.flat().join(' ')).not.toContain('/checkins');
  });

  it('clears a successful roster preview after import confirmation', async () => {
    const preview = [
      { row: 2, name: '张三', studentNumber: '20260001', outcome: 'ready', blocking: false },
    ];
    const request = vi.fn().mockImplementation((path: string) => {
      if (path === '/sports/teams')
        return Promise.resolve([
          {
            id: 'team-basketball',
            name: '篮球队',
            description: '院篮球代表队。',
            season: '2026 秋季',
            trainingSchedule: '每周二 18:00，篮球馆',
            status: 'active',
            scope: { type: 'sports_team', id: 'team-basketball' },
          },
        ]);
      if (path.endsWith('/members') || path.endsWith('/checkins')) return Promise.resolve([]);
      if (path.endsWith('/roster-import/preview')) return Promise.resolve(preview);
      if (path.endsWith('/roster-import'))
        return Promise.resolve({ imported: 1, skipped: 0, rows: preview });
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SportsTeamDetailPage
          client={{ request }}
          teamId="team-basketball"
          user={sportsUser('manager-1', [
            {
              action: 'sports.team.update',
              resource: 'sports_team',
              scope: { type: 'sports_team', id: 'team-basketball' },
            },
          ])}
        />
      </MemoryRouter>,
    );

    const csv = '姓名,学号\n张三,20260001';
    await user.upload(
      await screen.findByLabelText('选择名单 CSV（姓名,学号）'),
      new File([csv], 'roster.csv', { type: 'text/csv' }),
    );
    await user.click(await screen.findByRole('button', { name: '确认导入' }));

    await screen.findByText('名单导入完成：新增 1 人，跳过 0 人');
    expect(screen.queryByRole('table', { name: '名单预览' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认导入' })).not.toBeInTheDocument();
  });

  it('clears the prior team and ignores a stale team response when the route changes', async () => {
    let resolveFirst: ((value: SportsTeamRecord[]) => void) | undefined;
    let resolveSecond: ((value: SportsTeamRecord[]) => void) | undefined;
    let resolveThird: ((value: SportsTeamRecord[]) => void) | undefined;
    const teamA = {
      id: 'team-a',
      name: '甲队',
      description: '甲队简介',
      season: '2026 秋季',
      trainingSchedule: '周二',
      status: 'active' as const,
      scope: { type: 'sports_team', id: 'team-a' },
    };
    const teamB = {
      id: 'team-b',
      name: '乙队',
      description: '乙队简介',
      season: '2026 秋季',
      trainingSchedule: '周三',
      status: 'active' as const,
      scope: { type: 'sports_team', id: 'team-b' },
    };
    let listCalls = 0;
    const request = vi.fn().mockImplementation((path: string) => {
      if (path === '/sports/teams') {
        listCalls += 1;
        return new Promise<SportsTeamRecord[]>((resolve) => {
          if (listCalls === 1) resolveFirst = resolve;
          else if (listCalls === 2) resolveSecond = resolve;
          else resolveThird = resolve;
        });
      }
      if (path.endsWith('/members') || path.endsWith('/checkins')) return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = sportsUser('manager-1', [
      { action: 'sports.team.update', resource: 'sports_team' },
    ]);
    const view = render(
      <MemoryRouter>
        <SportsTeamDetailPage client={{ request }} teamId="team-a" user={user} />
      </MemoryRouter>,
    );

    resolveFirst?.([teamA]);
    await screen.findByRole('heading', { name: '甲队' });
    view.rerender(
      <MemoryRouter>
        <SportsTeamDetailPage client={{ request }} teamId="team-b" user={user} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('heading', { name: '甲队' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在加载代表队');
    view.rerender(
      <MemoryRouter>
        <SportsTeamDetailPage client={{ request }} teamId="team-a" user={user} />
      </MemoryRouter>,
    );
    resolveThird?.([teamA]);
    expect(await screen.findByRole('heading', { name: '甲队' })).toBeInTheDocument();
    resolveSecond?.([teamB]);
    expect(screen.queryByRole('heading', { name: '乙队' })).not.toBeInTheDocument();
  });

  it('revalidates the detail route when the authenticated user changes', async () => {
    let resolveSecond: ((value: SportsTeamRecord[]) => void) | undefined;
    const team = {
      id: 'team-basketball',
      name: '篮球队',
      description: '院篮球代表队。',
      season: '2026 秋季',
      trainingSchedule: '每周二',
      status: 'active' as const,
      scope: { type: 'sports_team', id: 'team-basketball' },
    };
    let listCalls = 0;
    const request = vi.fn().mockImplementation((path: string) => {
      if (path === '/sports/teams') {
        listCalls += 1;
        if (listCalls === 1) return Promise.resolve([team]);
        return new Promise<SportsTeamRecord[]>((resolve) => {
          resolveSecond = resolve;
        });
      }
      if (path.endsWith('/members')) return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });
    const manager = sportsUser('manager-1', [
      { action: 'sports.team.update', resource: 'sports_team', scope: team.scope },
    ]);
    const reader = sportsUser('reader-1', [
      { action: 'sports.team.read', resource: 'sports_team', scope: team.scope },
    ]);
    const view = render(
      <MemoryRouter>
        <SportsTeamDetailPage client={{ request }} teamId="team-basketball" user={manager} />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: '篮球队' });
    view.rerender(
      <MemoryRouter>
        <SportsTeamDetailPage client={{ request }} teamId="team-basketball" user={reader} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('heading', { name: '篮球队' })).not.toBeInTheDocument();
    resolveSecond?.([team]);
    await screen.findByRole('heading', { name: '篮球队' });
    expect(screen.queryByRole('button', { name: '编辑队伍信息' })).not.toBeInTheDocument();
  });

  it('keeps season and training-arrangement maintenance on the team detail page', async () => {
    const team = {
      id: 'team-basketball',
      name: '篮球队',
      description: '院篮球代表队。',
      season: '2026 秋季',
      trainingSchedule: '每周二 18:00，篮球馆',
      status: 'active',
      scope: { type: 'sports_team', id: 'team-basketball' },
    };
    const request = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/sports/teams' && init?.method === 'PATCH') return Promise.resolve(team);
      if (path === '/sports/teams') return Promise.resolve([team]);
      if (path.endsWith('/members') || path.endsWith('/checkins')) return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SportsTeamDetailPage
          client={{ request }}
          teamId="team-basketball"
          user={sportsUser('manager-1', [
            { action: 'sports.team.update', resource: 'sports_team', scope: team.scope },
          ])}
        />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: '篮球队' });
    await user.click(screen.getByRole('button', { name: '编辑队伍信息' }));
    await user.clear(screen.getByLabelText('赛季'));
    await user.type(screen.getByLabelText('赛季'), '2027 春季');
    await user.clear(screen.getByLabelText('训练或比赛安排'));
    await user.type(screen.getByLabelText('训练或比赛安排'), '每周五 19:00，篮球馆');
    await user.click(screen.getByRole('button', { name: '保存队伍信息' }));

    expect(request).toHaveBeenCalledWith('/sports/teams', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'team-basketball',
        name: '篮球队',
        description: '院篮球代表队。',
        season: '2027 春季',
        trainingSchedule: '每周五 19:00，篮球馆',
      }),
    });
  });
});
