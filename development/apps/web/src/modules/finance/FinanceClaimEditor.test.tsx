import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FinanceBudgetSummary, FinanceTrackingPayload } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { FinanceClaimEditor } from './FinanceClaimEditor.js';
import { FinanceWorkflowEditor } from './FinanceWorkflowEditor.js';

const balance = {
  allocatedCents: 100000,
  remainingCents: 0,
  departmentReviewCents: 100000,
  schoolReviewCents: 0,
  receivedCents: 0,
  overBudget: false,
};
const project: FinanceBudgetSummary = {
  id: 'pool',
  year: '2026-2027',
  departmentId: 'arts',
  code: '5-3-1',
  name: '活动物资',
  reimbursementCents: 100000,
  directPaymentCents: 0,
  notes: '',
  revision: 1,
  updatedAt: '2026-11-04T00:00:00Z',
  reimbursement: balance,
  directPayment: { ...balance, allocatedCents: 0, remainingCents: 0, departmentReviewCents: 0 },
};
function fixture(): FinanceTrackingPayload {
  return {
    configured: true,
    canManageBudget: false,
    ownerUid: null,
    departments: [{ id: 'arts', name: '文艺中心', portId: 'student_union' }],
    submittableDepartmentIds: ['arts'],
    projects: [
      project,
      {
        ...project,
        id: 'direct-only',
        code: '5-3-3',
        name: '酬金',
        reimbursementCents: 0,
        directPaymentCents: 200000,
        directPayment: {
          ...balance,
          allocatedCents: 200000,
          remainingCents: 200000,
          departmentReviewCents: 0,
        },
      },
    ],
    claims: [],
    settings: null,
  };
}
function setup(kind: 'reimbursement' | 'direct_payment' = 'reimbursement') {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const request = vi.fn().mockResolvedValue({ id: 'proof-file' });
  const client = {
    request,
    download: vi.fn().mockRejectedValue(new Error('not loaded in test')),
  } as unknown as ApiClient;
  render(
    <FinanceClaimEditor
      data={fixture()}
      kind={kind}
      client={client}
      pending={false}
      error={null}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );
  return { onSave, request, client };
}
describe('FinanceClaimEditor v2', () => {
  it('filters projects by the chosen channel, retains exhausted budgets, and permits incomplete drafts', async () => {
    const { onSave } = setup();
    const selector = screen.getByLabelText('预算项目');
    expect(within(selector).getByRole('option', { name: /活动物资/ })).toBeInTheDocument();
    expect(within(selector).queryByRole('option', { name: /酬金/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('购买数量')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'pool',
        payeeName: '',
        payeeStudentId: '',
        amountCents: 0,
        checklist: [],
      }),
    );
  });
  it('uses a single invoice amount for thresholds and repetition only for the claim total', async () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText('单张金额（元） 1'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('重复张数 1'), { target: { value: '40' } });
    expect(screen.getByText('¥20,000.00')).toBeInTheDocument();
    expect(screen.queryByLabelText(/超过1000元/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('购买类别 1'), 'distributed_goods');
    expect(screen.getByLabelText('下发物资已准备领用清单')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '复制发票 1' }));
    expect(screen.getByLabelText('单张金额（元） 2')).toHaveValue('500');
    expect(screen.getByText('¥40,000.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 4000000,
        invoiceLines: [
          { category: 'distributed_goods', amountCents: 50000, repeatCount: 40 },
          { category: 'distributed_goods', amountCents: 50000, repeatCount: 40 },
        ],
      }),
    );
  });
  it('warns above 5000 without blocking saving and exempts only venue from that warning', async () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText('单张金额（元） 1'), { target: { value: '6000' } });
    expect(screen.getByLabelText('超过1000元的发票已准备支付截图')).toBeInTheDocument();
    expect(
      screen.getByText(/单张金额超过5,000元，请先与团委辅导员确认开票及办理要求/),
    ).toBeInTheDocument();
    expect(screen.getByText(/可带预警提交辅导员审核/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 600000 }));
    await userEvent.selectOptions(screen.getByLabelText('购买类别 1'), 'venue');
    expect(screen.queryByText(/单张金额超过5,000元/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('超过1000元的发票已准备支付截图')).toBeInTheDocument();
  });
  it('shows only direct-payment projects and uploads work proof through the authenticated client', async () => {
    const { request, onSave } = setup('direct_payment');
    const selector = screen.getByLabelText('预算项目');
    expect(within(selector).getByRole('option', { name: /酬金/ })).toBeInTheDocument();
    expect(within(selector).queryByRole('option', { name: /活动物资/ })).not.toBeInTheDocument();
    expect(screen.queryByText('发票信息表')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('代发金额（元）'), { target: { value: '600' } });
    fireEvent.change(screen.getByLabelText('时薪（元/小时）'), { target: { value: '100' } });
    await userEvent.type(screen.getByLabelText('工作内容'), '活动摄影');
    await userEvent.upload(
      screen.getByLabelText(/工作证明图片/),
      new File(['image'], 'proof.png', { type: 'image/png' }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/finance/tracking/files/work-proof',
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'direct_payment',
        projectId: 'direct-only',
        amountCents: 60000,
        directPayment: {
          hourlyRateCents: 10000,
          workContent: '活动摄影',
          proofFileIds: ['proof-file'],
        },
      }),
    );
  });
  it('saves the port-specific names and employee numbers without changing identity assignments', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <FinanceWorkflowEditor
        data={fixture()}
        client={{ request: vi.fn() } as unknown as ApiClient}
        pending={false}
        error={null}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    await userEvent.type(screen.getByLabelText('经费负责人姓名'), '经费同学');
    await userEvent.type(screen.getByLabelText('经费负责人工作证号'), 'F001');
    await userEvent.type(screen.getByLabelText('辅导员 1姓名'), '负责辅导员');
    await userEvent.type(screen.getByLabelText('辅导员 1工作证号'), 'C001');
    expect(screen.queryByLabelText('工作口负责人姓名')).not.toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText('报销准备步骤（每行一项）'),
      '已核对学校报销单\n已授权经费负责人',
    );
    await userEvent.click(screen.getByRole('button', { name: '保存办理配置' }));
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({
        portId: 'youth_league',
        financeOfficer: { name: '经费同学', employeeNumber: 'F001' },
        counselors: [{ name: '负责辅导员', employeeNumber: 'C001' }],
        reimbursementSteps: ['已核对学校报销单', '已授权经费负责人'],
      }),
    ]);
  });
});
