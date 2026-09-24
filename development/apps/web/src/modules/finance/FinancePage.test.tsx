import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinancePage } from './FinancePage';

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));

vi.mock('../../core/api/client.js', () => ({
  createApiClient: () => ({ request: mockRequest }),
}));

const existingRecord = {
  id: 'finance-1',
  title: '社团年度预算',
  kind: 'budget',
  amountCents: 12345,
  activityId: null,
  status: 'submitted',
  ownerUid: 'demo-admin',
  scope: { type: 'public', id: '*' },
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
};
const financeLead = {
  uid: 'finance-lead',
  displayName: '财务负责人',
  avatarUrl: null,
  baseRole: 'student' as const,
  roles: [],
  tags: [],
  policies: [
    {
      id: 'create',
      action: 'finance.record.create',
      resource: 'finance_record',
      effect: 'allow' as const,
    },
    {
      id: 'update',
      action: 'finance.record.update',
      resource: 'finance_record',
      effect: 'allow' as const,
    },
    {
      id: 'approve',
      action: 'finance.record.approve',
      resource: 'finance_record',
      effect: 'allow' as const,
    },
  ],
};

describe('FinancePage', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a department member the approved, spent, pending and remaining budget', async () => {
    const artsMember = {
      ...financeLead,
      uid: 'arts-member',
      roles: ['department.arts_member' as const],
    };
    const financeRecord = (
      id: string,
      kind: 'budget' | 'settlement',
      amountCents: number,
      status: 'approved' | 'submitted' | 'rejected',
    ) => ({
      ...existingRecord,
      id,
      title: id,
      kind,
      amountCents,
      status,
      organizationId: 'arts_center',
      scope: { type: 'social_organization', id: 'arts_center' },
    });
    mockRequest.mockResolvedValueOnce([
      financeRecord('年度预算', 'budget', 100_000, 'approved'),
      financeRecord('已报销', 'settlement', 35_000, 'approved'),
      financeRecord('审批中', 'settlement', 10_000, 'submitted'),
      financeRecord('已驳回', 'settlement', 5_000, 'rejected'),
    ]);

    render(<FinancePage user={artsMember} />);

    const overview = await screen.findByRole('region', { name: '文艺中心预算概览' });
    expect(within(overview).getByText('剩余预算')).toBeInTheDocument();
    expect(within(overview).getByText('¥650.00')).toBeInTheDocument();
    expect(within(overview).getByText('¥1000.00')).toBeInTheDocument();
    expect(within(overview).getByText('¥350.00')).toBeInTheDocument();
    expect(within(overview).getByText('¥100.00')).toBeInTheDocument();
  });

  it('uses the shared module shell for filtering, async states, records and actions', async () => {
    mockRequest.mockResolvedValueOnce([existingRecord]);

    render(<FinancePage user={financeLead} />);

    const heading = screen.getByRole('heading', { name: '财务治理' });
    expect(heading.closest('header')).toHaveClass('module-page-header');
    const filters = screen.getByRole('search', { name: '筛选财务记录' });
    expect(filters).toHaveClass('filter-bar');
    const list = await screen.findByRole('list', { name: '财务记录' });
    expect(list).toHaveClass('responsive-record-list');
    expect(within(list).getByText('待审批')).toHaveClass('status-badge');
    expect(screen.getByRole('button', { name: '批准' }).parentElement).toHaveClass(
      'module-page-actions',
    );

    await userEvent.type(screen.getByLabelText('搜索财务记录'), '没有这条记录');
    expect(screen.getByText('没有匹配的财务记录').closest('[data-state]')).toHaveAttribute(
      'data-state',
      'empty',
    );
  });

  it('displays integer-cent amounts and creates an exact-cent draft before refreshing', async () => {
    const created = {
      ...existingRecord,
      id: 'finance-2',
      title: '迎新活动预算',
      amountCents: 8850,
      status: 'draft',
    };
    mockRequest
      .mockResolvedValueOnce([existingRecord])
      .mockResolvedValueOnce(created)
      .mockResolvedValueOnce([existingRecord, created]);

    render(<FinancePage user={financeLead} />);

    expect(await screen.findByText('社团年度预算')).toBeInTheDocument();
    expect(screen.getByText('¥123.45')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('记录标题'), '迎新活动预算');
    await userEvent.clear(screen.getByLabelText('金额（元）'));
    await userEvent.type(screen.getByLabelText('金额（元）'), '88.50');
    await userEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(3));
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      '/finance/records',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: '迎新活动预算',
          kind: 'budget',
          amountCents: 8850,
          activityId: null,
          status: 'draft',
          scope: { type: 'public', id: '*' },
        }),
      }),
    );
    expect(await screen.findByText('财务草稿已创建')).toBeInTheDocument();
    expect(screen.getByText('迎新活动预算')).toBeInTheDocument();
  });

  it('distinguishes empty, validation and restricted states', async () => {
    mockRequest.mockResolvedValueOnce([]);
    const { rerender } = render(<FinancePage user={financeLead} />);
    expect((await screen.findByText('暂无财务记录')).closest('[data-state]')).toHaveAttribute(
      'data-state',
      'empty',
    );

    await userEvent.type(screen.getByLabelText('记录标题'), '错误金额');
    await userEvent.clear(screen.getByLabelText('金额（元）'));
    await userEvent.type(screen.getByLabelText('金额（元）'), '1.999');
    await userEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(screen.getByRole('alert')).toHaveTextContent('金额最多保留两位小数');
    expect(mockRequest).toHaveBeenCalledTimes(1);

    mockRequest.mockReset();
    mockRequest.mockRejectedValueOnce({ status: 403, message: 'forbidden' });
    rerender(<FinancePage key="restricted" user={financeLead} />);
    expect((await screen.findByText('暂无财务访问权限')).closest('[data-state]')).toHaveAttribute(
      'data-state',
      'error',
    );
  });

  it('gates draft creation by the exact live scope with deny precedence', async () => {
    const scopedUser = {
      ...financeLead,
      policies: [
        {
          id: 'allow-organization-a',
          action: 'finance.record.create',
          resource: 'finance_record',
          effect: 'allow' as const,
          scope: { type: 'organization', id: 'organization-a' },
        },
        {
          id: 'allow-organization-b',
          action: 'finance.record.create',
          resource: 'finance_record',
          effect: 'allow' as const,
          scope: { type: 'organization', id: 'organization-b' },
        },
        {
          id: 'deny-organization-b',
          action: 'finance.record.create',
          resource: 'finance_record',
          effect: 'deny' as const,
          scope: { type: 'organization', id: 'organization-b' },
        },
      ],
    };
    mockRequest.mockResolvedValueOnce([]);
    render(<FinancePage user={scopedUser} />);

    expect(await screen.findByText('暂无财务记录')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: '保存草稿' });
    expect(submit).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('范围类型'));
    await userEvent.type(screen.getByLabelText('范围类型'), 'organization');
    await userEvent.clear(screen.getByLabelText('范围标识'));
    await userEvent.type(screen.getByLabelText('范围标识'), 'organization-a');
    expect(submit).toBeEnabled();

    await userEvent.clear(screen.getByLabelText('范围标识'));
    await userEvent.type(screen.getByLabelText('范围标识'), 'organization-b');
    expect(submit).toBeDisabled();
  });

  it('rechecks transition permission at click time after policy expiry', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-07-28T04:00:00.000Z');
    const expiresAt = new Date(now.getTime() + 1000);
    vi.setSystemTime(now);
    const expiringUser = {
      ...financeLead,
      policies: [
        {
          id: 'expiring-update',
          action: 'finance.record.update',
          resource: 'finance_record',
          effect: 'allow' as const,
          expiresAt: expiresAt.toISOString(),
        },
      ],
    };
    const draft = { ...existingRecord, status: 'draft', ownerUid: 'another-owner' };
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/finance/records' && init === undefined) return [draft];
      return draft;
    });

    render(<FinancePage user={expiringUser} />);
    await act(async () => {
      await Promise.resolve();
    });
    const submit = screen.getByRole('button', { name: '提交审批' });

    vi.setSystemTime(new Date(expiresAt.getTime() + 1));
    fireEvent.click(submit);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('权限已失效或不适用于该记录');
  });

  it('rerenders when the next active policy expires while the page remains open', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-07-28T04:10:00.000Z');
    vi.setSystemTime(now);
    const expiringUser = {
      ...financeLead,
      policies: [
        {
          id: 'expiring-update',
          action: 'finance.record.update',
          resource: 'finance_record',
          effect: 'allow' as const,
          expiresAt: new Date(now.getTime() + 1000).toISOString(),
        },
      ],
    };
    const draft = { ...existingRecord, status: 'draft', ownerUid: 'another-owner' };
    mockRequest.mockResolvedValue([draft]);

    render(<FinancePage user={expiringUser} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: '提交审批' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(screen.queryByRole('button', { name: '提交审批' })).not.toBeInTheDocument();
  });

  it('runs the complete lifecycle and preserves confirmed state after a failed write', async () => {
    type Status = 'draft' | 'submitted' | 'approved' | 'rejected' | 'archived';
    let current = { ...existingRecord, status: 'draft' as Status };
    let rejectArchive = true;
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/finance/records' && init === undefined) return [current];
      if (path === `/finance/records/${current.id}/transitions`) {
        const body = JSON.parse(String(init?.body)) as { to: Status };
        if (body.to === 'archived' && rejectArchive) throw new Error('archive rejected');
        current = { ...current, status: body.to };
        return current;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<FinancePage user={financeLead} />);
    await userEvent.click(await screen.findByRole('button', { name: '提交审批' }));
    await userEvent.click(await screen.findByRole('button', { name: '驳回' }));
    await userEvent.click(await screen.findByRole('button', { name: '退回草稿' }));
    await userEvent.click(await screen.findByRole('button', { name: '提交审批' }));
    await userEvent.click(await screen.findByRole('button', { name: '批准' }));
    await waitFor(() => expect(current.status).toBe('approved'));

    await userEvent.click(await screen.findByRole('button', { name: '归档' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('页面保留服务端已确认状态');
    expect(current.status).toBe('approved');
    expect(
      within(screen.getByRole('list', { name: '财务记录' })).getByText(/已批准/),
    ).toBeInTheDocument();

    rejectArchive = false;
    await userEvent.click(screen.getByRole('button', { name: '归档' }));
    await waitFor(() => expect(current.status).toBe('archived'));
    expect(mockRequest).toHaveBeenCalledWith(
      '/finance/records/finance-1/transitions',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ to: 'submitted' }) }),
    );
  });
});
