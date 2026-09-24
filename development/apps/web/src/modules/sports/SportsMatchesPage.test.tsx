import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { SportsMatchesPage } from './SportsMatchesPage.js';

describe('SportsMatchesPage', () => {
  it('shows the date timeline and creation entry for a sports member', async () => {
    const user = userEvent.setup();
    const request = vi.fn().mockResolvedValue([]);
    const { container } = render(
      <MemoryRouter>
        <SportsMatchesPage
          client={{ request }}
          user={{
            uid: 'member',
            displayName: '部员',
            avatarUrl: null,
            baseRole: 'student',
            roles: ['department.sports_member'],
            tags: [],
            policies: [{ action: 'sports.match.create', resource: 'sports_match' }],
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '马杯立刻看' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加比赛' })).toBeInTheDocument();
    expect((await screen.findAllByRole('button')).length).toBeGreaterThan(10);
    expect(screen.getByRole('list', { name: '所选日期的比赛时间线' })).toBeInTheDocument();
    expect(container.querySelector('.date-strip .is-today')).toHaveTextContent('今天');
    await user.click(screen.getByRole('button', { name: '添加比赛' }));
    expect(screen.getByRole('group', { name: /比赛信息/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /时间与地点/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /媒体内容/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/比赛结果/)).toBeInTheDocument();
  });

  it('shows an optional result on an ended match', async () => {
    const request = vi.fn().mockResolvedValue([
      {
        id: 'ended-match',
        title: '马杯篮球决赛',
        coverUrl: null,
        startsAt: new Date(Date.now() - 7_200_000).toISOString(),
        endsAt: new Date(Date.now() - 3_600_000).toISOString(),
        location: '篮球馆',
        liveUrl: null,
        replayUrl: null,
        result: '电院 72–68 自动化',
        ownerUid: 'member',
        scope: { type: 'public', id: '*' },
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        matchStatus: 'ended',
      },
    ]);

    render(
      <MemoryRouter>
        <SportsMatchesPage client={{ request }} user={null} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('电院 72–68 自动化')).toBeInTheDocument();
    expect(screen.getByText('比赛结果')).toBeInTheDocument();
  });

  it('lets the match owner update an ended result', async () => {
    const user = userEvent.setup();
    const match = {
      id: 'ended-match',
      title: '马杯篮球决赛',
      coverUrl: null,
      startsAt: new Date(Date.now() - 7_200_000).toISOString(),
      endsAt: new Date(Date.now() - 3_600_000).toISOString(),
      location: '篮球馆',
      liveUrl: null,
      replayUrl: null,
      result: '电院 72–68 自动化',
      ownerUid: 'member',
      scope: { type: 'public', id: '*' },
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      matchStatus: 'ended',
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce([match])
      .mockResolvedValueOnce({ ...match, result: '电院 75–70 自动化' });

    render(
      <MemoryRouter>
        <SportsMatchesPage
          client={{ request }}
          user={{
            uid: 'member',
            displayName: '部员',
            avatarUrl: null,
            baseRole: 'student',
            roles: ['department.sports_member'],
            tags: [],
            policies: [{ action: 'sports.match.update', resource: 'sports_match' }],
          }}
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: '修改赛果' }));
    const input = screen.getByLabelText('马杯篮球决赛比赛结果');
    await user.clear(input);
    await user.type(input, '电院 75–70 自动化');
    await user.click(screen.getByRole('button', { name: '保存赛果' }));

    expect(await screen.findByText('电院 75–70 自动化')).toBeInTheDocument();
    expect(request).toHaveBeenLastCalledWith(
      '/sports/matches/ended-match',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
