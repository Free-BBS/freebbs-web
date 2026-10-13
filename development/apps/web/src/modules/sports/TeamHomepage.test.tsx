import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SportsTeamHomepage } from '@freebbs-development/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { DevelopmentApi } from './SportsPage.js';
import { TeamHomepage } from './TeamHomepage.js';

const home: SportsTeamHomepage = {
  teamId: 'team-1',
  html: null,
  revision: 0,
  originalFilename: null,
  editor: null,
  updatedAt: null,
  canEdit: true,
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
function page(client: DevelopmentApi, teamId = 'team-1') {
  return <TeamHomepage client={client} teamId={teamId} name="游泳队" canEditCard />;
}
async function chooseHtml(user: ReturnType<typeof userEvent.setup>, filename = 'new.html') {
  await user.upload(
    await screen.findByLabelText('选择代表队 HTML 首页'),
    new File(['<h1>新主页</h1>'], filename, { type: 'text/html' }),
  );
  await screen.findByTitle('游泳队首页上传预览');
}

describe('TeamHomepage request ordering', () => {
  it.each(
    (['publish', 'delete'] as const).flatMap((operation) =>
      (['success', 'error'] as const).map((result) => ({ operation, result })),
    ),
  )('ignores an old refresh $result after successful $operation', async ({ operation, result }) => {
    const oldRead = deferred<SportsTeamHomepage>();
    const initial =
      operation === 'publish'
        ? home
        : { ...home, html: '<h1>旧主页</h1>', revision: 1, originalFilename: 'old.html' };
    const saved =
      operation === 'publish'
        ? { ...home, html: '<h1>新主页</h1>', revision: 1, originalFilename: 'new.html' }
        : { ...home, revision: 2 };
    let reads = 0;
    const request = vi.fn((path: string, init?: RequestInit) => {
      if (path.endsWith('/showcase')) return Promise.resolve(null);
      if (init?.method === 'PUT' || init?.method === 'DELETE') return Promise.resolve(saved);
      return ++reads === 1 ? Promise.resolve(initial) : oldRead.promise;
    });
    render(page({ request } as DevelopmentApi));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '刷新主页版本' }));
    if (operation === 'publish') {
      await chooseHtml(user);
      await user.click(screen.getByRole('button', { name: '确认发布首页' }));
    } else await user.click(screen.getByRole('button', { name: '移除 HTML 首页' }));
    const feedback =
      operation === 'publish' ? '代表队首页已发布' : 'HTML 首页已移除，继续展示图文风采';
    expect(await screen.findByRole('status')).toHaveTextContent(feedback);
    await act(async () => {
      if (result === 'success') oldRead.resolve(initial);
      else oldRead.reject(new Error('过期刷新错误'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(feedback);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    if (operation === 'publish') {
      expect(screen.getByTitle('游泳队首页').getAttribute('srcdoc')).toContain(saved.html);
      expect(screen.getByText('当前文件：new.html · 版本 1')).toBeInTheDocument();
    } else expect(screen.queryByTitle('游泳队首页')).not.toBeInTheDocument();
    await chooseHtml(user, 'retry.html');
    await user.click(screen.getByRole('button', { name: '确认发布首页' }));
    const writes = request.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect((writes.at(-1)?.[1]?.body as FormData).get('revision')).toBe(String(saved.revision));
  });

  it.each(['success', 'error'] as const)(
    'ignores an older overlapping refresh %s after the newest read completes',
    async (result) => {
      const older = deferred<SportsTeamHomepage>();
      const newer = deferred<SportsTeamHomepage>();
      const current = {
        ...home,
        html: '<h1>最新主页</h1>',
        revision: 2,
        originalFilename: 'latest.html',
      };
      let reads = 0;
      const request = vi.fn((path: string) => {
        if (path.endsWith('/showcase')) return Promise.resolve(null);
        return ++reads === 1 ? Promise.resolve(home) : reads === 2 ? older.promise : newer.promise;
      });
      render(page({ request } as DevelopmentApi));
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: '刷新主页版本' }));
      await user.click(screen.getByRole('button', { name: '刷新主页版本' }));
      await act(async () => newer.resolve(current));
      await act(async () => {
        if (result === 'success')
          older.resolve({ ...current, revision: 1, html: '<h1>过期主页</h1>' });
        else older.reject(new Error('过期刷新错误'));
      });
      expect(screen.getByTitle('游泳队首页').getAttribute('srcdoc')).toContain(current.html);
      expect(screen.getByText('当前文件：latest.html · 版本 2')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('does not roll back a published revision even when a later refresh returns older data', async () => {
    const saved = { ...home, html: '<h1>新主页</h1>', revision: 1, originalFilename: 'new.html' };
    const request = vi.fn((path: string, init?: RequestInit) =>
      Promise.resolve(path.endsWith('/showcase') ? null : init?.method === 'PUT' ? saved : home),
    );
    render(page({ request } as DevelopmentApi));
    const user = userEvent.setup();
    await chooseHtml(user);
    await user.click(screen.getByRole('button', { name: '确认发布首页' }));
    expect(await screen.findByRole('status')).toHaveTextContent('代表队首页已发布');
    await user.click(screen.getByRole('button', { name: '刷新主页版本' }));
    expect(screen.getByTitle('游泳队首页').getAttribute('srcdoc')).toContain(saved.html);
    expect(screen.getByRole('status')).toHaveTextContent('代表队首页已发布');
  });

  it.each(['team', 'client'] as const)(
    'ignores a refresh error after changing %s',
    async (change) => {
      const oldRead = deferred<SportsTeamHomepage>();
      let reads = 0;
      const request = vi.fn((path: string) => {
        if (path.endsWith('/showcase')) return Promise.resolve(null);
        return ++reads === 2 ? oldRead.promise : Promise.resolve(home);
      });
      const client = { request } as DevelopmentApi;
      const next = {
        request: vi.fn((path: string) => Promise.resolve(path.endsWith('/showcase') ? null : home)),
      } as DevelopmentApi;
      const rendered = render(page(client));
      await userEvent.setup().click(await screen.findByRole('button', { name: '刷新主页版本' }));
      rendered.rerender(
        page(change === 'client' ? next : client, change === 'team' ? 'team-2' : 'team-1'),
      );
      await screen.findByLabelText('选择代表队 HTML 首页');
      await act(async () => oldRead.reject(new Error('旧页面刷新错误')));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('preserves a conflicted draft while refreshing the revision for retry', async () => {
    let reads = 0;
    let writes = 0;
    const request = vi.fn((path: string, init?: RequestInit) => {
      if (path.endsWith('/showcase')) return Promise.resolve(null);
      if (init?.method === 'PUT')
        return ++writes === 1
          ? Promise.reject(new Error('版本冲突'))
          : Promise.resolve({ ...home, html: '<h1>新主页</h1>', revision: 6 });
      return Promise.resolve({ ...home, revision: ++reads === 1 ? 0 : 5 });
    });
    render(page({ request } as DevelopmentApi));
    const user = userEvent.setup();
    await chooseHtml(user);
    await user.click(screen.getByRole('button', { name: '确认发布首页' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('草稿已保留');
    await user.click(screen.getByRole('button', { name: '刷新主页版本' }));
    expect(screen.getByTitle('游泳队首页上传预览')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认发布首页' }));
    const puts = request.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect((puts[1]?.[1]?.body as FormData).get('revision')).toBe('5');
    expect(await screen.findByRole('status')).toHaveTextContent('代表队首页已发布');
  });
});
