import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SportsCardForm } from './SportsCardForm.js';
import { SportsTeamDetailPage } from './SportsTeamDetailPage.js';
import type { DevelopmentApi, SportsTeamRecord, SportsUser } from './SportsPage.js';

const teamA: SportsTeamRecord = {
  id: 'team-a',
  name: 'A 队',
  description: 'A 简介',
  season: '',
  trainingSchedule: '',
  status: 'active',
  canEditCard: true,
  scope: { type: 'sports_team', id: 'team-a' },
};
const teamB: SportsTeamRecord = {
  ...teamA,
  id: 'team-b',
  name: '当前 B 队',
  scope: { type: 'sports_team', id: 'team-b' },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function actor(uid: string, roster: boolean): SportsUser {
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
    policies: roster ? [{ action: 'sports.team.update', resource: 'sports_team' }] : [],
  };
}
function backend(
  teams: () => SportsTeamRecord[],
  mutation: ReturnType<typeof deferred<SportsTeamRecord>>,
) {
  const request = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH' || path.endsWith('/transitions')) return mutation.promise;
    if (path === '/sports/teams') return Promise.resolve(teams());
    if (path.endsWith('/homepage'))
      return Promise.resolve({ html: null, revision: 0, canEdit: false });
    if (path.endsWith('/showcase')) return Promise.resolve(null);
    return Promise.resolve([]);
  });
  return { request } satisfies DevelopmentApi;
}

const scenarios = (['card', 'roster'] as const).flatMap((mode) =>
  (['patch', 'status'] as const).flatMap((operation) =>
    (['team', 'actor', 'client'] as const).map((change) => ({ mode, operation, change })),
  ),
);
describe('sports detail pending mutation isolation', () => {
  it.each(scenarios)(
    'ignores a late $mode $operation response after changing $change',
    async ({ mode, operation, change }) => {
      const mutation = deferred<SportsTeamRecord>();
      let teams = [teamA, teamB];
      const original = backend(() => teams, mutation);
      const current = backend(
        () => [{ ...teamA, name: '当前 A 队' }, teamB],
        deferred<SportsTeamRecord>(),
      );
      const firstActor = actor('actor-a', mode === 'roster');
      const nextActor = change === 'actor' ? actor('actor-b', mode === 'roster') : firstActor;
      const page = (client: DevelopmentApi, id: string, user: SportsUser) => (
        <MemoryRouter>
          <SportsTeamDetailPage client={client} teamId={id} user={user} />
        </MemoryRouter>
      );
      const rendered = render(page(original, teamA.id, firstActor));
      await screen.findByRole('heading', { name: 'A 队' });
      const user = userEvent.setup();
      if (operation === 'patch') {
        await user.click(screen.getByRole('button', { name: '编辑队伍信息' }));
        await user.click(screen.getByRole('button', { name: '保存队伍信息' }));
      } else await user.click(screen.getByRole('button', { name: '归档队伍' }));
      teams = [{ ...teamA, name: '当前 A 队' }, teamB];
      rendered.rerender(
        page(
          change === 'client' ? current : original,
          change === 'team' ? teamB.id : teamA.id,
          nextActor,
        ),
      );
      const expected = change === 'team' ? '当前 B 队' : '当前 A 队';
      await screen.findByRole('heading', { name: expected });
      await act(async () =>
        mutation.resolve({
          ...teamA,
          name: '过期 A 队响应',
          status: operation === 'status' ? 'archived' : 'active',
        }),
      );
      expect(screen.getByRole('heading', { name: expected })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: '过期 A 队响应' })).not.toBeInTheDocument();
      expect(
        screen.queryByText(/队伍信息已更新|队伍状态已更新|队伍已归档/),
      ).not.toBeInTheDocument();
    },
  );
  it('does not show an old status failure after changing the actor', async () => {
    const mutation = deferred<SportsTeamRecord>();
    const client = backend(() => [teamA], mutation);
    const rendered = render(
      <MemoryRouter>
        <SportsTeamDetailPage client={client} teamId={teamA.id} user={actor('before', false)} />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: teamA.name });
    await userEvent.setup().click(screen.getByRole('button', { name: '归档队伍' }));
    rendered.rerender(
      <MemoryRouter>
        <SportsTeamDetailPage client={client} teamId={teamA.id} user={actor('after', false)} />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: teamA.name });
    await act(async () => mutation.reject(new Error('过期身份错误')));
    expect(screen.queryByText(/过期身份错误/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '归档队伍' })).toBeEnabled();
  });
});

describe('SportsCardForm pending request isolation', () => {
  it.each(['unmount', 'client', 'team'] as const)(
    'ignores a late successful save after %s',
    async (change) => {
      const pending = deferred<SportsTeamRecord>();
      const client = backend(() => [], pending);
      const onSaved = vi.fn();
      const onCancel = vi.fn();
      const rendered = render(
        <SportsCardForm client={client} team={teamA} onSaved={onSaved} onCancel={onCancel} />,
      );
      await userEvent.setup().click(screen.getByRole('button', { name: '保存队伍信息' }));
      if (change === 'unmount') rendered.unmount();
      else
        rendered.rerender(
          <SportsCardForm
            client={change === 'client' ? backend(() => [], deferred<SportsTeamRecord>()) : client}
            team={change === 'team' ? teamB : teamA}
            onSaved={onSaved}
            onCancel={onCancel}
          />,
        );
      await act(async () => pending.resolve(teamA));
      expect(onSaved).not.toHaveBeenCalled();
      const signal = client.request.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]
        ?.signal as AbortSignal | undefined;
      expect(signal?.aborted).toBe(true);
    },
  );
  it('ignores a late error after changing the client and keeps the current form usable', async () => {
    const pending = deferred<SportsTeamRecord>();
    const client = backend(() => [], pending);
    const next = backend(() => [], deferred<SportsTeamRecord>());
    const rendered = render(
      <SportsCardForm client={client} team={teamA} onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: '保存队伍信息' }));
    rendered.rerender(
      <SportsCardForm client={next} team={teamA} onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    await act(async () => pending.reject(new Error('旧客户端保存错误')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存队伍信息' })).toBeEnabled();
  });
});
