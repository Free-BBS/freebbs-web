import userEvent from '@testing-library/user-event';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('../../core/auth/AuthProvider.js', () => ({ useAuth: mocks.auth }));
import { CollaborationPage } from './CollaborationPage.js';

function bookingPage(
  bookingOccupancy: Array<{ resource: string; startsAt: string; endsAt: string }>,
) {
  const space = {
    id: 'booking',
    kind: 'booking',
    title: '空间预约',
    description: '',
    ownerUid: 'staff',
    departmentId: null,
    audience: 'all',
    status: 'published',
    revision: 1,
    columns: [],
    slots: [],
    stages: [],
    history: [],
    entries: [],
    canManage: false,
    bookingOccupancy,
  };
  mocks.auth.mockReturnValue({
    client: { request: vi.fn(async () => space) },
    user: { uid: 'student', roles: [] },
  });
  return render(
    <MemoryRouter initialEntries={['/tools/booking']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
it('shows shared occupied times grouped by date and resource in day/week views even with no private entries', async () => {
  bookingPage([
    { resource: '摄影棚', startsAt: '2026-10-12T01:00:00Z', endsAt: '2026-10-12T02:00:00Z' },
    { resource: '会议室', startsAt: '2026-10-12T03:00:00Z', endsAt: '2026-10-12T04:00:00Z' },
    { resource: '摄影棚', startsAt: '2026-10-13T05:00:00Z', endsAt: '2026-10-13T06:00:00Z' },
    { resource: '跨日资源', startsAt: '2026-10-11T15:00:00Z', endsAt: '2026-10-12T01:00:00Z' },
  ]);
  const calendar = await screen.findByRole('region', { name: '预约占用日历' });
  fireEvent.change(within(calendar).getByLabelText('日历日期'), {
    target: { value: '2026-10-12' },
  });
  expect(within(calendar).getByText('09:00 — 10:00')).toBeInTheDocument();
  expect(within(calendar).getByText('11:00 — 12:00')).toBeInTheDocument();
  expect(within(calendar).getByText('00:00 — 09:00')).toBeInTheDocument();
  expect(within(calendar).queryByText('13:00 — 14:00')).not.toBeInTheDocument();
  fireEvent.click(within(calendar).getByRole('button', { name: '周视图' }));
  expect(within(calendar).getAllByRole('heading', { level: 3 })).toHaveLength(7);
  expect(within(calendar).getByText('13:00 — 14:00')).toBeInTheDocument();
  fireEvent.click(within(calendar).getByRole('button', { name: '下一周' }));
  expect(within(calendar).queryByText('09:00 — 10:00')).not.toBeInTheDocument();
  expect(within(calendar).getByText('本周暂无预约占用')).toBeInTheDocument();
});
it('provides a clear empty occupied-day state without inferring occupancy from private entries', async () => {
  bookingPage([]);
  const calendar = await screen.findByRole('region', { name: '预约占用日历' });
  expect(within(calendar).getByText('当天暂无预约占用')).toBeInTheDocument();
  expect(within(calendar).getByRole('button', { name: '日视图' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
describe('collaboration frontend', () => {
  it('discards pending private list when identity changes', async () => {
    let resolveOld!: (value: unknown) => void;
    const oldRequest = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const newRequest = vi.fn(async () => ({ items: [], canCreate: false }));
    mocks.auth.mockReturnValue({
      client: { request: oldRequest },
      user: { uid: 'staff', roles: [] },
    });
    const page = render(
      <MemoryRouter>
        <CollaborationPage />
      </MemoryRouter>,
    );
    mocks.auth.mockReturnValue({
      client: { request: newRequest },
      user: { uid: 'other', roles: [] },
    });
    page.rerender(
      <MemoryRouter>
        <CollaborationPage />
      </MemoryRouter>,
    );
    await act(async () => {
      resolveOld({
        canCreate: true,
        items: [
          {
            id: 'secret',
            kind: 'materials',
            title: 'Private report',
            status: 'draft',
            updatedAt: '2026-10-10T00:00:00Z',
          },
        ],
      });
    });
    expect(screen.queryByText('Private report')).not.toBeInTheDocument();
    expect(screen.queryByText('创建协作空间')).not.toBeInTheDocument();
  });
  it('creates structured safety report from the practical template', async () => {
    const request = vi.fn(async () => ({ items: [], canCreate: true }));
    mocks.auth.mockReturnValue({
      client: { request },
      user: { uid: 'staff', roles: ['department.rights_development_member'] },
    });
    render(
      <MemoryRouter>
        <CollaborationPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText('创建协作空间'));
    fireEvent.click(screen.getByText('使用每日安全报告模板'));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByDisplayValue('实践每日安全报告')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByDisplayValue('报告日期')).toBeInTheDocument();
    expect(screen.getByDisplayValue('安全状态')).toBeInTheDocument();
    expect(screen.getByText('应报告用户编号（逗号分隔）')).toBeInTheDocument();
  });
});

it('shows review buttons only for the actual assigned stage, even for managers', async () => {
  const space = {
    id: 'review',
    kind: 'review',
    title: '阶段审核',
    description: '',
    ownerUid: 'staff',
    departmentId: null,
    audience: 'all',
    status: 'published',
    revision: 1,
    columns: [],
    slots: [],
    stages: [{ title: '辅导员', roleKeys: ['counselor.practice'] }],
    history: [],
    canManage: true,
    entries: [
      {
        id: 'entry',
        uid: 'student',
        displayName: '同学',
        updatedAt: '2026-10-10T00:00:00Z',
        resource: '',
        text: '资料',
        choices: [],
        files: [],
        decisions: [],
        stage: 0,
        reviewStatus: 'pending',
        canReview: false,
      },
    ],
  };
  const request = vi.fn(async (_path?: string, _options?: unknown) => {
    void _path;
    void _options;
    return space;
  });
  mocks.auth.mockReturnValue({
    client: { request },
    user: { uid: 'staff', roles: ['department.rights_development_member'] },
  });
  render(
    <MemoryRouter initialEntries={['/tools/review']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: '记录' }));
  expect(screen.getByText('资料')).toBeInTheDocument();
  expect(screen.queryByText('确认通过')).not.toBeInTheDocument();
  expect(screen.queryByText('退回补充')).not.toBeInTheDocument();
});

it('prefills rejected review and submits its explicit ID', async () => {
  const space = {
    id: 'review',
    kind: 'review',
    title: '退回审核',
    description: '',
    ownerUid: 'staff',
    departmentId: null,
    audience: 'all',
    status: 'published',
    revision: 4,
    columns: [],
    slots: [],
    stages: [{ title: '审核', roleKeys: ['counselor.practice'] }],
    history: [],
    canManage: false,
    entries: [
      {
        id: 'rejected-entry',
        uid: 'student',
        displayName: '同学',
        updatedAt: '2026-10-10T00:00:00Z',
        resource: '',
        text: '需要修订的初稿',
        values: {},
        choices: [],
        files: [],
        decisions: [],
        stage: 0,
        reviewStatus: 'rejected',
        canReview: false,
      },
    ],
  };
  const request = vi.fn(async (_path?: string, _options?: unknown) => {
    void _path;
    void _options;
    return space;
  });
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'student', roles: [] } });
  render(
    <MemoryRouter initialEntries={['/tools/review']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: '参与填写' }));
  fireEvent.change(screen.getByLabelText('修订退回材料'), {
    target: { value: 'rejected-entry' },
  });
  expect(screen.getByDisplayValue('需要修订的初稿')).toBeInTheDocument();
  fireEvent.change(screen.getByDisplayValue('需要修订的初稿'), {
    target: { value: '修订后的内容' },
  });
  fireEvent.click(screen.getByText('提交记录'));
  await act(async () => {});
  const options = request.mock.calls.at(-1)?.[1] as unknown as { body: string };
  expect(JSON.parse(options.body)).toMatchObject({
    entryId: 'rejected-entry',
    text: '修订后的内容',
    revision: 4,
  });
});
it('renders report date team and safety status on material cards', async () => {
  const space = {
    id: 'safety',
    kind: 'materials',
    title: '安全日报',
    description: '',
    ownerUid: 'staff',
    departmentId: null,
    audience: 'all',
    status: 'published',
    revision: 2,
    columns: [
      { id: 'report_date', label: '报告日期', kind: 'date', required: true },
      { id: 'team', label: '支队', kind: 'text', required: true },
      { id: 'safety', label: '安全状态', kind: 'text', required: true },
    ],
    slots: [],
    stages: [],
    history: [],
    canManage: false,
    entries: [
      {
        id: 'report',
        uid: 'student',
        displayName: '同学',
        updatedAt: '2026-10-10T00:00:00Z',
        resource: '',
        text: '请协助',
        values: { report_date: '2026-10-10', team: '青海支队', safety: '需要协调帮助' },
        choices: [],
        files: [],
        decisions: [],
        stage: 0,
        reviewStatus: 'pending',
      },
    ],
  };
  const request = vi.fn(async (_path?: string, _options?: unknown) => {
    void _path;
    void _options;
    return space;
  });
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'student', roles: [] } });
  render(
    <MemoryRouter initialEntries={['/tools/safety']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: '记录' }));
  expect(screen.getByText('青海支队')).toBeInTheDocument();
  expect(screen.getByText('需要协调帮助')).toBeInTheDocument();
  expect(screen.getByText('2026-10-10')).toBeInTheDocument();
});

function refreshedSpace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'space',
    kind: 'attendance',
    title: '本地协作',
    description: '',
    ownerUid: 'manager',
    departmentId: null,
    audience: 'all',
    status: 'published',
    revision: 3,
    updatedAt: '2026-10-12T00:00:00Z',
    columns: [],
    slots: [],
    stages: [],
    history: [],
    entries: [],
    canManage: false,
    ...overrides,
  };
}
function detailPage(
  space = refreshedSpace(),
  request = vi.fn(async (_path?: string, _options?: { method?: string }) => {
    void _path;
    void _options;
    return space;
  }),
) {
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'student', roles: [] } });
  render(
    <MemoryRouter initialEntries={['/tools/space']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return request;
}
it('groups all seven tools and searches only the authorized list with a status filter', async () => {
  mocks.auth.mockReturnValue({
    client: {
      request: vi.fn(async () => ({
        canCreate: false,
        items: [
          refreshedSpace({ id: 'a', title: '训练资料', kind: 'materials' }),
          refreshedSpace({ id: 'b', title: '训练草稿', status: 'draft' }),
        ],
      })),
    },
    user: { uid: 'student', roles: [] },
  });
  render(
    <MemoryRouter>
      <CollaborationPage />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: '时间安排' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '共同记录' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '材料流程' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('搜索协作空间'), { target: { value: '训练' } });
  fireEvent.change(screen.getByLabelText('空间状态'), { target: { value: 'published' } });
  expect(screen.getByRole('link', { name: /训练资料/ })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /训练草稿/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /创建协作空间/ })).not.toBeInTheDocument();
});
it('creates only at the final step and retains the creation draft after a failed save', async () => {
  const request = vi.fn(async (_path: string, options?: { method?: string }) => {
    if (options?.method === 'POST') throw new Error('本地保存失败');
    return { items: [], canCreate: true };
  });
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'manager', roles: [] } });
  render(
    <MemoryRouter>
      <CollaborationPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '创建协作空间' }));
  fireEvent.click(screen.getByText('使用训练打卡模板'));
  expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(screen.getByLabelText('名称')).toHaveValue('训练参与记录');
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '保留的名称' } });
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
  await screen.findByText('本地保存失败');
  fireEvent.click(screen.getByRole('button', { name: '上一步' }));
  expect(screen.getByLabelText('名称')).toHaveValue('保留的名称');
});
it('validates the current creation step before advancing', async () => {
  mocks.auth.mockReturnValue({
    client: { request: vi.fn(async () => ({ items: [], canCreate: true })) },
    user: { uid: 'manager', roles: [] },
  });
  render(
    <MemoryRouter>
      <CollaborationPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '创建协作空间' }));
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(screen.getByText('请填写空间名称')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '创建草稿' })).not.toBeInTheDocument();
});
it('preserves participant draft across tabs and a failed submission, and keeps manager settings private', async () => {
  const space = refreshedSpace();
  const request = vi.fn(async (_path?: string, options?: { method?: string }) => {
    if (options?.method === 'POST') throw new Error('提交失败，请重试');
    return space;
  });
  detailPage(space, request);
  fireEvent.click(await screen.findByRole('tab', { name: '参与填写' }));
  fireEvent.change(screen.getByLabelText('内容与说明'), { target: { value: '还未提交的草稿' } });
  fireEvent.click(screen.getByRole('tab', { name: '记录' }));
  fireEvent.click(screen.getByRole('tab', { name: '参与填写' }));
  expect(screen.getByLabelText('内容与说明')).toHaveValue('还未提交的草稿');
  fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
  await screen.findByText('提交失败，请重试');
  expect(screen.getByLabelText('内容与说明')).toHaveValue('还未提交的草稿');
  expect(screen.queryByRole('tab', { name: '管理设置' })).not.toBeInTheDocument();
});
it('requires confirmation to close collection and hides participation once closed', async () => {
  const space = refreshedSpace({ canManage: true });
  const request = vi.fn(async (_path?: string, options?: { method?: string }) =>
    options?.method ? { ...space, status: 'closed', revision: 4 } : space,
  );
  detailPage(space, request);
  fireEvent.click(await screen.findByRole('tab', { name: '管理设置' }));
  fireEvent.click(screen.getByRole('button', { name: '结束收集' }));
  expect(request.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '确认结束收集' }));
  await act(async () => {});
  fireEvent.click(screen.getByRole('tab', { name: '参与填写' }));
  expect(screen.queryByRole('button', { name: '提交记录' })).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('tabpanel')).getByText('收集已结束，可在记录中查看已提交内容。'),
  ).toBeInTheDocument();
});

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry',
    uid: 'student',
    displayName: '同学',
    createdAt: '2026-10-12T00:00:00Z',
    updatedAt: '2026-10-12T00:00:00Z',
    values: {},
    resource: '',
    startsAt: '',
    endsAt: '',
    text: '原记录',
    choices: [],
    files: [],
    decisions: [],
    stage: 0,
    reviewStatus: 'pending',
    canReview: false,
    assignedSlot: null,
    ...overrides,
  };
}
it('prefills the existing availability choices and submits the original entry ID', async () => {
  const space = refreshedSpace({
    kind: 'availability',
    slots: [
      {
        id: 'old-slot',
        title: '原有时间',
        startsAt: '2026-10-12T00:00:00Z',
        endsAt: '2026-10-12T01:00:00Z',
        capacity: 20,
      },
    ],
    entries: [record({ choices: ['old-slot'] })],
  });
  const request = detailPage(space);
  fireEvent.click(await screen.findByRole('tab', { name: '参与填写' }));
  expect(screen.getByRole('button', { name: '原有时间' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
  await act(async () => {});
  const options = request.mock.calls.at(-1)?.[1] as { body?: string };
  expect(JSON.parse(options.body!)).toMatchObject({
    entryId: 'entry',
    choices: ['old-slot'],
    revision: 3,
  });
});
it('offers editable own material records and keeps other rows out of the ordinary edit selector', async () => {
  const space = refreshedSpace({
    kind: 'materials',
    entries: [record(), record({ id: 'other', uid: 'other', displayName: '别人的记录' })],
  });
  const request = detailPage(space);
  fireEvent.click(await screen.findByRole('tab', { name: '参与填写' }));
  const selector = screen.getByLabelText('编辑现有记录');
  expect(within(selector).queryByRole('option', { name: /别人的记录/ })).not.toBeInTheDocument();
  fireEvent.change(selector, { target: { value: 'entry' } });
  expect(screen.getByLabelText('内容与说明')).toHaveValue('原记录');
  fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
  await act(async () => {});
  const options = request.mock.calls.at(-1)?.[1] as { body?: string };
  expect(JSON.parse(options.body!)).toMatchObject({ entryId: 'entry', text: '原记录' });
});
it('retains settings after failed PATCH and locks submitted schema without sending unchanged columns', async () => {
  const space = refreshedSpace({
    canManage: true,
    kind: 'shared_table',
    columns: [{ id: 'number', label: '人数', kind: 'number', required: true }],
    entries: [record({ values: { number: 2 } })],
  });
  const request = vi.fn(async (_path?: string, options?: { method?: string; body?: string }) => {
    if (options?.method === 'PATCH') throw new Error('设置保存失败');
    return space;
  });
  detailPage(space, request);
  fireEvent.click(await screen.findByRole('tab', { name: '管理设置' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑设置' }));
  expect(screen.getByLabelText('字段名称')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '修改后名称' } });
  fireEvent.click(screen.getByRole('button', { name: '保存协作空间' }));
  await screen.findByText('设置保存失败');
  fireEvent.click(screen.getByRole('tab', { name: '概览' }));
  fireEvent.click(screen.getByRole('tab', { name: '管理设置' }));
  expect(screen.getByLabelText('名称')).toHaveValue('修改后名称');
  const options = request.mock.calls.at(-1)?.[1] as { body?: string };
  expect(JSON.parse(options.body!)).toMatchObject({ title: '修改后名称', revision: 3 });
  expect(JSON.parse(options.body!)).not.toHaveProperty('columns');
});
it('searches shared rows and requires explicit confirmation before deleting an own record', async () => {
  const space = refreshedSpace({
    kind: 'shared_table',
    entries: [
      record({ displayName: '自己' }),
      record({ id: 'other', uid: 'other', displayName: '别人' }),
    ],
  });
  const request = detailPage(space);
  fireEvent.click(await screen.findByRole('tab', { name: '记录' }));
  expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('搜索记录'), { target: { value: '自己' } });
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  expect(request.mock.calls.some((call) => call[1]?.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await act(async () => {});
  const options = request.mock.calls.at(-1)?.[1] as { method?: string; body?: string };
  expect(options.method).toBe('DELETE');
  expect(JSON.parse(options.body!)).toMatchObject({ revision: 3 });
});
it('uses actual stage review permission for ordinary assigned reviewers and preserves their note on failure', async () => {
  const space = refreshedSpace({
    kind: 'review',
    stages: [{ title: '负责审核', roleKeys: ['counselor.practice'] }],
    entries: [record({ uid: 'other', canReview: true })],
  });
  const request = vi.fn(async (_path?: string, options?: { method?: string }) => {
    if (options?.method === 'POST') throw new Error('审核暂未保存');
    return space;
  });
  detailPage(space, request);
  fireEvent.click(await screen.findByRole('tab', { name: '记录' }));
  fireEvent.change(screen.getByLabelText('处理说明'), { target: { value: '请补充细节' } });
  fireEvent.click(screen.getByRole('button', { name: '退回补充' }));
  await screen.findByText('审核暂未保存');
  expect(screen.getByLabelText('处理说明')).toHaveValue('请补充细节');
  expect(screen.queryByRole('tab', { name: '管理设置' })).not.toBeInTheDocument();
  expect(screen.getByRole('list', { name: '审核阶段' })).toBeInTheDocument();
});

it('matches department and team query scope before local filters and sorts by recent updates', async () => {
  const request = vi.fn(async () => ({
    canCreate: false,
    items: [
      refreshedSpace({
        id: 'older',
        title: '较早记录',
        departmentId: 'scope',
        teamId: 'team',
        updatedAt: '2026-10-10T00:00:00Z',
      }),
      refreshedSpace({
        id: 'newer',
        title: '最近记录',
        departmentId: 'scope',
        teamId: 'team',
        updatedAt: '2026-10-12T00:00:00Z',
      }),
      refreshedSpace({ id: 'other', title: '其他部门', departmentId: 'other', teamId: 'team' }),
      refreshedSpace({
        id: 'different-team',
        title: '其他支队',
        departmentId: 'scope',
        teamId: 'different',
      }),
    ],
  }));
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'student', roles: [] } });
  render(
    <MemoryRouter initialEntries={['/?department=scope&team=team']}>
      <CollaborationPage />
    </MemoryRouter>,
  );
  await screen.findByRole('link', { name: /最近记录/ });
  const links = within(screen.getByRole('region', { name: '我的可见协作空间' })).getAllByRole(
    'link',
  );
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/collections/tools/newer',
    '/collections/tools/older',
  ]);
  expect(screen.queryByRole('link', { name: /其他部门|其他支队/ })).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('所属部门筛选')).getAllByRole('option')).toHaveLength(2);
});
it('group creation opens the matching tool without posting', async () => {
  const request = vi.fn(async (_path?: string, options?: { method?: string }) => {
    void _path;
    void options;
    return { canCreate: true, items: [] };
  });
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'manager', roles: [] } });
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(
    <MemoryRouter>
      <CollaborationPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '创建预约日历' }));
  const picker = screen.getByRole('button', { name: /预约日历 推送/ });
  expect(picker).toHaveAttribute('aria-pressed', 'true');
  expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
  scroll.mockRestore();
});
it('keeps column restrictions authoritative for department managers editing another row', async () => {
  const space = refreshedSpace({
    kind: 'shared_table',
    canManage: true,
    columns: [
      {
        id: 'verified',
        label: '确认状态',
        kind: 'choice',
        required: false,
        options: ['待核对', '已核对'],
        editRoleKeys: ['restricted.role'],
      },
    ],
    entries: [record({ uid: 'other', values: { verified: '已核对' } })],
  });
  detailPage(space);
  fireEvent.click(await screen.findByRole('tab', { name: '参与填写' }));
  fireEvent.change(screen.getByLabelText('编辑现有行'), { target: { value: 'entry' } });
  expect(screen.getByLabelText(/确认状态/)).toBeDisabled();
  expect(screen.getByLabelText(/确认状态/)).toHaveValue('已核对');
});
it('keeps review controls available after collection closes while blocking new submissions', async () => {
  const space = refreshedSpace({
    kind: 'review',
    status: 'closed',
    entries: [record({ canReview: true })],
  });
  detailPage(space);
  fireEvent.click(await screen.findByRole('tab', { name: '记录' }));
  expect(screen.getByRole('button', { name: '确认通过' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '退回补充' })).toBeEnabled();
  fireEvent.click(screen.getByRole('tab', { name: '参与填写' }));
  expect(screen.queryByRole('button', { name: '提交记录' })).not.toBeInTheDocument();
});

it('keeps volunteer decisions and manager allocation available after collection closes', async () => {
  const space = refreshedSpace({
    kind: 'practice',
    status: 'closed',
    canManage: true,
    entries: [record({ assignedSlot: 'slot', assignmentStatus: 'pending' })],
  });
  detailPage(space);
  fireEvent.click(await screen.findByRole('tab', { name: '记录' }));
  expect(screen.getByRole('button', { name: '接受安排' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '拒绝安排' })).toBeEnabled();
  expect(screen.getByLabelText('调整同学支队')).toBeEnabled();
  fireEvent.click(screen.getByRole('tab', { name: '管理设置' }));
  expect(screen.getByRole('button', { name: '按志愿生成安排' })).toBeEnabled();
});

it('keeps existing table record deletion available after collection closes', async () => {
  const space = refreshedSpace({
    kind: 'shared_table',
    status: 'closed',
    entries: [record()],
  });
  const request = detailPage(space);
  fireEvent.click(await screen.findByRole('tab', { name: '记录' }));
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await act(async () => {});
  expect(request).toHaveBeenCalledWith('/collaboration/space/entries/entry', {
    method: 'DELETE',
    body: JSON.stringify({ revision: 3 }),
    headers: { 'Content-Type': 'application/json' },
  });
});

it('retains participant and settings drafts throughout attachment background refresh and a new revision', async () => {
  const space = refreshedSpace({ kind: 'materials', canManage: true, entries: [record()] });
  let resolveRefresh!: (value: unknown) => void;
  let reads = 0;
  const request = vi.fn(async (_path?: string, options?: { method?: string }) => {
    if (options?.method) return {};
    if (++reads === 1) return space;
    return new Promise((resolve) => {
      resolveRefresh = resolve;
    });
  });
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'student', roles: [] } });
  render(
    <MemoryRouter initialEntries={['/tools/space']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: '管理设置' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑设置' }));
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '尚未保存的设置' } });
  fireEvent.click(screen.getByRole('tab', { name: '参与填写' }));
  fireEvent.change(screen.getByLabelText('内容与说明'), {
    target: { value: '附件刷新期间保留的草稿' },
  });
  fireEvent.click(screen.getByRole('tab', { name: '记录' }));
  fireEvent.change(screen.getByLabelText('补充附件'), {
    target: { files: [new File(['data'], 'draft.txt')] },
  });
  await act(async () => {});
  expect(reads).toBe(2);
  fireEvent.click(screen.getByRole('tab', { name: '参与填写' }));
  expect(screen.getByLabelText('内容与说明')).toHaveValue('附件刷新期间保留的草稿');
  await act(async () => {
    resolveRefresh({
      ...space,
      revision: 4,
      entries: [record({ files: [{ id: 'file', name: 'draft.txt', bytes: 4 }] })],
    });
  });
  expect(screen.getByLabelText('内容与说明')).toHaveValue('附件刷新期间保留的草稿');
  fireEvent.click(screen.getByRole('tab', { name: '管理设置' }));
  expect(screen.getByLabelText('名称')).toHaveValue('尚未保存的设置');
});

it('does not submit when the native next-step click reveals the final submit button', async () => {
  const user = userEvent.setup();
  const request = vi.fn(async (_path?: string, options?: { method?: string }) => {
    void _path;
    return options?.method ? refreshedSpace({ status: 'draft' }) : { items: [], canCreate: true };
  });
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'manager', roles: [] } });
  render(
    <MemoryRouter>
      <CollaborationPage />
    </MemoryRouter>,
  );
  await user.click(await screen.findByRole('button', { name: '创建协作空间' }));
  await user.click(screen.getByText('使用训练打卡模板'));
  await user.click(screen.getByRole('button', { name: '下一步' }));
  const lastNext = screen.getByRole('button', { name: '下一步' });
  await user.click(lastNext);
  expect(screen.getByRole('button', { name: '创建草稿' })).not.toBe(lastNext);
  expect(request.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(0);
  expect(screen.getByRole('button', { name: '创建草稿' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '创建草稿' }));
  expect(request.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
});

it('reports upload partial success when the subsequent GET fails without losing draft or repeating upload', async () => {
  const space = refreshedSpace({ kind: 'materials', entries: [record()] });
  let reads = 0;
  const request = vi.fn(async (_path?: string, options?: { method?: string }) => {
    void _path;
    if (options?.method === 'POST') return {};
    reads++;
    if (reads === 2) throw new Error('刷新中断');
    return reads === 1
      ? space
      : {
          ...space,
          revision: 4,
          entries: [record({ files: [{ id: 'file', name: 'uploaded.txt', bytes: 4 }] })],
        };
  });
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'student', roles: [] } });
  render(
    <MemoryRouter initialEntries={['/tools/space']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: '参与填写' }));
  fireEvent.change(screen.getByLabelText('内容与说明'), {
    target: { value: '上传后的未提交草稿' },
  });
  fireEvent.click(screen.getByRole('tab', { name: '记录' }));
  fireEvent.change(screen.getByLabelText('补充附件'), {
    target: { files: [new File(['data'], 'uploaded.txt')] },
  });
  await screen.findByText('附件已上传，但列表刷新失败：刷新中断');
  expect(screen.queryByText('已上传1个附件。')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试上传' })).not.toBeInTheDocument();
  expect(request.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', { name: '参与填写' }));
  expect(screen.getByLabelText('内容与说明')).toHaveValue('上传后的未提交草稿');
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await act(async () => {});
  expect(reads).toBe(3);
  expect(request.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
  expect(screen.getByLabelText('内容与说明')).toHaveValue('上传后的未提交草稿');
});

function deferredPageResponse() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it('refreshes versions after conflict while preserving the selected record and draft', async () => {
  const original = refreshedSpace({
    kind: 'materials',
    definitionRevision: 1,
    entries: [record({ revision: 1 })],
  });
  let writes = 0;
  let reads = 0;
  const request = vi.fn(async (_path?: string, options?: { method?: string; body?: string }) => {
    if (options?.method === 'POST') {
      if (++writes === 1)
        throw Object.assign(new Error('Conflict'), { status: 409, code: 'revision_conflict' });
      return { ...original, revision: 6, entries: [record({ revision: 3 })] };
    }
    return ++reads === 1
      ? original
      : {
          ...original,
          revision: 5,
          definitionRevision: 4,
          entries: [record({ revision: 2, text: 'Updated server body' })],
        };
  });
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'student', roles: [] } });
  render(
    <MemoryRouter initialEntries={['/tools/space']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: '参与填写' }));
  fireEvent.change(screen.getByLabelText('编辑现有记录'), { target: { value: 'entry' } });
  fireEvent.change(screen.getByLabelText('内容与说明'), { target: { value: 'Unsaved draft' } });
  fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
  await screen.findByText('版本 5');
  expect(screen.getByLabelText('内容与说明')).toHaveValue('Unsaved draft');
  expect(screen.getByLabelText('编辑现有记录')).toHaveValue('entry');
  fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
  await screen.findByText('版本 6');
  const lastWrite = request.mock.calls.filter((call) => call[1]?.method === 'POST').at(-1)!;
  expect(JSON.parse(lastWrite[1]!.body!)).toMatchObject({
    entryId: 'entry',
    entryRevision: 2,
    definitionRevision: 4,
    revision: 5,
    text: 'Unsaved draft',
  });
});

it('drops private state when the user changes while the API client stays stable', async () => {
  const original = refreshedSpace({
    kind: 'materials',
    title: 'Private original space',
    entries: [record()],
    canManage: true,
  });
  const client = { request: vi.fn(async () => original) };
  mocks.auth.mockReturnValue({ client, user: { uid: 'student', roles: [] } });
  const page = render(
    <MemoryRouter initialEntries={['/tools/space']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText('Private original space');
  client.request.mockResolvedValue({
    ...original,
    title: 'Public next space',
    entries: [],
    canManage: false,
  });
  mocks.auth.mockReturnValue({ client, user: { uid: 'other', roles: [] } });
  page.rerender(
    <MemoryRouter initialEntries={['/tools/space']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText('Public next space');
  expect(screen.queryByText('Private original space')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '管理设置' })).not.toBeInTheDocument();
});
it('keeps a newer successful submission when the earlier attachment GET resolves last', async () => {
  const original = refreshedSpace({ kind: 'materials', entries: [record()] });
  const refresh = deferredPageResponse();
  let reads = 0;
  const request = vi.fn(async (path?: string, options?: { method?: string; body?: string }) => {
    if (options?.method === 'POST' && path?.endsWith('/files')) return {};
    if (options?.method === 'POST')
      return {
        ...original,
        revision: 5,
        entries: [record(), record({ id: 'new', text: '最新保存记录' })],
      };
    return ++reads === 1 ? original : refresh.promise;
  });
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'student', roles: [] } });
  render(
    <MemoryRouter initialEntries={['/tools/space']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: '记录' }));
  fireEvent.change(screen.getByLabelText('补充附件'), {
    target: { files: [new File(['data'], 'race.txt')] },
  });
  await act(async () => {});
  expect(reads).toBe(2);
  fireEvent.click(screen.getByRole('tab', { name: '参与填写' }));
  fireEvent.change(screen.getByLabelText('内容与说明'), { target: { value: '最新保存记录' } });
  fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
  await screen.findByText('版本 5');
  await act(async () => {
    refresh.resolve({ ...original, revision: 4 });
  });
  expect(screen.getByText('版本 5')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交记录' })).toBeEnabled();
  expect(screen.getByLabelText('内容与说明')).toHaveValue('最新保存记录');
  fireEvent.click(screen.getByRole('tab', { name: '记录' }));
  expect(within(screen.getByRole('tabpanel')).getByText('最新保存记录')).toBeInTheDocument();
});
it('releases page busy state and preserves its write when attachment refresh starts during a pending mutation', async () => {
  const original = refreshedSpace({ kind: 'materials', entries: [record()] });
  const upload = deferredPageResponse();
  const mutation = deferredPageResponse();
  const refresh = deferredPageResponse();
  let reads = 0;
  const request = vi.fn(async (path?: string, options?: { method?: string }) => {
    if (options?.method === 'POST')
      return path?.endsWith('/files') ? upload.promise : mutation.promise;
    return ++reads === 1 ? original : refresh.promise;
  });
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'student', roles: [] } });
  render(
    <MemoryRouter initialEntries={['/tools/space']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: '记录' }));
  fireEvent.change(screen.getByLabelText('补充附件'), {
    target: { files: [new File(['data'], 'late.txt')] },
  });
  fireEvent.click(screen.getByRole('tab', { name: '参与填写' }));
  fireEvent.change(screen.getByLabelText('内容与说明'), { target: { value: '待保存的记录' } });
  fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
  expect(screen.getByRole('button', { name: '提交中…' })).toBeDisabled();
  await act(async () => {
    upload.resolve({});
  });
  expect(reads).toBe(2);
  await act(async () => {
    mutation.resolve({
      ...original,
      revision: 5,
      entries: [record(), record({ id: 'new', text: '待保存的记录' })],
    });
  });
  expect(screen.getByRole('button', { name: '提交记录' })).toBeEnabled();
  expect(screen.getByText('版本 5')).toBeInTheDocument();
  await act(async () => {
    refresh.resolve({ ...original, revision: 4 });
  });
  expect(screen.getByText('版本 5')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交记录' })).toBeEnabled();
  expect(screen.getByLabelText('内容与说明')).toHaveValue('待保存的记录');
});

it('keeps the newer refresh snapshot when it arrives before an older pending mutation response', async () => {
  const original = refreshedSpace({ kind: 'materials', entries: [record()] });
  const upload = deferredPageResponse();
  const mutation = deferredPageResponse();
  const refresh = deferredPageResponse();
  let reads = 0;
  const request = vi.fn(async (path?: string, options?: { method?: string }) => {
    if (options?.method === 'POST')
      return path?.endsWith('/files') ? upload.promise : mutation.promise;
    return ++reads === 1 ? original : refresh.promise;
  });
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'student', roles: [] } });
  render(
    <MemoryRouter initialEntries={['/tools/space']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: '记录' }));
  fireEvent.change(screen.getByLabelText('补充附件'), {
    target: { files: [new File(['data'], 'order.txt')] },
  });
  fireEvent.click(screen.getByRole('tab', { name: '参与填写' }));
  fireEvent.change(screen.getByLabelText('内容与说明'), { target: { value: '保留的提交内容' } });
  fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
  await act(async () => {
    upload.resolve({});
  });
  await act(async () => {
    refresh.resolve({
      ...original,
      revision: 6,
      entries: [record(), record({ id: 'newest', text: '最新后台记录' })],
    });
  });
  expect(screen.getByText('版本 6')).toBeInTheDocument();
  await act(async () => {
    mutation.resolve({ ...original, revision: 5 });
  });
  expect(screen.getByText('版本 6')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交记录' })).toBeEnabled();
  expect(screen.getByLabelText('内容与说明')).toHaveValue('保留的提交内容');
  fireEvent.click(screen.getByRole('tab', { name: '记录' }));
  expect(within(screen.getByRole('tabpanel')).getByText('最新后台记录')).toBeInTheDocument();
});

it('does not rebase an edited record onto a newer concurrent write when an older save resolves last', async () => {
  const original = refreshedSpace({
    kind: 'materials',
    definitionRevision: 1,
    entries: [record({ revision: 1 })],
  });
  const mutation = deferredPageResponse();
  let reads = 0;
  const request = vi.fn(async (path?: string, options?: { method?: string; body?: string }) => {
    if (options?.method === 'POST') return path?.endsWith('/files') ? {} : mutation.promise;
    return ++reads === 1
      ? original
      : { ...original, revision: 6, entries: [record({ revision: 4, text: 'Concurrent edit' })] };
  });
  mocks.auth.mockReturnValue({ client: { request }, user: { uid: 'student', roles: [] } });
  render(
    <MemoryRouter initialEntries={['/tools/space']}>
      <Routes>
        <Route path="/tools/:spaceId" element={<CollaborationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: '参与填写' }));
  fireEvent.change(screen.getByLabelText('编辑现有记录'), { target: { value: 'entry' } });
  fireEvent.change(screen.getByLabelText('内容与说明'), { target: { value: 'My edit' } });
  fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
  fireEvent.click(screen.getByRole('tab', { name: '记录' }));
  fireEvent.change(screen.getByLabelText('补充附件'), {
    target: { files: [new File(['data'], 'race.txt')] },
  });
  await screen.findByText('版本 6');
  await act(async () => {
    mutation.resolve({
      ...original,
      revision: 5,
      entries: [record({ revision: 3, text: 'My edit' })],
    });
  });
  fireEvent.click(screen.getByRole('tab', { name: '参与填写' }));
  fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
  await act(async () => {});
  const write = request.mock.calls
    .filter((call) => call[1]?.method === 'POST' && !call[0]?.endsWith('/files'))
    .at(-1)!;
  expect(JSON.parse(write[1]!.body!)).toMatchObject({ entryRevision: 3, text: 'My edit' });
});
