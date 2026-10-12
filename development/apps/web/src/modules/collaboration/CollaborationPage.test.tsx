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
    expect(screen.queryByText('＋ 创建协作空间')).not.toBeInTheDocument();
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
    fireEvent.click(await screen.findByText('＋ 创建协作空间'));
    fireEvent.click(screen.getByText('使用每日安全报告模板'));
    expect(screen.getByDisplayValue('实践每日安全报告')).toBeInTheDocument();
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
  await screen.findByText('资料');
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
  fireEvent.change(await screen.findByLabelText('修订退回材料'), {
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
  expect(await screen.findByText('青海支队')).toBeInTheDocument();
  expect(screen.getByText('需要协调帮助')).toBeInTheDocument();
  expect(screen.getByText('2026-10-10')).toBeInTheDocument();
});
