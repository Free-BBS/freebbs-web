import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SportsPage, type DevelopmentApi, type SportsUser } from './SportsPage.js';
import { SportsTeamDetailPage } from './SportsTeamDetailPage.js';
import { TeamHomepage } from './TeamHomepage.js';

const team = {
  id: 'team-1',
  name: '游泳队',
  description: '游泳代表队',
  season: '',
  trainingSchedule: '',
  status: 'active',
  scope: { type: 'sports_team', id: 'team-1' },
  canEditCard: true,
};
const home = {
  teamId: 'team-1',
  html: null,
  revision: 0,
  originalFilename: null,
  editor: null,
  updatedAt: null,
  canEdit: true,
};

describe('sports card and HTML workflow', () => {
  it('shows an authorized create form, keeps failed input, and adds the saved team', async () => {
    let failed = true;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/sports/capabilities') return { canCreate: true };
      if (init?.method === 'POST') {
        if (failed) throw new Error('暂时不可用');
        return { ...team, status: 'draft' };
      }
      return [];
    });
    render(
      <MemoryRouter>
        <SportsPage client={{ request } as DevelopmentApi} />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '添加代表队' }));
    await user.type(screen.getByLabelText('队伍名称'), '游泳队');
    await user.type(screen.getByLabelText('公开简介'), '游泳代表队');
    await user.click(screen.getByRole('button', { name: '创建代表队' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时不可用');
    expect(screen.getByLabelText('队伍名称')).toHaveValue('游泳队');
    failed = false;
    await user.click(screen.getByRole('button', { name: '创建代表队' }));
    expect(await screen.findByRole('heading', { name: '游泳队' })).toBeInTheDocument();
  });
  it('hides create for a student and uses server card decisions without adding roster authority', async () => {
    const request = vi.fn(async (path: string) =>
      path === '/sports/capabilities'
        ? { canCreate: false }
        : path.endsWith('/homepage')
          ? home
          : [team],
    );
    const rendered = render(
      <MemoryRouter>
        <SportsPage client={{ request } as DevelopmentApi} />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: '游泳队' });
    expect(screen.queryByRole('button', { name: '添加代表队' })).not.toBeInTheDocument();
    rendered.unmount();
    render(
      <MemoryRouter>
        <SportsTeamDetailPage client={{ request } as DevelopmentApi} teamId="team-1" />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: '编辑队伍信息' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '授予队长' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '添加成员' })).not.toBeInTheDocument();
  });
  it('previews the complete isolated HTML before confirming, preserves failed drafts and supports cancel', async () => {
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') throw new Error('保存失败');
      return home;
    });
    render(
      <TeamHomepage
        client={{ request } as DevelopmentApi}
        teamId="team-1"
        name="游泳队"
        canEditCard
      />,
    );
    const user = userEvent.setup();
    const upload = await screen.findByLabelText('选择代表队 HTML 首页');
    const html =
      '<!doctype html><html><head><style>body{color:red}</style></head><body><h1>比赛</h1><script>parent.document.title="attack"</script></body></html>';
    await user.upload(upload, new File([html], 'index.html', { type: 'text/html' }));
    const preview = await screen.findByTitle('游泳队首页上传预览');
    expect(preview).toHaveAttribute('sandbox', 'allow-scripts');
    expect(preview.getAttribute('srcdoc')).toContain(html);
    expect(preview.getAttribute('srcdoc')).toContain("connect-src 'none'");
    expect(request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    await user.click(screen.getByRole('button', { name: '确认发布首页' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('草稿已保留');
    expect(screen.getByTitle('游泳队首页上传预览')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消上传' }));
    expect(screen.queryByTitle('游泳队首页上传预览')).not.toBeInTheDocument();
  });
  it('ignores a stale homepage response after switching team', async () => {
    let resolveOld!: (value: unknown) => void;
    const request = vi.fn((path: string) =>
      path.includes('team-1')
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve({ ...home, teamId: 'team-2', html: '<h1>新队</h1>', canEdit: false }),
    );
    const rendered = render(
      <TeamHomepage
        client={{ request } as DevelopmentApi}
        teamId="team-1"
        name="旧队"
        canEditCard
      />,
    );
    rendered.rerender(
      <TeamHomepage
        client={{ request } as DevelopmentApi}
        teamId="team-2"
        name="新队"
        canEditCard={false}
      />,
    );
    await screen.findByTitle('新队首页');
    resolveOld({ ...home, html: '<h1>旧队</h1>' });
    await waitFor(() =>
      expect(screen.getByTitle('新队首页').getAttribute('srcdoc')).not.toContain('<h1>旧队</h1>'),
    );
    expect(screen.queryByLabelText('选择代表队 HTML 首页')).not.toBeInTheDocument();
  });
  it('honours a server card denial even when a separate roster policy is present', async () => {
    const request = vi
      .fn()
      .mockImplementation((path: string) =>
        Promise.resolve(
          path === '/sports/teams'
            ? [{ ...team, canEditCard: false }]
            : path.endsWith('/homepage')
              ? { ...home, canEdit: false }
              : [],
        ),
      );
    const user: SportsUser = {
      uid: 'scoped-admin',
      displayName: 'Admin',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
      policies: [{ action: 'sports.team.update', resource: 'sports_team', scope: team.scope }],
    };
    render(
      <MemoryRouter>
        <SportsTeamDetailPage client={{ request }} teamId="team-1" user={user} />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: '游泳队' });
    expect(screen.queryByRole('button', { name: '编辑队伍信息' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '归档队伍' })).not.toBeInTheDocument();
  });
  it('keeps HTML editing available while respecting a denied legacy showcase capability', async () => {
    const request = vi
      .fn()
      .mockImplementation((path: string) =>
        Promise.resolve(
          path === '/sports/teams'
            ? [{ ...team, canEditShowcase: false }]
            : path.endsWith('/homepage')
              ? home
              : null,
        ),
      );
    render(
      <MemoryRouter>
        <SportsTeamDetailPage client={{ request }} teamId="team-1" />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('选择代表队 HTML 首页')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑风采' })).not.toBeInTheDocument();
  });
  it('publishes and removes HTML with the current revision, then restores legacy content', async () => {
    const html = '<!doctype html><html><body><h1>泳池</h1></body></html>';
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/showcase')) return { markdown: '# 原有图文风采' };
      if (init?.method === 'PUT')
        return { ...home, html, revision: 1, originalFilename: 'index.htm' };
      if (init?.method === 'DELETE') return { ...home, revision: 2 };
      return home;
    });
    render(
      <TeamHomepage
        client={{ request } as DevelopmentApi}
        teamId="team-1"
        name="游泳队"
        canEditCard
      />,
    );
    const user = userEvent.setup();
    await user.upload(
      await screen.findByLabelText('选择代表队 HTML 首页'),
      new File([html], 'index.htm', { type: 'text/html' }),
    );
    await screen.findByTitle('游泳队首页上传预览');
    await user.click(screen.getByRole('button', { name: '确认发布首页' }));
    expect(await screen.findByTitle('游泳队首页')).toBeInTheDocument();
    expect(screen.queryByTitle('游泳队首页上传预览')).not.toBeInTheDocument();
    expect(screen.queryByText('原有图文风采')).not.toBeInTheDocument();
    const put = request.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect((put[1]?.body as FormData).get('revision')).toBe('0');
    await user.click(screen.getByRole('button', { name: '移除 HTML 首页' }));
    expect(await screen.findByText('原有图文风采')).toBeInTheDocument();
    expect(request.mock.calls.find(([, init]) => init?.method === 'DELETE')?.[1]?.body).toBe(
      JSON.stringify({ revision: 1 }),
    );
  });
  it('cancels an in-flight upload and ignores its late response', async () => {
    let completeUpload!: (value: unknown) => void;
    const request = vi.fn((path: string, init?: RequestInit) => {
      if (init?.method === 'PUT')
        return new Promise((resolve) => {
          completeUpload = resolve;
        });
      return Promise.resolve(path.endsWith('/showcase') ? null : home);
    });
    render(
      <TeamHomepage
        client={{ request } as DevelopmentApi}
        teamId="team-1"
        name="游泳队"
        canEditCard
      />,
    );
    const user = userEvent.setup();
    await user.upload(
      await screen.findByLabelText('选择代表队 HTML 首页'),
      new File(['<h1>Pending</h1>'], 'index.html', { type: 'text/html' }),
    );
    await screen.findByTitle('游泳队首页上传预览');
    await user.click(screen.getByRole('button', { name: '确认发布首页' }));
    await user.click(screen.getByRole('button', { name: '取消上传' }));
    const signal = request.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]?.signal;
    expect(signal?.aborted).toBe(true);
    completeUpload({ ...home, html: '<h1>Late</h1>', revision: 1 });
    await waitFor(() => expect(screen.queryByTitle('游泳队首页')).not.toBeInTheDocument());
  });
});
