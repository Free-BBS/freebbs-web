import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinancePage } from './FinancePage';

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));

vi.mock('../../core/api/client.js', () => ({
  createApiClient: () => ({
    request: (path: string, init?: RequestInit) =>
      path === '/notifications/organizations'
        ? Promise.resolve({ organizations: [] })
        : mockRequest(path.split('?')[0], init),
  }),
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
  roles: ['counselor.youth_league' as const],
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
      action: 'finance.record.review',
      resource: 'finance_record',
      effect: 'allow' as const,
    },
  ],
};

describe('FinancePage', () => {
  it('uses organization grants for activity-linked creation, editing and review', async () => {
    const linked = {
      ...existingRecord,
      status: 'draft',
      organizationId: 'sports_center',
      activityId: 'activity-match',
      scope: { type: 'activity', id: 'activity-match' },
    };
    let record = linked;
    let reviewRecord = {
      ...linked,
      id: 'finance-review',
      title: '关联活动结算',
      status: 'submitted',
    };
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/finance/records' && !init) return [record, reviewRecord];
      if (path === '/finance/records' && init?.method === 'PATCH')
        return (record = { ...record, ...JSON.parse(String(init.body)) });
      if (path === '/finance/records' && init?.method === 'POST')
        return { ...record, ...JSON.parse(String(init.body)), id: 'created' };
      if (path === '/finance/records/finance-review/reviews')
        return (reviewRecord = { ...reviewRecord, status: 'approved' });
      throw new Error(path);
    });
    render(
      <FinancePage
        user={{
          ...financeLead,
          roles: ['counselor.youth_league'],
          policies: [
            {
              action: 'finance.*',
              resource: '*',
              effect: 'allow',
              scope: { type: 'social_organization', id: 'sports_center' },
            },
          ],
        }}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: `编辑 ${linked.title}` }));
    await userEvent.clear(screen.getByLabelText('编辑金额（元）'));
    await userEvent.type(screen.getByLabelText('编辑金额（元）'), '750.50');
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await screen.findByText('财务草稿已更新');
    await userEvent.type(screen.getByLabelText('记录标题'), '比赛活动预算');
    await userEvent.type(screen.getByLabelText('关联活动 ID（可选）'), 'activity-match');
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText('财务草稿已创建');
    expect(mockRequest).toHaveBeenCalledWith(
      '/finance/records',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"organizationId":"sports_center"'),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: '批准' }));
    await screen.findByText('财务记录已批准');
    expect(mockRequest).toHaveBeenCalledWith(
      '/finance/records/finance-review/reviews',
      expect.objectContaining({ method: 'POST' }),
    );
  });
  it('does not show global editing to a scoped administrator without finance grants', async () => {
    mockRequest.mockResolvedValueOnce([{ ...existingRecord, status: 'draft' }]);
    render(
      <FinancePage
        user={{ ...financeLead, roles: ['platform.admin'], businessAdmin: false, policies: [] }}
      />,
    );
    await screen.findByText(existingRecord.title);
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `编辑 ${existingRecord.title}` }),
    ).not.toBeInTheDocument();
  });
  it.each(['counselor.youth_league_secretary', 'counselor.youth_league'] as const)(
    'lets %s choose organizations and edit their finance records with effective grants',
    async (role) => {
      const record = {
        ...existingRecord,
        status: 'draft',
        organizationId: 'sports_center',
        scope: { type: 'social_organization', id: 'sports_center' },
      };
      mockRequest.mockResolvedValueOnce([record]);
      render(
        <FinancePage
          user={{
            ...financeLead,
            roles: [role],
            policies: [
              ...financeLead.policies,
              { action: 'finance.record.read', resource: 'finance_record', effect: 'allow' },
            ],
          }}
        />,
      );
      await screen.findByText(record.title);
      const organizations = screen.getByLabelText('组织');
      expect(within(organizations).getByRole('option', { name: '体育中心' })).toBeInTheDocument();
      expect(within(organizations).getByRole('option', { name: '文艺中心' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: `编辑 ${record.title}` }));
      expect(screen.getByRole('button', { name: '保存修改' })).toBeInTheDocument();
    },
  );
  it('gives platform administrators finance creation and review controls without policy fixtures', async () => {
    mockRequest.mockResolvedValueOnce([existingRecord]);
    render(
      <FinancePage
        user={{ ...financeLead, roles: ['platform.admin'], businessAdmin: true, policies: [] }}
      />,
    );
    await screen.findByText(existingRecord.title);
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument();
  });
  it('does not grant lead-only finance controls from a legacy global policy', async () => {
    mockRequest.mockResolvedValueOnce([existingRecord]);
    render(
      <FinancePage
        user={{
          ...financeLead,
          roles: ['platform.super_admin'],
          policies: [{ action: '*', resource: '*', effect: 'allow' }],
        }}
      />,
    );
    await screen.findByText(existingRecord.title);
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批准' })).not.toBeInTheDocument();
  });
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
    mockRequest.mockResolvedValue([existingRecord]);

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

  it('does not substitute record metadata for organization authorization', async () => {
    const scopedUser = {
      ...financeLead,
      policies: [
        {
          id: 'allow-organization-a',
          action: 'finance.record.create',
          resource: 'finance_record',
          effect: 'allow' as const,
          scope: { type: 'social_organization', id: 'arts_center' },
        },
        {
          id: 'allow-organization-b',
          action: 'finance.record.create',
          resource: 'finance_record',
          effect: 'allow' as const,
          scope: { type: 'social_organization', id: 'sports_center' },
        },
        {
          id: 'deny-organization-b',
          action: 'finance.record.create',
          resource: 'finance_record',
          effect: 'deny' as const,
          scope: { type: 'social_organization', id: 'sports_center' },
        },
      ],
    };
    mockRequest.mockResolvedValueOnce([]);
    render(<FinancePage user={scopedUser} />);

    expect(await screen.findByText('暂无财务记录')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: '保存草稿' });
    expect(submit).toBeDisabled();

    // A record label or linked activity cannot substitute for organization access.
    await userEvent.clear(screen.getByLabelText('范围类型'));
    await userEvent.type(screen.getByLabelText('范围类型'), 'social_organization');
    await userEvent.clear(screen.getByLabelText('范围标识'));
    await userEvent.type(screen.getByLabelText('范围标识'), 'arts_center');
    expect(submit).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('范围标识'));
    await userEvent.type(screen.getByLabelText('范围标识'), 'sports_center');
    expect(submit).toBeDisabled();
  });

  it('applies organization-specific deny precedence when choosing a finance organization', async () => {
    mockRequest.mockResolvedValueOnce([]);
    render(
      <FinancePage
        user={{
          ...financeLead,
          roles: ['counselor.youth_league'],
          policies: [
            { action: 'finance.*', resource: '*', effect: 'allow' },
            {
              action: 'finance.record.create',
              resource: 'finance_record',
              effect: 'deny',
              scope: { type: 'social_organization', id: 'sports_center' },
            },
          ],
        }}
      />,
    );
    await screen.findByText('暂无财务记录');
    fireEvent.change(screen.getByLabelText('组织'), { target: { value: 'arts_center' } });
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('组织'), { target: { value: 'sports_center' } });
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
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
      if (
        path === `/finance/records/${current.id}/transitions` ||
        path === `/finance/records/${current.id}/reviews`
      ) {
        const parsed = JSON.parse(String(init?.body)) as { to?: Status; decision?: Status };
        const body = { to: (parsed.to ?? parsed.decision)! };
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
