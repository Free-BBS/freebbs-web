import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { SportsMatchesPage } from './SportsMatchesPage.js';
import type { SportsMatch } from '@freebbs-development/contracts';
import type { DevelopmentApi, SportsUser } from './SportsPage.js';

const member: SportsUser = {
  uid: 'member',
  displayName: '部员',
  avatarUrl: null,
  baseRole: 'student',
  roles: ['department.sports_member'],
  tags: [],
  policies: [
    { action: 'sports.match.create', resource: 'sports_match' },
    { action: 'sports.match.update', resource: 'sports_match' },
  ],
};
const matchToday = (patch: Partial<SportsMatch> = {}): SportsMatch => ({
  id: 'match',
  title: '篮球决赛',
  ...endedToday(),
  coverUrl: null,
  location: '篮球馆',
  liveUrl: 'https://example.com/live',
  replayUrl: 'https://example.com/replay',
  result: '电院 72–68 自动化',
  ownerUid: 'member',
  scope: { type: 'public', id: '*' },
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  matchStatus: 'ended',
  ...patch,
});

function show(request: DevelopmentApi['request'], actor: SportsUser | null = member) {
  return render(
    <MemoryRouter>
      <SportsMatchesPage client={{ request }} user={actor} />
    </MemoryRouter>,
  );
}

const endedToday = () => {
  const endsAt = new Date();
  const startsAt = new Date(endsAt);
  startsAt.setHours(0, 0, 0, 0);
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
};

describe('SportsMatchesPage', () => {
  it('preserves a newer result when an older live-link response arrives last', async () => {
    const match = matchToday();
    let finishLink!: (value: SportsMatch) => void;
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (!init) return [match];
      const body = JSON.parse(String(init.body));
      if ('liveUrl' in body)
        return new Promise<SportsMatch>((resolve) => {
          finishLink = resolve;
        });
      return { ...match, result: body.result };
    });
    const user = userEvent.setup();
    show(request as unknown as DevelopmentApi['request']);
    await user.click(await screen.findByRole('button', { name: '修改直播链接' }));
    await user.clear(screen.getByLabelText('篮球决赛直播链接'));
    await user.type(screen.getByLabelText('篮球决赛直播链接'), 'https://example.com/new');
    await user.click(screen.getByRole('button', { name: '保存直播链接' }));
    await user.click(screen.getByRole('button', { name: '修改赛果' }));
    await user.clear(screen.getByLabelText('篮球决赛比赛结果'));
    await user.type(screen.getByLabelText('篮球决赛比赛结果'), '电院 80–70 自动化');
    await user.click(screen.getByRole('button', { name: '保存赛果' }));
    await screen.findByText('电院 80–70 自动化');
    await act(async () => finishLink({ ...match, liveUrl: 'https://example.com/new' }));
    expect(screen.getByText('电院 80–70 自动化')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '观看直播' })).toHaveAttribute(
      'href',
      'https://example.com/new',
    );
  });
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
    expect(screen.getByRole('heading', { name: '懂無帝' })).toBeInTheDocument();
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
    const times = endedToday();
    const request = vi.fn().mockResolvedValue([
      {
        id: 'ended-match',
        title: '马杯篮球决赛',
        coverUrl: null,
        ...times,
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
    const times = endedToday();
    const match = {
      id: 'ended-match',
      title: '马杯篮球决赛',
      coverUrl: null,
      ...times,
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

  it('lets a member change only their match live link', async () => {
    const user = userEvent.setup();
    const match = matchToday();
    const request = vi
      .fn()
      .mockResolvedValueOnce([match])
      .mockResolvedValueOnce({ ...match, liveUrl: 'https://example.com/new' });
    show(request);
    await user.click(await screen.findByRole('button', { name: '修改直播链接' }));
    await user.clear(screen.getByLabelText('篮球决赛直播链接'));
    await user.type(screen.getByLabelText('篮球决赛直播链接'), 'https://example.com/new');
    await user.click(screen.getByRole('button', { name: '保存直播链接' }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: '观看直播' })).toHaveAttribute(
        'href',
        'https://example.com/new',
      ),
    );
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
      liveUrl: 'https://example.com/new',
    });
    expect(screen.getByText(match.result!)).toBeInTheDocument();
    expect(screen.getByText(match.location)).toBeInTheDocument();
  });

  it('retains the live-link draft and original match when saving fails', async () => {
    const user = userEvent.setup();
    const request = vi
      .fn()
      .mockResolvedValueOnce([matchToday()])
      .mockRejectedValueOnce(new Error('链接保存失败'));
    show(request);
    await user.click(await screen.findByRole('button', { name: '修改直播链接' }));
    const input = screen.getByLabelText('篮球决赛直播链接');
    await user.clear(input);
    await user.type(input, 'https://example.com/draft');
    await user.click(screen.getByRole('button', { name: '保存直播链接' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('链接保存失败');
    expect(input).toHaveValue('https://example.com/draft');
    expect(screen.getByRole('link', { name: '观看直播' })).toHaveAttribute(
      'href',
      'https://example.com/live',
    );
  });

  it('blocks unsafe live links before saving and permits removing a link', async () => {
    const user = userEvent.setup();
    const match = matchToday();
    const request = vi
      .fn()
      .mockResolvedValueOnce([match])
      .mockResolvedValueOnce({ ...match, liveUrl: null });
    show(request);
    await user.click(await screen.findByRole('button', { name: '修改直播链接' }));
    const input = screen.getByLabelText('篮球决赛直播链接');
    await user.clear(input);
    await user.type(input, 'javascript:alert(1)');
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('http 或 https');
    expect(request).toHaveBeenCalledTimes(1);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: '保存直播链接' }));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: '观看直播' })).not.toBeInTheDocument(),
    );
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ liveUrl: null });
  });

  it('keeps a pending live-link save single and prevents switching away', async () => {
    const user = userEvent.setup();
    const match = matchToday();
    let finish!: (value: SportsMatch) => void;
    const pending = new Promise<SportsMatch>((resolve) => {
      finish = resolve;
    });
    const request = vi
      .fn()
      .mockResolvedValueOnce([match, matchToday({ id: 'second', title: '排球决赛' })])
      .mockReturnValueOnce(pending);
    show(request);
    await user.click((await screen.findAllByRole('button', { name: '修改直播链接' }))[0]);
    const input = screen.getByLabelText('篮球决赛直播链接');
    fireEvent.submit(input.closest('form')!);
    fireEvent.submit(input.closest('form')!);
    expect(request).toHaveBeenCalledTimes(2);
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '修改直播链接' })).toBeDisabled();
    finish(match);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '保存中…' })).not.toBeInTheDocument(),
    );
  });

  it('shows broader match editing only for a permitted sports leader', async () => {
    const request = vi.fn().mockResolvedValue([matchToday({ ownerUid: 'other' })]);
    const actor: SportsUser = { ...member, roles: ['domain.sports_lead'] };
    const { rerender } = show(request, actor);
    expect(await screen.findByRole('button', { name: '修改直播链接' })).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <SportsMatchesPage client={{ request }} user={{ ...actor, policies: [] }} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: '修改直播链接' })).not.toBeInTheDocument();
  });

  it('keeps students and members viewing other owners read-only', async () => {
    const request = vi.fn().mockResolvedValue([matchToday({ ownerUid: 'other' })]);
    const { rerender } = show(request, { ...member, roles: [], policies: [] });
    expect(await screen.findByText('篮球决赛')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加比赛' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /直播链接|赛果/ })).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <SportsMatchesPage client={{ request }} user={member} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /直播链接|赛果/ })).not.toBeInTheDocument();
  });

  it('offers match dates beyond the two-week date rail', async () => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    const request = vi.fn().mockResolvedValue([matchToday({ startsAt: date.toISOString() })]);
    show(request, null);
    const button = await screen.findByRole('button', {
      name: date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
    });
    await userEvent.setup().click(button);
    expect(await screen.findByText('篮球决赛')).toBeInTheDocument();
  });

  it('publishes a member live link once and retains inputs on failure', async () => {
    const user = userEvent.setup();
    let rejectSave!: (reason: Error) => void;
    const pending = new Promise((_, reject) => {
      rejectSave = reject;
    });
    const request = vi.fn().mockResolvedValueOnce([]).mockReturnValueOnce(pending);
    const { container } = show(request);
    await user.click(screen.getByRole('button', { name: '添加比赛' }));
    await user.type(screen.getByLabelText('比赛名称'), '篮球决赛');
    await user.type(screen.getByLabelText('比赛地点'), '篮球馆');
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-10-08T10:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-10-08T12:00' } });
    await user.type(screen.getByLabelText(/直播链接/), 'https://example.com/new');
    fireEvent.submit(container.querySelector('.match-form')!);
    fireEvent.submit(container.querySelector('.match-form')!);
    expect(screen.getByRole('button', { name: '发布中…' })).toBeDisabled();
    expect(request.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
      liveUrl: 'https://example.com/new',
    });
    rejectSave(new Error('发布失败'));
    expect(await screen.findByRole('alert')).toHaveTextContent('发布失败');
    expect(screen.getByLabelText('比赛名称')).toHaveValue('篮球决赛');
    expect(screen.getByLabelText(/直播链接/)).toHaveValue('https://example.com/new');
  });

  it('releases cover previews on replacement, closing and unmount', async () => {
    const create = vi
      .fn()
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second')
      .mockReturnValueOnce('blob:third');
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    const user = userEvent.setup();
    const { container, unmount } = show(vi.fn().mockResolvedValue([]));
    await user.click(screen.getByRole('button', { name: '添加比赛' }));
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    await user.upload(input, new File(['one'], 'one.png', { type: 'image/png' }));
    await user.upload(input, new File(['two'], 'two.png', { type: 'image/png' }));
    expect(revoke).toHaveBeenCalledWith('blob:first');
    await user.click(screen.getByRole('button', { name: '关闭添加比赛' }));
    expect(revoke).toHaveBeenCalledWith('blob:second');
    await user.click(screen.getByRole('button', { name: '添加比赛' }));
    await user.upload(
      container.querySelector<HTMLInputElement>('input[type=file]')!,
      new File(['three'], 'three.png', { type: 'image/png' }),
    );
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:third');
    vi.unstubAllGlobals();
  });
});
