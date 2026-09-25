import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { LiaisonPage } from './LiaisonPage.js';
import type { LiaisonProblem } from './model.js';

const student: UserContext & {
  policies: Array<{ action: string; resource: string; effect: 'allow' }>;
} = {
  uid: 'demo-student',
  displayName: '普通同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
  policies: [
    { action: 'liaison.problem.read', resource: 'liaison_problem', effect: 'allow' },
    { action: 'liaison.problem.join', resource: 'liaison_problem', effect: 'allow' },
    { action: 'liaison.problem.post', resource: 'liaison_problem', effect: 'allow' },
    { action: 'liaison.problem.outcome.submit', resource: 'liaison_outcome', effect: 'allow' },
  ],
};

const problem: LiaisonProblem = {
  id: 'problem-energy',
  title: '校园能耗数据可视化',
  summary: '把匿名化能耗指标转化为可理解的交互展示。',
  background: '课题组希望验证校园数据叙事方案。',
  sourceType: 'lab' as const,
  sourceName: '校园计算实验室',
  tags: ['数据可视化', '前端'],
  expectedOutcome: '可运行原型与设计说明。',
  constraints: '只使用匿名化数据。',
  startsAt: '2026-10-01T00:00:00.000Z',
  deadline: '2026-11-15T00:00:00.000Z',
  publicContact: '联络中心公开咨询台',
  recorderUid: 'demo-liaison-member',
  reviewerUid: 'demo-tuanwei-lead',
  reviewedAt: '2026-09-20T08:00:00.000Z',
  status: 'open' as const,
  ownerUid: 'demo-liaison-member',
  scope: { type: 'public', id: '*' },
  createdAt: '2026-09-18T08:00:00.000Z',
  updatedAt: '2026-09-20T08:00:00.000Z',
};

const pendingProblem = {
  ...problem,
  id: 'problem-pending',
  title: '待审核校企课题',
  status: 'pending_review' as const,
};

function page(items: LiaisonProblem[] = [problem]) {
  return {
    items: items.map((item) => ({ ...item, teamCount: 2 })),
    page: 1,
    pageSize: 20,
    total: items.length,
  };
}

function renderPage(client: Pick<ApiClient, 'request'>, user: UserContext = student) {
  return render(
    <MemoryRouter>
      <LiaisonPage client={client} user={user} />
    </MemoryRouter>,
  );
}

describe('LiaisonPage', () => {
  it('opens the noticeboard before revealing equal-sized opportunity cards and details', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/liaison/problems?page=1&pageSize=20') return page();
      throw new Error(`Unexpected request: ${path}`);
    });

    const actor = userEvent.setup();
    renderPage({ request } as Pick<ApiClient, 'request'>);

    expect(await screen.findByRole('heading', { name: '無限机会' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '無限机会酒馆的小羊酒保' })).toBeInTheDocument();
    const preview = screen.getByRole('button', { name: '查看委托' });
    expect(preview).toHaveTextContent('校园创新课题');
    expect(preview).toHaveTextContent('公益技术协作');
    expect(within(preview).queryByText(problem.title)).not.toBeInTheDocument();
    expect(preview.querySelectorAll('.noticeboard-placeholder')).toHaveLength(2);
    expect(screen.queryByRole('region', { name: '机会委托卡牌' })).not.toBeInTheDocument();

    await actor.click(screen.getByRole('button', { name: '查看委托' }));

    expect(screen.getByRole('dialog', { name: '委托卡牌' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '机会委托卡牌' })).toBeInTheDocument();
    const card = screen.getByRole('article', { name: problem.title });
    expect(card).toHaveTextContent('课题组 · 校园计算实验室');
    expect(card).toHaveTextContent('进行中');
    expect(card).toHaveTextContent('数据可视化');
    expect(card).toHaveTextContent('截止时间');
    expect(card).toHaveTextContent(
      new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(problem.deadline!),
      ),
    );
    expect(card).toHaveTextContent('2 个参与团队');
    const detail = screen.getByRole('region', { name: `${problem.title}委托详情` });
    expect(detail).toHaveTextContent('预期成果');
    expect(detail).toHaveTextContent('可运行原型与设计说明。');
    expect(within(detail).getByRole('link', { name: '查看完整委托' })).toHaveAttribute(
      'href',
      '/liaison/problems/problem-energy',
    );
  });

  it('centers a selected opportunity card and expands its details', async () => {
    const second = {
      ...problem,
      id: 'problem-second',
      title: '校园导览体验升级',
      sourceName: '校园服务中心',
    };
    const request = vi.fn(async (path: string) => {
      if (path === '/liaison/problems?page=1&pageSize=20') return page([problem, second]);
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();

    renderPage({ request } as Pick<ApiClient, 'request'>);
    await user.click(await screen.findByRole('button', { name: '查看委托' }));

    const secondCard = await screen.findByRole('button', { name: `展开${second.title}` });
    await user.click(secondCard);

    expect(secondCard).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: `${second.title}委托详情` })).toHaveTextContent(
      second.sourceName,
    );
  });

  it('keeps noticeboard maintenance actions together for authorized editors', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/liaison/problems?page=1&pageSize=20') return page();
      throw new Error(`Unexpected request: ${path}`);
    });
    const maintainer = {
      ...student,
      uid: 'maintainer',
      policies: [
        { action: 'liaison.problem.create', resource: 'liaison_problem', effect: 'allow' as const },
        { action: 'liaison.problem.update', resource: 'liaison_problem', effect: 'allow' as const },
      ],
    };
    const actor = userEvent.setup();

    renderPage({ request } as Pick<ApiClient, 'request'>, maintainer);
    await actor.click(await screen.findByRole('button', { name: '查看委托' }));

    const board = screen.getByRole('dialog', { name: '委托卡牌' });
    expect(within(board).getByRole('button', { name: '新增委托' })).toBeInTheDocument();
    expect(within(board).getByRole('link', { name: '编辑当前委托' })).toHaveAttribute(
      'href',
      '/liaison/problems/problem-energy',
    );
  });

  it('uses API pagination metadata so records after the first 20 remain reachable', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/liaison/problems?page=1&pageSize=20') {
        return { ...page(), total: 21 };
      }
      if (path === '/liaison/problems?page=2&pageSize=20') {
        return page([{ ...problem, id: 'problem-21', title: '第二页课题' }]);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const actor = userEvent.setup();
    renderPage({ request } as Pick<ApiClient, 'request'>);
    await actor.click(await screen.findByRole('button', { name: '查看委托' }));
    await actor.click(await screen.findByRole('button', { name: '下一页' }));
    expect(await screen.findByRole('article', { name: '第二页课题' })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/liaison/problems?page=2&pageSize=20');
  });

  it('uses explicit maintenance and review permissions instead of super-admin identity', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.startsWith('/liaison/problems?')) return page([pendingProblem]);
      if (path === '/liaison/problems/problem-pending/teams') return [];
      throw new Error(`Unexpected request: ${path}`);
    });
    const actor = userEvent.setup();
    const superAdmin = { ...student, uid: 'demo-admin', roles: ['platform.super_admin'] };
    const view = renderPage({ request } as Pick<ApiClient, 'request'>, superAdmin as UserContext);
    await actor.click(await screen.findByRole('button', { name: '查看委托' }));
    await screen.findByRole('article', { name: pendingProblem.title });
    expect(screen.queryByRole('button', { name: '新增委托' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批准发布' })).not.toBeInTheDocument();

    const reviewer = {
      ...student,
      uid: 'reviewer',
      policies: [
        {
          action: 'liaison.problem.review',
          resource: 'liaison_problem',
          effect: 'allow' as const,
        },
      ],
    };
    view.rerender(
      <MemoryRouter>
        <LiaisonPage client={{ request } as Pick<ApiClient, 'request'>} user={reviewer} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: '批准发布' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '驳回修改' })).toBeInTheDocument();

    const maintainer = {
      ...student,
      uid: 'maintainer',
      policies: [
        {
          action: 'liaison.problem.create',
          resource: 'liaison_problem',
          effect: 'allow' as const,
        },
      ],
    };
    view.rerender(
      <MemoryRouter>
        <LiaisonPage client={{ request } as Pick<ApiClient, 'request'>} user={maintainer} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: '新增委托' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批准发布' })).not.toBeInTheDocument();
  });

  it('validates proxy entry and keeps form data after a recoverable error', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/liaison/problems?') && init === undefined) return page([]);
      if (path === '/liaison/problems' && init?.method === 'POST') throw new Error('offline');
      throw new Error(`Unexpected request: ${path}`);
    });
    const maintainer = {
      ...student,
      policies: [
        { action: 'liaison.problem.create', resource: 'liaison_problem', effect: 'allow' as const },
      ],
    };
    const user = userEvent.setup();
    renderPage({ request } as Pick<ApiClient, 'request'>, maintainer);

    await user.click(await screen.findByRole('button', { name: '查看委托' }));
    await user.click(screen.getByRole('button', { name: '新增委托' }));
    await user.click(screen.getByRole('button', { name: '保存课题草稿' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请填写问题标题');

    await user.type(screen.getByLabelText('问题标题'), '无障碍页面检查');
    await user.type(screen.getByLabelText('简短摘要'), '制作轻量检查原型。');
    await user.type(screen.getByLabelText('背景说明'), '企业希望共同验证无障碍流程。');
    await user.type(screen.getByLabelText('来源名称'), '校企合作伙伴');
    await user.type(screen.getByLabelText('预期成果'), '检查清单与原型。');
    await user.type(screen.getByLabelText('公开对接方式'), '联络中心公开咨询台');
    await user.click(screen.getByRole('button', { name: '保存课题草稿' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.getByLabelText('问题标题')).toHaveValue('无障碍页面检查');
  });

  it('ignores a stale board response after the active user changes', async () => {
    let resolveOld: ((value: ReturnType<typeof page>) => void) | undefined;
    const old = new Promise<ReturnType<typeof page>>((resolve) => {
      resolveOld = resolve;
    });
    const newProblem = { ...problem, id: 'problem-new', title: '新身份可见课题' };
    let listCalls = 0;
    const request = vi.fn(async (path: string) => {
      if (path.startsWith('/liaison/problems?')) {
        listCalls += 1;
        return listCalls === 1 ? old : page([newProblem]);
      }
      if (path === '/liaison/problems/problem-new/teams') return [];
      if (path === '/liaison/problems/problem-energy/teams') return [];
      throw new Error(`Unexpected request: ${path}`);
    });
    const actor = userEvent.setup();
    const view = renderPage({ request } as Pick<ApiClient, 'request'>, student);
    view.rerender(
      <MemoryRouter>
        <LiaisonPage
          client={{ request } as Pick<ApiClient, 'request'>}
          user={{ ...student, uid: 'another-student' }}
        />
      </MemoryRouter>,
    );
    await actor.click(await screen.findByRole('button', { name: '查看委托' }));
    expect(await screen.findByRole('article', { name: newProblem.title })).toBeInTheDocument();
    resolveOld?.(page());
    await Promise.resolve();
    expect(screen.queryByRole('article', { name: problem.title })).not.toBeInTheDocument();
  });

  it('keeps review errors in an alert and allows a successful retry', async () => {
    let reviews = 0;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/liaison/problems?')) return page([pendingProblem]);
      if (path === '/liaison/problems/problem-pending/teams') return [];
      if (path === '/liaison/problems/problem-pending/review' && init?.method === 'POST') {
        reviews += 1;
        if (reviews === 1) throw new Error('offline');
        return { ...pendingProblem, status: 'open' as const };
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const reviewer = {
      ...student,
      uid: 'reviewer',
      policies: [
        { action: 'liaison.problem.review', resource: 'liaison_problem', effect: 'allow' as const },
      ],
    };
    const user = userEvent.setup();
    renderPage({ request } as Pick<ApiClient, 'request'>, reviewer);

    await user.click(await screen.findByRole('button', { name: '查看委托' }));
    await user.click(await screen.findByRole('button', { name: '批准发布' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('审核失败，请重试');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准发布' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '批准发布' }));
    expect(await screen.findByRole('status')).toHaveTextContent('课题已批准发布');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces a successful generation-safe refresh after a board error', async () => {
    let listCalls = 0;
    const request = vi.fn(async (path: string) => {
      if (path.startsWith('/liaison/problems?')) {
        listCalls += 1;
        if (listCalls === 1) throw new Error('offline');
        return page([]);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    renderPage({ request } as Pick<ApiClient, 'request'>);

    await user.click(await screen.findByRole('button', { name: '查看委托' }));
    await user.click(await screen.findByRole('button', { name: '重新加载问题榜' }));
    expect(await screen.findByRole('status')).toHaveTextContent('问题榜已刷新');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not publish stale create feedback after the active user changes during refresh', async () => {
    let resolveCreateRefresh: ((value: ReturnType<typeof page>) => void) | undefined;
    const createRefresh = new Promise<ReturnType<typeof page>>((resolve) => {
      resolveCreateRefresh = resolve;
    });
    let listCalls = 0;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/liaison/problems?')) {
        listCalls += 1;
        if (listCalls === 2) return createRefresh;
        return page([]);
      }
      if (path === '/liaison/problems' && init?.method === 'POST') return problem;
      throw new Error(`Unexpected request: ${path}`);
    });
    const maintainer = {
      ...student,
      uid: 'maintainer',
      policies: [
        { action: 'liaison.problem.create', resource: 'liaison_problem', effect: 'allow' as const },
      ],
    };
    const user = userEvent.setup();
    const view = renderPage({ request } as Pick<ApiClient, 'request'>, maintainer);
    await user.click(await screen.findByRole('button', { name: '查看委托' }));
    await user.click(screen.getByRole('button', { name: '新增委托' }));
    await user.type(screen.getByLabelText('问题标题'), '身份切换中的草稿');
    await user.type(screen.getByLabelText('简短摘要'), '验证反馈不会跨身份显示。');
    await user.type(screen.getByLabelText('背景说明'), '公开背景。');
    await user.type(screen.getByLabelText('来源名称'), '校园实验室');
    await user.type(screen.getByLabelText('预期成果'), '一个原型。');
    await user.type(screen.getByLabelText('公开对接方式'), '公开咨询台');
    await user.click(screen.getByRole('button', { name: '保存课题草稿' }));
    await vi.waitFor(() => expect(listCalls).toBe(2));

    view.rerender(
      <MemoryRouter>
        <LiaisonPage
          client={{ request } as Pick<ApiClient, 'request'>}
          user={{ ...student, uid: 'another-student' }}
        />
      </MemoryRouter>,
    );
    await vi.waitFor(() => expect(listCalls).toBe(3));
    resolveCreateRefresh?.(page([problem]));
    await Promise.resolve();
    expect(screen.queryByText('问题草稿已保存')).not.toBeInTheDocument();
  });
});
