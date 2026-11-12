import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { financeClaimChecklist } from '@freebbs-development/contracts';
import type {
  FinanceBudgetSummary,
  FinanceClaimView,
  FinanceImportPreview,
  FinanceTrackingPayload,
  UserContext,
} from '@freebbs-development/contracts';

import type { ApiClient } from '../../core/api/client.js';
import { FinanceWorkspace } from './FinanceWorkspace.js';

const project: FinanceBudgetSummary = {
  id: 'project-1',
  year: '2026-2027',
  departmentId: 'practice',
  code: '2-1-1',
  name: '暑期实践',
  reimbursementCents: 100000,
  directPaymentCents: 50000,
  notes: '同一编号下的条目统一核算',
  revision: 2,
  updatedAt: '2026-10-23T02:00:00Z',
  reimbursement: {
    allocatedCents: 100000,
    departmentReviewCents: 20000,
    schoolReviewCents: 30000,
    receivedCents: 10000,
    remainingCents: 40000,
    overBudget: false,
  },
  directPayment: {
    allocatedCents: 50000,
    departmentReviewCents: 0,
    schoolReviewCents: 0,
    receivedCents: 0,
    remainingCents: 50000,
    overBudget: false,
  },
};
const claim: FinanceClaimView = {
  id: 'claim-1',
  projectId: 'project-1',
  departmentId: 'practice',
  kind: 'reimbursement',
  items: [{ description: '实践手册', quantity: '20 本' }],
  amountCents: 20000,
  payeeName: '测试同学',
  payeeStudentId: '2026000001',
  materials: ['发票 1 张', '物品明细'],
  externalReference: '校财务单号 001',
  externalSubmittedAt: '2026-10-23',
  notes: '',
  status: 'department_review',
  submitterUid: 'department-user',
  submitterDisplayName: '实践负责人',
  revision: 3,
  createdAt: '2026-10-23T02:00:00Z',
  updatedAt: '2026-10-23T02:00:00Z',
  schoolSubmittedAt: null,
  teacherApprovedAt: null,
  history: [
    {
      action: 'submit',
      from: 'draft',
      to: 'department_review',
      at: '2026-10-23T02:00:00Z',
      actorUid: 'department-user',
      actorDisplayName: '实践负责人',
      note: '已授权工作口经费负责人',
    },
  ],
  allowedActions: [],
  canEdit: false,
};
const user: UserContext = {
  uid: 'department-user',
  displayName: '实践负责人',
  avatarUrl: null,
  baseRole: 'student',
  roles: ['platform.admin'],
  tags: [],
};
function fixture(overrides: Partial<FinanceTrackingPayload> = {}): FinanceTrackingPayload {
  return {
    configured: true,
    ownerUid: null,
    canManageBudget: false,
    departments: [{ id: 'practice', name: '实践组', portId: 'youth_league' }],
    submittableDepartmentIds: ['practice'],
    projects: [project],
    claims: [claim],
    settings: null,
    ...overrides,
  };
}
function cascadeFixture(): FinanceTrackingPayload {
  const projects = [
    project,
    { ...project, id: 'practice-exhibition', name: '实践成果展', code: '2-1-2' },
    { ...project, id: 'office-project', departmentId: 'office', name: '迎新活动', code: '2-2-1' },
    { ...project, id: 'rights-project', departmentId: 'rights', name: '权益服务', code: '3-1-1' },
    {
      ...project,
      id: 'football-project',
      departmentId: 'football',
      name: '代表队训练',
      code: '6-1-1',
    },
  ];
  return fixture({
    departments: [
      { id: 'practice', name: '实践组', portId: 'youth_league' },
      { id: 'office', name: '办公室·新生组', portId: 'youth_league' },
      { id: 'rights', name: '权益发展中心', portId: 'student_union' },
      { id: 'football', name: '足球代表队', portId: 'sports' },
    ],
    projects,
    claims: projects.map((project) => ({
      ...claim,
      id: `claim-${project.id}`,
      departmentId: project.departmentId,
      projectId: project.id,
      items: [{ description: `${project.name}物料`, quantity: '1 项' }],
    })),
    submittableDepartmentIds: ['practice', 'office', 'football'],
  });
}
function setup(data: FinanceTrackingPayload, page: 'budget' | 'claims' = 'budget') {
  const request = vi.fn().mockResolvedValue(data);
  const client = { request } as unknown as ApiClient;
  const view = render(
    <MemoryRouter>
      <FinanceWorkspace page={page} client={client} user={user} />
    </MemoryRouter>,
  );
  return { ...view, request, client };
}

describe('FinanceWorkspace', () => {
  it.each(['budget', 'claims'] as const)(
    'cascades authorized organization, department and project filters on the %s page and clears stale selections',
    async (page) => {
      setup(cascadeFixture(), page);
      await screen.findAllByRole('article');
      const organization = screen.getByLabelText('组织');
      const department = screen.getByLabelText('部门');
      const project = screen.getByLabelText('项目');
      expect(
        within(organization).queryByRole('option', { name: '媒体中心' }),
      ).not.toBeInTheDocument();
      await userEvent.selectOptions(organization, 'youth_league');
      expect(screen.getAllByRole('article')).toHaveLength(3);
      expect(
        within(department).queryByRole('option', { name: '足球代表队' }),
      ).not.toBeInTheDocument();
      expect(within(project).queryByRole('option', { name: /权益服务/ })).not.toBeInTheDocument();
      await userEvent.selectOptions(department, 'practice');
      expect(screen.getAllByRole('article')).toHaveLength(2);
      expect(within(project).queryByRole('option', { name: /迎新活动/ })).not.toBeInTheDocument();
      await userEvent.selectOptions(project, 'practice-exhibition');
      expect(screen.getAllByRole('article')).toHaveLength(1);
      expect(screen.getByRole('article')).toHaveTextContent('实践成果展');
      await userEvent.selectOptions(organization, 'sports');
      expect(department).toHaveValue('');
      expect(project).toHaveValue('');
      expect(screen.getByRole('article')).toHaveTextContent('代表队训练');
      expect(within(department).queryByRole('option', { name: '实践组' })).not.toBeInTheDocument();
      await userEvent.selectOptions(organization, 'student_union');
      expect(screen.getByRole('article')).toHaveTextContent('权益服务');
      expect(within(department).getByRole('option', { name: '权益发展中心' })).toBeInTheDocument();
    },
  );

  it('limits draft organization and department choices to submitting grants and resets the selected project on ancestor changes', async () => {
    setup(cascadeFixture(), 'claims');
    await userEvent.click(await screen.findByRole('button', { name: '新增报销' }));
    const dialog = screen.getByRole('dialog', { name: '新增报销' });
    const organization = within(dialog).getByLabelText('所属组织');
    const department = within(dialog).getByLabelText('所属部门');
    const project = within(dialog).getByLabelText('预算项目');
    expect(within(organization).queryByRole('option', { name: '学生会' })).not.toBeInTheDocument();
    expect(within(project).getByRole('option', { name: /2-1-1 暑期实践/ })).toBeInTheDocument();
    await userEvent.selectOptions(organization, 'sports');
    expect(department).toHaveValue('');
    expect(project).toHaveValue('');
    expect(within(department).queryByRole('option', { name: '实践组' })).not.toBeInTheDocument();
    await userEvent.selectOptions(department, 'football');
    expect(project).toHaveValue('');
    await userEvent.selectOptions(project, 'football-project');
    await userEvent.selectOptions(organization, 'youth_league');
    expect(project).toHaveValue('');
    await userEvent.selectOptions(department, 'office');
    expect(within(project).getByRole('option', { name: /2-2-1 迎新活动/ })).toBeInTheDocument();
    expect(
      within(project).queryByRole('option', { name: /代表队训练|权益服务/ }),
    ).not.toBeInTheDocument();
  });

  it('filters the manual budget entry department list by organization and requires choosing a department again after switching', async () => {
    setup({ ...cascadeFixture(), canManageBudget: true });
    await userEvent.click(await screen.findByRole('button', { name: '录入项目预算' }));
    const dialog = screen.getByRole('dialog', { name: '录入项目预算' });
    await userEvent.selectOptions(within(dialog).getByLabelText('所属组织'), 'sports');
    const department = within(dialog).getByLabelText('所属部门');
    expect(department).toHaveValue('');
    expect(within(department).getByRole('option', { name: '足球代表队' })).toBeInTheDocument();
    expect(within(department).queryByRole('option', { name: '实践组' })).not.toBeInTheDocument();
  });
  it('presents two linked pages and separate project reimbursement/direct-payment balances without personal IDs', async () => {
    setup(fixture());
    const table = await screen.findByRole('table', { name: '暑期实践 分项余额' });
    expect(screen.getByRole('link', { name: '总预算表' })).toHaveAttribute(
      'href',
      '/finance/budget',
    );
    expect(screen.getByRole('link', { name: '报销与代发进度' })).toHaveAttribute(
      'href',
      '/finance/claims',
    );
    const reimbursement = within(table).getByRole('row', { name: /报销/ });
    expect(within(reimbursement).getByText('¥400.00')).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /代发/ })).toHaveTextContent('¥500.00');
    expect(screen.queryByText(claim.payeeStudentId)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '录入项目预算' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '预算目录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导入 Excel' })).not.toBeInTheDocument();
  });

  it('defaults to the newest year and flags negative project balances', async () => {
    setup(
      fixture({
        projects: [
          { ...project, id: 'older', year: '2025-2026', name: '旧预算' },
          {
            ...project,
            reimbursement: { ...project.reimbursement, remainingCents: -3000, overBudget: true },
          },
        ],
      }),
    );
    await screen.findByText('超出预算');
    expect(screen.getByLabelText('预算年度')).toHaveValue('2026-2027');
    expect(screen.queryByText('旧预算')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('-¥30.00');
  });

  it('fails closed when not configured or unassigned', async () => {
    const { unmount } = setup(
      fixture({ configured: false, departments: [], projects: [], claims: [] }),
    );
    await screen.findByText('财务系统尚未启用');
    expect(screen.queryByRole('button', { name: '录入项目预算' })).not.toBeInTheDocument();
    unmount();
    setup(fixture({ departments: [], projects: [], claims: [], submittableDepartmentIds: [] }));
    await screen.findByText('暂未分配财务查看权限');
    expect(screen.queryByRole('button', { name: '新增报销' })).not.toBeInTheDocument();
  });

  it('creates repeated-invoice drafts with exact cents and a stable retry identifier, without purchase quantities', async () => {
    const { request } = setup(fixture(), 'claims');
    await userEvent.click(await screen.findByRole('button', { name: '新增报销' }));
    const dialog = screen.getByRole('dialog', { name: '新增报销' });
    expect(within(dialog).queryByLabelText(/垫款人/)).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('单张金额（元） 1'), '0.29');
    await userEvent.clear(within(dialog).getByLabelText('重复张数 1'));
    await userEvent.type(within(dialog).getByLabelText('重复张数 1'), '3');
    await userEvent.type(within(dialog).getByLabelText('收款人姓名'), '测试同学');
    await userEvent.type(within(dialog).getByLabelText('收款人学号'), '2026000002');
    expect(within(dialog).queryByLabelText('购买数量')).not.toBeInTheDocument();
    expect(dialog.querySelector('input[type="file"]')).toBeNull();
    request.mockRejectedValueOnce(new Error('网络中断，请重试'));
    await userEvent.click(within(dialog).getByRole('button', { name: '保存草稿' }));
    await screen.findByText('网络中断，请重试');
    const firstBody = JSON.parse(request.mock.calls[1][1].body);
    expect(firstBody).toMatchObject({
      projectId: project.id,
      amountCents: 87,
      payeeName: '测试同学',
      payeeStudentId: '2026000002',
      externalSubmittedAt: '',
      items: [],
      materials: [],
      invoiceLines: [{ category: 'activity_materials', amountCents: 29, repeatCount: 3 }],
    });
    expect(firstBody).not.toHaveProperty('payerName');
    expect(firstBody).not.toHaveProperty('payerStudentId');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存草稿' }));
    await screen.findByText('草稿已保存，可在详情中提交辅导员审核');
    expect(JSON.parse(request.mock.calls[2][1].body).requestId).toBe(firstBody.requestId);
  });

  it('does not truncate fractions of a cent when recording a draft', async () => {
    const { request } = setup(fixture(), 'claims');
    await userEvent.click(await screen.findByRole('button', { name: '新增报销' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('单张金额（元） 1'), {
      target: { value: '1.005' },
    });
    fireEvent.submit(dialog.querySelector('form')!);
    await screen.findByText('金额最多保留两位小数');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('shows only server-permitted actions and requires an explicit receipt confirmation', async () => {
    const payable = {
      ...claim,
      status: 'school_review' as const,
      allowedActions: ['confirm_received' as const],
    };
    const { request } = setup(fixture({ claims: [payable] }), 'claims');
    await userEvent.click(await screen.findByRole('button', { name: '详情与办理' }));
    expect(screen.queryByRole('button', { name: '同意初审' })).not.toBeInTheDocument();
    expect(screen.getByText(claim.payeeStudentId, { exact: false })).toBeInTheDocument();
    expect(screen.getByText('已授权工作口经费负责人')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确认收到款项' }));
    const dialog = screen.getByRole('dialog', { name: '确认收到款项' });
    await userEvent.click(within(dialog).getByRole('button', { name: '确认收到款项' }));
    await screen.findByText('请先勾选确认项');
    expect(request).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByLabelText('已核实本笔款项实际到账'));
    await userEvent.click(within(dialog).getByRole('button', { name: '确认收到款项' }));
    await screen.findByText('办理进度已更新');
    expect(request).toHaveBeenLastCalledWith(
      '/finance/tracking/claims/claim-1/actions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ revision: 3, action: 'confirm_received', note: '' }),
      }),
    );
  });

  it.each([
    {
      kind: 'reimbursement' as const,
      action: '确认进入校财务流程',
      status: '校财务流程中',
      confirmation: '已完成本笔款项对应的财务办理操作',
    },
    {
      kind: 'direct_payment' as const,
      action: '确认进入系学生组审核',
      status: '系学生组审核中',
      confirmation: '已确认本笔代发进入系学生组审核中',
    },
  ])(
    'uses the correct next-stage instructions and status for $kind',
    async ({ kind, action, status, confirmation }) => {
      const ready: FinanceClaimView = {
        ...claim,
        kind,
        status: 'initial_approved',
        allowedActions: ['record_school_submission'],
        ...(kind === 'direct_payment'
          ? { directPayment: { hourlyRateCents: 10000, workContent: '活动摄影', proofFileIds: [] } }
          : {}),
      };
      const { request } = setup(fixture({ claims: [ready] }), 'claims');
      await userEvent.click(await screen.findByRole('button', { name: '详情与办理' }));
      await userEvent.click(screen.getByRole('button', { name: action }));
      const dialog = screen.getByRole('dialog', { name: action });
      if (kind === 'direct_payment') {
        expect(dialog).toHaveTextContent('确认本笔代发已进入系学生组审核中；无需录入学校报销单。');
        expect(dialog).not.toHaveTextContent('请在学校财务系统完成对应审核');
      } else expect(dialog).toHaveTextContent('请在学校财务系统完成对应审核后');
      await userEvent.click(within(dialog).getByRole('button', { name: action }));
      expect(await screen.findByText('请先勾选确认项')).toBeInTheDocument();
      expect(request).toHaveBeenCalledTimes(1);
      await userEvent.click(within(dialog).getByLabelText(confirmation));
      request.mockResolvedValueOnce(
        fixture({ claims: [{ ...ready, status: 'school_review', allowedActions: [] }] }),
      );
      await userEvent.click(within(dialog).getByRole('button', { name: action }));
      await screen.findByText('办理进度已更新');
      expect(screen.getByRole('article')).toHaveTextContent(status);
      expect(request).toHaveBeenLastCalledWith(
        '/finance/tracking/claims/claim-1/actions',
        expect.objectContaining({
          body: JSON.stringify({ revision: 3, action: 'record_school_submission', note: '' }),
        }),
      );
    },
  );

  it('allows a final reviewer to edit budget metadata while discarding legacy finance personnel grants', async () => {
    const data = fixture({
      canManageBudget: true,
      settings: {
        revision: 4,
        departments: [{ id: 'practice', name: '实践组', portId: 'youth_league' }],
        grants: [
          {
            uid: 'legacy-finance-user',
            displayName: '旧财务人员',
            role: 'department',
            departmentIds: ['practice'],
            portIds: [],
          },
        ],
      },
    });
    const { request } = setup(data);
    await userEvent.click(await screen.findByRole('button', { name: '编辑预算 暑期实践' }));
    const dialog = screen.getByRole('dialog', { name: '调整项目预算' });
    fireEvent.change(within(dialog).getByLabelText('报销批准额度（元）'), {
      target: { value: '1800.36' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: '保存预算' }));
    await screen.findByText('项目预算已保存');
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
      revision: 2,
      reimbursementCents: 180036,
      directPaymentCents: 50000,
    });
    await userEvent.click(screen.getByRole('button', { name: '预算目录' }));
    const directory = screen.getByRole('dialog', { name: '预算目录' });
    expect(directory).toHaveTextContent('人员与岗位在管理员端统一维护');
    expect(within(directory).queryByLabelText(/用户 UID|姓名|职责/)).not.toBeInTheDocument();
    expect(within(directory).queryByText('旧财务人员')).not.toBeInTheDocument();
    expect(within(directory).getByRole('link', { name: '前往管理员端' })).toHaveAttribute(
      'href',
      '/system-settings',
    );
    await userEvent.clear(within(directory).getByLabelText('部门名称 1'));
    await userEvent.type(within(directory).getByLabelText('部门名称 1'), '实践组新名称');
    await userEvent.click(within(directory).getByRole('button', { name: '保存预算目录' }));
    await screen.findByText('预算目录已更新');
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({
      revision: 4,
      departments: [{ id: 'practice', name: '实践组新名称', portId: 'youth_league' }],
      grants: [],
    });
  });

  it('updates the final reviewer budget view only after the Excel preview is explicitly committed', async () => {
    const { request } = setup(fixture({ canManageBudget: true }));
    await userEvent.click(await screen.findByRole('button', { name: '导入 Excel' }));
    await userEvent.upload(
      screen.getByLabelText('预算 Excel 文件'),
      new File(['xlsx'], '预算.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    const importedProject = { ...project, id: 'imported-project', name: '导入后的活动预算' };
    const preview: FinanceImportPreview = {
      previewId: 'import-preview',
      fileName: '预算.xlsx',
      year: '2026-2027',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      canCommit: true,
      issues: [],
      unknownDepartments: [],
      entries: [
        {
          ...importedProject,
          departmentName: '实践组',
          portId: 'youth_league',
          action: 'create',
          sourceRows: [{ sheet: '预算', row: 2 }],
        },
      ],
    };
    request.mockResolvedValueOnce(preview);
    // Native file-required validation cannot see jsdom's synthetic FileList.
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await screen.findByRole('button', { name: '确认导入预算' });
    expect(screen.getByRole('table', { name: '暑期实践 分项余额' })).toBeInTheDocument();
    expect(
      screen.queryByRole('table', { name: '导入后的活动预算 分项余额' }),
    ).not.toBeInTheDocument();
    request.mockResolvedValueOnce({
      workspace: fixture({ canManageBudget: true, projects: [importedProject] }),
      summary: { created: 1, updated: 0, unchanged: 0 },
    });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await screen.findByRole('table', { name: '导入后的活动预算 分项余额' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '预算已导入：新增 1 项，更新 0 项，无变更 0 项',
    );
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ previewId: 'import-preview' });
  });

  it('lets a read-only work-port viewer inspect progress without draft, review or editing actions', async () => {
    setup(
      fixture({
        submittableDepartmentIds: [],
        claims: [{ ...claim, allowedActions: [], canEdit: false }],
      }),
      'claims',
    );
    await screen.findByRole('button', { name: '详情与办理' });
    expect(screen.queryByRole('button', { name: '新增报销' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '预算目录' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '详情与办理' }));
    expect(screen.getByRole('dialog', { name: '款项详情与办理记录' })).toHaveTextContent(
      '实践手册',
    );
    for (const name of ['编辑草稿', '提交辅导员审核', '同意初审', '确认收到款项']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('preserves a date-only external submission value without inventing a submission time', async () => {
    setup(fixture(), 'claims');
    await userEvent.click(await screen.findByRole('button', { name: '详情与办理' }));
    const dialog = screen.getByRole('dialog', { name: '款项详情与办理记录' });
    const dateValue = within(dialog).getByText('外部提交时间').nextElementSibling;
    expect(dateValue).toHaveTextContent(/^2026-10-23$/);
    expect(dateValue).not.toHaveTextContent(':');
    expect(dialog.querySelector('time[datetime="2026-10-23T02:00:00Z"]')).toHaveTextContent(
      /\d{2}:\d{2}/,
    );
  });

  it('shows the most recently handled claim first even when it was created earlier', async () => {
    setup(
      fixture({
        claims: [
          {
            ...claim,
            id: 'newly-created',
            items: [{ description: '较早更新的款项', quantity: '1 项' }],
            createdAt: '2026-10-23T03:00:00Z',
            updatedAt: '2026-10-23T03:00:00Z',
          },
          {
            ...claim,
            id: 'recently-handled',
            items: [{ description: '最近办理的款项', quantity: '1 项' }],
            createdAt: '2026-10-22T02:00:00Z',
            updatedAt: '2026-10-23T04:00:00Z',
          },
        ],
      }),
      'claims',
    );
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('最近办理的款项');
    expect(cards[1]).toHaveTextContent('较早更新的款项');
  });

  it('preserves the shared representative-team binding while editing directory metadata', async () => {
    const teamDepartment = {
      id: 'football',
      name: '足球代表队',
      portId: 'sports' as const,
      teamId: 'shared-football-team',
    };
    const { request } = setup(
      fixture({
        canManageBudget: true,
        departments: [teamDepartment],
        settings: { revision: 1, departments: [teamDepartment], grants: [] },
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: '预算目录' }));
    expect(screen.queryByRole('button', { name: '＋ 添加负责人' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('部门标识 1')).toHaveAttribute('readonly');
    await userEvent.clear(screen.getByLabelText('部门名称 1'));
    await userEvent.type(screen.getByLabelText('部门名称 1'), '电子足球代表队');
    await userEvent.click(screen.getByRole('button', { name: '保存预算目录' }));
    await screen.findByText('预算目录已更新');
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
      revision: 1,
      departments: [{ ...teamDepartment, name: '电子足球代表队' }],
      grants: [],
    });
  });

  it('removes previous financial data as identity changes and ignores stale requests', async () => {
    const { rerender, request, client } = setup(fixture());
    await screen.findByRole('table', { name: '暑期实践 分项余额' });
    request.mockResolvedValueOnce(
      fixture({ departments: [], projects: [], claims: [], submittableDepartmentIds: [] }),
    );
    rerender(
      <MemoryRouter>
        <FinanceWorkspace page="budget" client={client} user={{ ...user, uid: 'other-user' }} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument());
    await screen.findByText('暂未分配财务查看权限');
  });

  it('preserves an exclusive reviewer when an ordinary budget manager edits the directory', async () => {
    const department = {
      id: 'department_common.rooms',
      name: '系用房',
      portId: 'department_common' as const,
      reviewPolicy: { reviewerUids: ['u-room-reviewer'] },
    };
    const { request } = setup(
      fixture({
        canManageBudget: true,
        canManageReviewPolicies: false,
        departments: [department],
        settings: { revision: 3, departments: [department], grants: [] },
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: '预算目录' }));
    expect(screen.queryByLabelText(/指定审核人 UID/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存预算目录' }));
    await screen.findByText('预算目录已更新');
    expect(JSON.parse(request.mock.calls[1][1].body).departments).toEqual([department]);
  });

  it('lets the highest administrator type a reviewer list without losing separators', async () => {
    const department = {
      id: 'department_common.rooms',
      name: '系用房',
      portId: 'department_common' as const,
    };
    const { request } = setup(
      fixture({
        canManageBudget: true,
        canManageReviewPolicies: true,
        departments: [department],
        settings: { revision: 3, departments: [department], grants: [] },
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: '预算目录' }));
    await userEvent.click(screen.getByText('审核权限：通用审核'));
    await userEvent.type(screen.getByLabelText(/指定审核人 UID/), 'u-one, u-two');
    expect(screen.getByLabelText(/指定审核人 UID/)).toHaveValue('u-one, u-two');
    await userEvent.click(screen.getByRole('button', { name: '保存预算目录' }));
    await screen.findByText('预算目录已更新');
    expect(JSON.parse(request.mock.calls[1][1].body).departments).toEqual([
      { ...department, reviewPolicy: { reviewerUids: ['u-one', 'u-two'] } },
    ]);
  });

  it('requires all checklist items and submits their saved revision before requesting counselor review', async () => {
    const draft: FinanceClaimView = {
      ...claim,
      status: 'draft',
      canEdit: true,
      allowedActions: ['submit'],
      invoiceLines: [{ category: 'venue', amountCents: 20000, repeatCount: 1 }],
      checklist: [],
    };
    const { request } = setup(fixture({ claims: [draft] }), 'claims');
    await userEvent.click(await screen.findByRole('button', { name: '详情与办理' }));
    await userEvent.click(screen.getByRole('button', { name: '提交辅导员审核' }));
    const dialog = screen.getByRole('dialog', { name: '提交辅导员审核' });
    await userEvent.click(within(dialog).getByRole('button', { name: '提交辅导员审核' }));
    expect(await screen.findByText('请完成全部材料与办理确认项')).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
    const requirements = financeClaimChecklist(draft);
    for (const item of requirements)
      await userEvent.click(within(dialog).getByLabelText(item.label));
    const checked = requirements.map((item) => item.key);
    request.mockResolvedValueOnce(
      fixture({ claims: [{ ...draft, checklist: checked, revision: 4 }] }),
    );
    request.mockResolvedValueOnce(
      fixture({
        claims: [{ ...draft, checklist: checked, revision: 5, status: 'department_review' }],
      }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: '提交辅导员审核' }));
    await screen.findByText('办理进度已更新');
    expect(request.mock.calls[1][0]).toBe('/finance/tracking/claims/claim-1');
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
      revision: 3,
      checklist: checked,
    });
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({
      revision: 4,
      action: 'submit',
      note: '',
    });
  });

  it('filters historical member claims through the combined pool and does not offer editing its summed allowance', async () => {
    const pool = {
      ...project,
      name: '部门建设',
      code: '5-4',
      memberProjectIds: ['source-a', 'source-b'],
    };
    const budget = setup(fixture({ projects: [pool], canManageBudget: true }));
    await screen.findByRole('table', { name: '部门建设 分项余额' });
    expect(screen.queryByRole('button', { name: '编辑预算 部门建设' })).not.toBeInTheDocument();
    budget.unmount();
    setup(
      fixture({
        projects: [pool],
        claims: [
          { ...claim, id: 'a', projectId: 'source-a' },
          { ...claim, id: 'b', projectId: 'source-b' },
        ],
      }),
      'claims',
    );
    await screen.findAllByRole('article');
    await userEvent.selectOptions(screen.getByLabelText('项目'), pool.id);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getAllByRole('article')[1]).toHaveTextContent('5-4 部门建设');
  });

  it('keeps legacy submission timestamps separate from counselor confirmation of school finance', async () => {
    const legacy: FinanceClaimView = {
      ...claim,
      status: 'initial_approved',
      workflowVersion: 2,
      schoolSubmittedAt: '2026-10-23T03:00:00Z',
      counselorFinancialApprovedAt: null,
      history: [
        ...claim.history,
        {
          action: 'approve',
          from: 'department_review',
          to: 'school_review',
          at: '2026-10-23T02:30:00Z',
          actorUid: 'reviewer',
          actorDisplayName: '辅导员',
          note: '',
        },
        {
          action: 'record_school_submission',
          from: 'school_review',
          to: 'school_review',
          at: '2026-10-23T03:00:00Z',
          actorUid: 'officer',
          actorDisplayName: '经费负责人',
          note: '',
        },
      ],
    };
    setup(fixture({ claims: [legacy] }), 'claims');
    await userEvent.click(await screen.findByRole('button', { name: '详情与办理' }));
    const dialog = screen.getByRole('dialog', { name: '款项详情与办理记录' });
    expect(within(dialog).getByText('辅导员确认财务办理').nextElementSibling).toHaveTextContent(
      '尚未确认',
    );
    expect(within(dialog).getByText('旧版校财务提交记录').nextElementSibling).not.toHaveTextContent(
      '尚未确认',
    );
    expect(within(dialog).getByText('经费负责人提交记录（旧版）')).toBeInTheDocument();
    expect(within(dialog).queryByText('确认进入校财务流程')).not.toBeInTheDocument();
    expect(within(dialog).getByText('辅导员 · 系内初审已通过（旧版记录）')).toBeInTheDocument();
  });

  it('saves a new application, opens its material review directly, and waits for explicit final submission', async () => {
    const { request } = setup(fixture(), 'claims');
    await userEvent.click(await screen.findByRole('button', { name: '新增报销' }));
    let dialog = screen.getByRole('dialog', { name: '新增报销' });
    fireEvent.change(within(dialog).getByLabelText('单张金额（元） 1'), {
      target: { value: '200' },
    });
    await userEvent.type(within(dialog).getByLabelText('收款人姓名'), '测试同学');
    await userEvent.type(within(dialog).getByLabelText('收款人学号'), '2026000001');
    const draft: FinanceClaimView = {
      ...claim,
      id: 'created-claim',
      status: 'draft',
      revision: 1,
      allowedActions: ['submit'],
      canEdit: true,
      checklist: [],
      invoiceLines: [{ category: 'activity_materials', amountCents: 20000, repeatCount: 1 }],
    };
    request.mockResolvedValueOnce(fixture({ claims: [claim, draft] }));
    await userEvent.click(within(dialog).getByRole('button', { name: '核对材料并提交' }));
    dialog = await screen.findByRole('dialog', { name: '提交辅导员审核' });
    expect(dialog).toHaveTextContent('学校报销办理指引');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.some(([path]) => path.endsWith('/actions'))).toBe(false);
    const checked = financeClaimChecklist(draft).map((item) => item.key);
    for (const item of financeClaimChecklist(draft))
      await userEvent.click(within(dialog).getByLabelText(item.label));
    request.mockResolvedValueOnce(
      fixture({ claims: [claim, { ...draft, checklist: checked, revision: 2 }] }),
    );
    request.mockResolvedValueOnce(
      fixture({
        claims: [claim, { ...draft, checklist: checked, revision: 3, status: 'department_review' }],
      }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: '提交辅导员审核' }));
    await screen.findByText('办理进度已更新');
    expect(request.mock.calls[2][0]).toBe('/finance/tracking/claims/created-claim');
    expect(request.mock.calls[3][0]).toBe('/finance/tracking/claims/created-claim/actions');
    expect(JSON.parse(request.mock.calls[3][1].body)).toEqual({
      revision: 2,
      action: 'submit',
      note: '',
    });
  });

  it.each(['ambiguous', 'another-owner'] as const)(
    'does not guess a newly created ID from an %s workspace difference',
    async (mode) => {
      const { request } = setup(fixture(), 'claims');
      await userEvent.click(await screen.findByRole('button', { name: '新增报销' }));
      const dialog = screen.getByRole('dialog', { name: '新增报销' });
      fireEvent.change(within(dialog).getByLabelText('单张金额（元） 1'), {
        target: { value: '200' },
      });
      await userEvent.type(within(dialog).getByLabelText('收款人姓名'), '测试同学');
      await userEvent.type(within(dialog).getByLabelText('收款人学号'), '2026000001');
      const draft: FinanceClaimView = {
        ...claim,
        id: 'created-a',
        status: 'draft',
        allowedActions: ['submit'],
        canEdit: true,
        submitterUid: mode === 'another-owner' ? 'someone-else' : user.uid,
      };
      request.mockResolvedValueOnce(
        fixture({
          claims:
            mode === 'ambiguous' ? [claim, draft, { ...draft, id: 'created-b' }] : [claim, draft],
        }),
      );
      await userEvent.click(within(dialog).getByRole('button', { name: '核对材料并提交' }));
      await screen.findByText('草稿已保存，可在详情中提交辅导员审核');
      expect(screen.queryByRole('dialog', { name: '提交辅导员审核' })).not.toBeInTheDocument();
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls.some(([path]) => path.endsWith('/actions'))).toBe(false);
    },
  );

  it('opens the explicit edited draft ID even when other drafts arrive in the same response', async () => {
    const draft: FinanceClaimView = {
      ...claim,
      status: 'draft',
      revision: 3,
      allowedActions: ['submit'],
      canEdit: true,
      checklist: [],
      invoiceLines: [{ category: 'activity_materials', amountCents: 20000, repeatCount: 1 }],
    };
    const { request } = setup(fixture({ claims: [draft] }), 'claims');
    await userEvent.click(await screen.findByRole('button', { name: '详情与办理' }));
    await userEvent.click(screen.getByRole('button', { name: '编辑草稿' }));
    const dialog = screen.getByRole('dialog', { name: '编辑报销草稿' });
    request.mockResolvedValueOnce(
      fixture({
        claims: [
          { ...draft, revision: 4 },
          { ...draft, id: 'other-arrival-a' },
          { ...draft, id: 'other-arrival-b' },
        ],
      }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: '核对材料并提交' }));
    await screen.findByRole('dialog', { name: '提交辅导员审核' });
    expect(request.mock.calls[1][0]).toBe('/finance/tracking/claims/claim-1');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
