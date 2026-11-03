import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FINANCE_PORTS,
  FINANCE_INVOICE_CATEGORIES,
  financeClaimChecklist,
  financeClaimWarnings,
  type FinanceBudgetInput,
  type FinanceBudgetSummary,
  type FinanceChannelBalance,
  type FinanceClaimAction,
  type FinanceClaimInput,
  type FinanceClaimStatus,
  type FinanceClaimView,
  type FinanceDepartment,
  type FinanceTrackingPayload,
  type UserContext,
} from '@freebbs-development/contracts';

import { AsyncState } from '../../components/AsyncState.js';
import { DialogForm } from '../../components/DialogForm.js';
import { EditorDrawer } from '../../components/EditorDrawer.js';
import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import { BudgetImportDialog } from './BudgetImportDialog.js';
import {
  FinanceClaimEditor,
  FinanceGuide,
  PrivateFinanceFile,
  financeClaimInputOf,
  financeClaimTitle,
  financeGuideFor,
} from './FinanceClaimEditor.js';
import { FinanceWorkflowEditor } from './FinanceWorkflowEditor.js';
import '../../styles/finance-tracking.css';

const BASE = '/finance/tracking';
const statusLabels: Record<FinanceClaimStatus, string> = {
  draft: '草稿',
  department_review: '等待辅导员审核',
  initial_approved: '系内初审已通过',
  school_review: '校财务流程中',
  received: '已确认收到款项',
  returned: '系内初审已驳回',
  withdrawn: '已撤回',
};
const actionLabels: Record<FinanceClaimAction, string> = {
  submit: '提交辅导员审核',
  approve: '同意初审',
  return: '需补充内容',
  withdraw: '撤回申请',
  record_school_submission: '确认进入校财务流程',
  record_teacher_approval: '记录老师审核通过',
  confirm_received: '确认收到款项',
};
const kindLabel = (kind: FinanceClaimInput['kind']) => (kind === 'reimbursement' ? '报销' : '代发');
const money = (cents: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(cents / 100);
const dateLabel = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(date));
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请稍后重试';
function centsOf(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))
    throw new Error('金额请填写非负数，最多保留两位小数');
  const [yuan, fraction = ''] = value.trim().split('.');
  const result = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('金额超出可填写范围');
  return result;
}
const amountText = (cents: number) => (cents / 100).toFixed(2);
const requestId = () => globalThis.crypto.randomUUID();

interface ProjectDraft extends Omit<
  FinanceBudgetInput,
  'reimbursementCents' | 'directPaymentCents'
> {
  reimbursement: string;
  directPayment: string;
}
type Modal =
  | { kind: 'project'; project?: FinanceBudgetSummary }
  | { kind: 'settings' }
  | { kind: 'workflow_settings' }
  | { kind: 'import' }
  | { kind: 'claim'; paymentKind: FinanceClaimInput['kind']; claim?: FinanceClaimView }
  | { kind: 'detail'; id: string }
  | { kind: 'action'; claim: FinanceClaimView; action: FinanceClaimAction }
  | null;

export interface FinanceWorkspaceProps {
  page: 'budget' | 'claims';
  client?: ApiClient;
  user?: UserContext | null;
}

function Metric({ label, cents, tone }: { label: string; cents: number; tone?: string }) {
  return (
    <div className={`ft-metric ${tone ? `ft-metric--${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{money(cents)}</strong>
    </div>
  );
}

function BalanceRow({ label, value }: { label: string; value: FinanceChannelBalance }) {
  return (
    <tr className={value.overBudget ? 'ft-over-budget' : undefined}>
      <th scope="row">{label}</th>
      <td>{money(value.allocatedCents)}</td>
      <td>
        <strong>{money(value.remainingCents)}</strong>
        {value.overBudget ? <span className="ft-over-label">超出预算</span> : null}
      </td>
      <td>{money(value.departmentReviewCents + value.schoolReviewCents)}</td>
      <td>{money(value.receivedCents)}</td>
    </tr>
  );
}

function Progress({ claim }: { claim: FinanceClaimView }) {
  const stages = ['department_review', 'initial_approved', 'school_review', 'received'] as const;
  const current = stages.indexOf(claim.status as (typeof stages)[number]);
  return (
    <ol className="ft-progress" aria-label="办理进度">
      {stages.map((status, index) => (
        <li
          key={status}
          data-current={claim.status === status}
          data-complete={current > index}
          aria-current={claim.status === status ? 'step' : undefined}
        >
          <span aria-hidden="true">{current > index ? '✓' : index + 1}</span>
          {statusLabels[status]}
        </li>
      ))}
    </ol>
  );
}

function handlingHint(claim: FinanceClaimView) {
  if (claim.status === 'department_review') return '等待辅导员核对本笔信息';
  if (claim.status === 'initial_approved') return '系内初审已通过，等待辅导员确认财务办理进展';
  if (claim.status === 'school_review')
    return claim.teacherApprovedAt
      ? '老师审核已记录；款项到账后，由提交负责人确认'
      : '校财务流程中，实际收到款项后由提交负责人确认';
  if (claim.status === 'received') return '本笔款项已由提交负责人确认到账';
  if (claim.status === 'returned') return '已退回提交负责人，请按办理记录中的意见修改';
  if (claim.status === 'withdrawn') return '本笔已撤回，不占用预算额度';
  return '草稿尚未提交，不占用预算额度';
}

export function FinanceWorkspace({ page, client, user: suppliedUser }: FinanceWorkspaceProps) {
  const auth = useOptionalAuth();
  const fallbackClient = useMemo(createApiClient, []);
  const activeClient = client ?? auth?.client ?? fallbackClient;
  const user = suppliedUser === undefined ? auth?.user : suppliedUser;
  const [data, setData] = useState<FinanceTrackingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [year, setYear] = useState('');
  const [organization, setOrganization] = useState('');
  const [department, setDepartment] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const generation = useRef(0);
  const submissionRequestId = useRef(requestId());

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await activeClient.request<FinanceTrackingPayload>(BASE);
      if (current === generation.current) {
        setData(result);
        setYear((selected) =>
          page === 'claims'
            ? ''
            : result.projects.some((project) => project.year === selected)
              ? selected
              : ([...new Set(result.projects.map((project) => project.year))].sort().reverse()[0] ??
                ''),
        );
      }
    } catch (cause) {
      if (current === generation.current) {
        setError(messageOf(cause));
        setData(null);
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [activeClient, page]);

  useEffect(() => {
    setData(null);
    setModal(null);
    setFeedback(null);
    setPending(false);
    setOrganization('');
    setDepartment('');
    setSelectedProject('');
    setStatus('');
    setSearch('');
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload, user?.uid]);

  function open(next: Modal) {
    setFormError(null);
    submissionRequestId.current = requestId();
    setModal(next);
  }
  async function mutate(
    path: string,
    method: string,
    body: unknown,
    feedbackText: string,
    onSaved?: (next: FinanceTrackingPayload) => void,
  ) {
    setPending(true);
    setFormError(null);
    setFeedback(null);
    const current = generation.current;
    try {
      const next = await activeClient.request<FinanceTrackingPayload>(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (current === generation.current) {
        setData(next);
        setModal(null);
        setFeedback(feedbackText);
        onSaved?.(next);
      }
    } catch (cause) {
      if (current === generation.current) setFormError(messageOf(cause));
    } finally {
      if (current === generation.current) setPending(false);
    }
  }

  const departments = data?.departments ?? [];
  const departmentById = new Map(departments.map((item) => [item.id, item]));
  const organizations = FINANCE_PORTS.filter((port) =>
    departments.some((item) => item.portId === port.id),
  );
  const departmentOptions = departments.filter(
    (item) => !organization || item.portId === organization,
  );
  const projectOptions = (data?.projects ?? [])
    .filter(
      (project) =>
        (!year || project.year === year) &&
        (!organization || departmentById.get(project.departmentId)?.portId === organization) &&
        (!department || project.departmentId === department),
    )
    .sort(
      (left, right) =>
        left.code.localeCompare(right.code, 'zh-CN', { numeric: true }) ||
        left.name.localeCompare(right.name, 'zh-CN'),
    );
  const departmentName = (id: string) => departments.find((item) => item.id === id)?.name ?? id;
  const projects = projectOptions.filter(
    (project) =>
      (!selectedProject || project.id === selectedProject) &&
      (!search ||
        `${project.code} ${project.name} ${departmentName(project.departmentId)}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const projectById = new Map(
    (data?.projects ?? []).flatMap((project) =>
      [...new Set([project.id, ...(project.memberProjectIds ?? [])])].map(
        (id) => [id, project] as const,
      ),
    ),
  );
  const claims = (data?.claims ?? [])
    .filter(
      (claim) =>
        (!year || projectById.get(claim.projectId)?.year === year) &&
        (!organization || departmentById.get(claim.departmentId)?.portId === organization) &&
        (!department || claim.departmentId === department) &&
        (!selectedProject || projectById.get(claim.projectId)?.id === selectedProject) &&
        (!status || claim.status === status) &&
        (!search ||
          `${financeClaimTitle(claim)} ${claim.submitterDisplayName} ${projectById.get(claim.projectId)?.name ?? ''}`
            .toLowerCase()
            .includes(search.toLowerCase())),
    )
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  const years = [...new Set(data?.projects.map((project) => project.year) ?? [])].sort().reverse();
  const total = projects.reduce(
    (sum, project) => {
      for (const balance of [project.reimbursement, project.directPayment]) {
        sum.allocated += balance.allocatedCents;
        sum.department += balance.departmentReviewCents;
        sum.school += balance.schoolReviewCents;
        sum.received += balance.receivedCents;
        sum.remaining += balance.remainingCents;
      }
      return sum;
    },
    { allocated: 0, department: 0, school: 0, received: 0, remaining: 0 },
  );
  const hasAccess = Boolean(data?.canManageBudget || departments.length);
  const detail =
    modal?.kind === 'detail' ? data?.claims.find((claim) => claim.id === modal.id) : undefined;

  return (
    <section className="module-page ft-workspace" aria-label="财务同步系统">
      <ModulePageHeader
        title={page === 'budget' ? '总预算表' : '报销与代发进度'}
        description={
          page === 'budget'
            ? '按项目查看已批准额度、办理中的款项与可用余额'
            : '查看申请、初审、财务办理与到账进度'
        }
        actions={
          <div className="ft-actions">
            {data?.canManageBudget ? (
              <button type="button" onClick={() => open({ kind: 'settings' })}>
                预算目录
              </button>
            ) : null}
            {data?.canManageBudget ? (
              <button type="button" onClick={() => open({ kind: 'workflow_settings' })}>
                办理指引配置
              </button>
            ) : null}
            {data?.canManageBudget && page === 'budget' ? (
              <>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => open({ kind: 'project' })}
                >
                  录入项目预算
                </button>
                <button type="button" onClick={() => open({ kind: 'import' })}>
                  导入 Excel
                </button>
              </>
            ) : null}
            {page === 'claims' && data?.submittableDepartmentIds.length ? (
              <>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => open({ kind: 'claim', paymentKind: 'reimbursement' })}
                >
                  新增报销
                </button>
                <button
                  type="button"
                  onClick={() => open({ kind: 'claim', paymentKind: 'direct_payment' })}
                >
                  新增代发
                </button>
              </>
            ) : null}
          </div>
        }
      />
      <nav className="ft-tabs" aria-label="财务页面">
        <Link to="/finance/budget" aria-current={page === 'budget' ? 'page' : undefined}>
          总预算表
        </Link>
        <Link to="/finance/claims" aria-current={page === 'claims' ? 'page' : undefined}>
          报销与代发进度
        </Link>
      </nav>
      {feedback ? (
        <p className="ft-feedback" role="status">
          {feedback}
        </p>
      ) : null}
      {loading ? (
        <AsyncState state="loading" loadingLabel="正在读取财务信息…" />
      ) : error ? (
        <AsyncState
          state="error"
          description={error}
          action={
            <button type="button" onClick={() => void reload()}>
              重新加载
            </button>
          }
        />
      ) : !data?.configured ? (
        <AsyncState
          state="empty"
          title="财务系统尚未启用"
          description="请联系维护人员配置财务数据私有目录，配置完成后由财务最终审核人管理预算。"
        />
      ) : !hasAccess ? (
        <AsyncState
          state="empty"
          title="暂未分配财务查看权限"
          description="请联系负责辅导员，在管理员端确认你的组织、部门或代表队身份。"
        />
      ) : (
        <>
          <div className={`ft-filterbar ft-filterbar--${page}`}>
            <label>
              预算年度
              <select
                value={year}
                onChange={(event) => {
                  setYear(event.target.value);
                  setSelectedProject('');
                }}
              >
                <option value="">全部年度</option>
                {years.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              组织
              <select
                value={organization}
                onChange={(event) => {
                  setOrganization(event.target.value);
                  setDepartment('');
                  setSelectedProject('');
                }}
              >
                <option value="">全部可见组织</option>
                {organizations.map((port) => (
                  <option key={port.id} value={port.id}>
                    {port.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              部门
              <select
                value={department}
                onChange={(event) => {
                  const id = event.target.value;
                  setDepartment(id);
                  if (id) setOrganization(departmentById.get(id)?.portId ?? '');
                  setSelectedProject('');
                }}
              >
                <option value="">全部可见部门</option>
                {departmentOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              项目
              <select
                value={selectedProject}
                onChange={(event) => {
                  const id = event.target.value;
                  setSelectedProject(id);
                  const project = data.projects.find((item) => item.id === id);
                  if (project) {
                    setDepartment(project.departmentId);
                    setOrganization(departmentById.get(project.departmentId)?.portId ?? '');
                  }
                }}
              >
                <option value="">全部项目</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} {project.name}
                    {!year ? ` · ${project.year}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {page === 'claims' ? (
              <label>
                办理状态
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">全部状态</option>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="ft-search">
              {page === 'budget' ? '查找项目' : '查找款项'}
              <input
                type="search"
                value={search}
                placeholder={page === 'budget' ? '项目编号或名称' : '购买内容、项目或提交人'}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          {page === 'budget' ? (
            <>
              <div className="ft-metrics" aria-label="当前筛选范围预算汇总">
                <Metric label="已批准预算" cents={total.allocated} />
                <Metric label="在途" cents={total.department + total.school} tone="pending" />
                <Metric label="已报（收到款项）" cents={total.received} />
                <Metric
                  label="没花"
                  cents={total.remaining}
                  tone={total.remaining < 0 ? 'danger' : 'balance'}
                />
              </div>
              <p className="ft-explanation">
                没花 = 批准额度 − 在途 − 已报。报销与代发分别核算；草稿、驳回和撤回不占额度。
              </p>
              {projects.length ? (
                <div className="ft-projects">
                  {projects.map((project) => (
                    <article className="ft-project" key={project.id}>
                      <header>
                        <div>
                          <span className="ft-eyebrow">
                            {project.year} · {departmentName(project.departmentId)}
                          </span>
                          <h3>
                            <span className="ft-project-code">{project.code}</span>
                            {project.name}
                          </h3>
                        </div>
                        {data.canManageBudget && (project.memberProjectIds?.length ?? 1) === 1 ? (
                          <button
                            type="button"
                            aria-label={`编辑预算 ${project.name}`}
                            onClick={() => open({ kind: 'project', project })}
                          >
                            编辑预算
                          </button>
                        ) : null}
                      </header>
                      <div className="ft-table-scroll">
                        <table className="ft-balance-table">
                          <caption className="ft-sr-only">{project.name} 分项余额</caption>
                          <thead>
                            <tr>
                              <th scope="col">类型</th>
                              <th scope="col">批准额度</th>
                              <th scope="col">没花</th>
                              <th scope="col">在途</th>
                              <th scope="col">已报（收到款项）</th>
                            </tr>
                          </thead>
                          <tbody>
                            <BalanceRow label="报销" value={project.reimbursement} />
                            <BalanceRow label="代发" value={project.directPayment} />
                          </tbody>
                        </table>
                      </div>
                      {(project.memberProjectIds?.length ?? 1) > 1 && data.canManageBudget ? (
                        <p className="ft-project-note">
                          此额度池合并核算多个预算条目，请通过 Excel 导入更新原始预算。
                        </p>
                      ) : null}
                      {project.notes ? <p className="ft-project-note">{project.notes}</p> : null}
                    </article>
                  ))}
                </div>
              ) : (
                <AsyncState
                  state="empty"
                  title="暂无项目预算"
                  description={
                    data.canManageBudget
                      ? '先在“预算目录”中设置部门，再录入该年度已批准的项目额度。'
                      : '当前范围还没有已录入的项目预算。'
                  }
                />
              )}
            </>
          ) : (
            <>
              <p className="ft-explanation">
                查看本笔款项的初审、财务办理和到账情况。实际到账由原提交负责人确认。
              </p>
              {claims.length ? (
                <div className="ft-claims">
                  {claims.map((claim) => {
                    const project = projectById.get(claim.projectId);
                    return (
                      <article className="ft-claim" key={claim.id}>
                        <header>
                          <div>
                            <span className="ft-eyebrow">
                              {departmentName(claim.departmentId)} · {kindLabel(claim.kind)}
                            </span>
                            <h3>
                              <button
                                className="ft-title-button"
                                type="button"
                                onClick={() => open({ kind: 'detail', id: claim.id })}
                              >
                                {financeClaimTitle(claim)}
                              </button>
                            </h3>
                            <p>
                              {project?.code} {project?.name}
                            </p>
                          </div>
                          <div className="ft-claim-amount">
                            <strong>{money(claim.amountCents)}</strong>
                            <span className="ft-status" data-status={claim.status}>
                              {statusLabels[claim.status]}
                            </span>
                          </div>
                        </header>
                        <Progress claim={claim} />
                        <p className="ft-handler">{handlingHint(claim)}</p>
                        <footer>
                          <span>
                            {claim.submitterDisplayName} · {dateLabel(claim.updatedAt)} 更新
                          </span>
                          <button
                            type="button"
                            onClick={() => open({ kind: 'detail', id: claim.id })}
                          >
                            详情与办理
                          </button>
                        </footer>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <AsyncState
                  state="empty"
                  title="暂无相关报销或代发记录"
                  description="选择“新增报销”或“新增代发”填写，未完成的信息可以暂存。"
                />
              )}
            </>
          )}
        </>
      )}
      {data && modal?.kind === 'import' && data.canManageBudget ? (
        <BudgetImportDialog
          client={activeClient}
          departments={data.departments}
          initialYear={year}
          initialOrganizationId={organization}
          onClose={() => setModal(null)}
          onImported={({ workspace, summary }, importedYear) => {
            setData(workspace);
            setYear(importedYear);
            setOrganization('');
            setDepartment('');
            setSelectedProject('');
            setModal(null);
            setFeedback(
              `预算已导入：新增 ${summary.created} 项，更新 ${summary.updated} 项，无变更 ${summary.unchanged} 项`,
            );
          }}
        />
      ) : null}
      {data && modal?.kind === 'project' ? (
        <ProjectEditor
          key={modal.project?.id ?? 'new-project'}
          data={data}
          project={modal.project}
          pending={pending}
          error={formError}
          onClose={() => !pending && setModal(null)}
          onSave={(input) =>
            mutate(
              modal.project ? `/projects/${encodeURIComponent(modal.project.id)}` : '/projects',
              modal.project ? 'PUT' : 'POST',
              {
                ...input,
                ...(modal.project
                  ? { revision: modal.project.revision }
                  : { requestId: submissionRequestId.current }),
              },
              '项目预算已保存',
            )
          }
        />
      ) : null}
      {data && modal?.kind === 'workflow_settings' ? (
        <FinanceWorkflowEditor
          data={data}
          client={activeClient}
          pending={pending}
          error={formError}
          onClose={() => !pending && setModal(null)}
          onSave={(workflowGuides) =>
            mutate(
              '/settings',
              'PUT',
              {
                revision: data.settings?.revision ?? 0,
                departments: data.settings?.departments ?? data.departments,
                grants: [],
                workflowGuides,
              },
              '办理指引配置已保存',
            )
          }
        />
      ) : null}
      {data && modal?.kind === 'settings' ? (
        <SettingsEditor
          data={data}
          pending={pending}
          error={formError}
          onClose={() => !pending && setModal(null)}
          onSave={(departments) =>
            mutate(
              '/settings',
              'PUT',
              {
                revision: data.settings?.revision ?? 0,
                departments,
                grants: [],
                ...(data.settings?.workflowGuides
                  ? { workflowGuides: data.settings.workflowGuides }
                  : {}),
              },
              '预算目录已更新',
            )
          }
        />
      ) : null}
      {data && modal?.kind === 'claim' ? (
        <FinanceClaimEditor
          key={modal.claim?.id ?? 'new-claim'}
          data={data}
          kind={modal.paymentKind}
          client={activeClient}
          claim={modal.claim}
          pending={pending}
          error={formError}
          onClose={() => !pending && setModal(null)}
          onSave={(input, prepareSubmit) => {
            const previousIds = new Set(data.claims.map((claim) => claim.id));
            const actorUid = user?.uid;
            return mutate(
              modal.claim ? `/claims/${encodeURIComponent(modal.claim.id)}` : '/claims',
              modal.claim ? 'PUT' : 'POST',
              {
                ...input,
                ...(modal.claim
                  ? { revision: modal.claim.revision }
                  : { requestId: submissionRequestId.current }),
              },
              '草稿已保存，可在详情中提交辅导员审核',
              prepareSubmit
                ? (next) => {
                    const candidates = modal.claim
                      ? next.claims.filter((claim) => claim.id === modal.claim!.id)
                      : actorUid
                        ? next.claims.filter(
                            (claim) =>
                              !previousIds.has(claim.id) &&
                              claim.submitterUid === actorUid &&
                              claim.projectId === input.projectId &&
                              claim.kind === input.kind &&
                              claim.status === 'draft',
                          )
                        : [];
                    if (
                      candidates.length === 1 &&
                      candidates[0].allowedActions.includes('submit')
                    ) {
                      setModal({ kind: 'action', claim: candidates[0], action: 'submit' });
                      setFeedback('草稿已保存，请核对材料后提交');
                    }
                  }
                : undefined,
            );
          }}
        />
      ) : null}
      {data && modal?.kind === 'action' ? (
        <ActionDialog
          claim={modal.claim}
          data={data}
          client={activeClient}
          action={modal.action}
          pending={pending}
          error={formError}
          onClose={() => !pending && setModal(null)}
          onSave={async (note, checklist) => {
            setPending(true);
            setFormError(null);
            const current = generation.current;
            try {
              let claim = modal.claim;
              if (
                modal.action === 'submit' &&
                checklist &&
                JSON.stringify(checklist) !== JSON.stringify(claim.checklist ?? [])
              ) {
                const updated = await activeClient.request<FinanceTrackingPayload>(
                  `${BASE}/claims/${encodeURIComponent(claim.id)}`,
                  {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ...financeClaimInputOf(claim, checklist),
                      revision: claim.revision,
                    }),
                  },
                );
                claim = updated.claims.find((item) => item.id === claim.id) ?? claim;
                if (current === generation.current) setData(updated);
              }
              const updated = await activeClient.request<FinanceTrackingPayload>(
                `${BASE}/claims/${encodeURIComponent(claim.id)}/actions`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ revision: claim.revision, action: modal.action, note }),
                },
              );
              if (current === generation.current) {
                setData(updated);
                setModal(null);
                setFeedback('办理进度已更新');
              }
            } catch (cause) {
              if (current === generation.current) setFormError(messageOf(cause));
            } finally {
              if (current === generation.current) setPending(false);
            }
          }}
        />
      ) : null}
      <EditorDrawer
        open={Boolean(detail)}
        title="款项详情与办理记录"
        onClose={() => setModal(null)}
      >
        {detail ? (
          <div className="ft-detail">
            <div className="ft-detail-heading">
              <span className="ft-status" data-status={detail.status}>
                {statusLabels[detail.status]}
              </span>
              <strong>{money(detail.amountCents)}</strong>
            </div>
            <p>
              {departmentName(detail.departmentId)} · {projectById.get(detail.projectId)?.code}{' '}
              {projectById.get(detail.projectId)?.name} · {kindLabel(detail.kind)}
            </p>
            <Progress claim={detail} />
            <p>{handlingHint(detail)}</p>
            <dl className="ft-detail-list">
              <dt>提交人</dt>
              <dd>{detail.submitterDisplayName}</dd>
              <dt>
                {detail.invoiceLines?.length
                  ? '发票信息'
                  : detail.kind === 'direct_payment' && detail.directPayment
                    ? '工作内容'
                    : '原始购买明细'}
              </dt>
              <dd>
                {detail.invoiceLines?.length ? (
                  detail.invoiceLines.map((line, index) => (
                    <div key={index}>
                      {FINANCE_INVOICE_CATEGORIES.find((item) => item.id === line.category)?.name} ·{' '}
                      {money(line.amountCents)} × {line.repeatCount} 张
                      {line.description ? ` · ${line.description}` : ''}
                    </div>
                  ))
                ) : detail.directPayment ? (
                  <>
                    <div>{detail.directPayment.workContent || '未填写'}</div>
                    <div>时薪 {money(detail.directPayment.hourlyRateCents)}</div>
                  </>
                ) : (
                  detail.items.map((item, index) => (
                    <div key={index}>
                      {item.description} × {item.quantity}
                    </div>
                  ))
                )}
              </dd>
              <dt>收款人 / 学号</dt>
              <dd>
                {detail.payeeName || '未填写'} / {detail.payeeStudentId || '未填写'}
              </dd>
              <dt>材料与办理确认</dt>
              <dd>
                {detail.checklist
                  ? financeClaimChecklist(detail, financeGuideFor(data!, detail.departmentId)).map(
                      (item) => (
                        <div key={item.key}>
                          {detail.checklist?.includes(item.key) ? '✓' : '○'} {item.label}
                        </div>
                      ),
                    )
                  : detail.materials.length
                    ? detail.materials.map((material, index) => <div key={index}>{material}</div>)
                    : '未填写'}
              </dd>
              <dt>校财务 / 邮件凭据</dt>
              <dd>{detail.externalReference || '未填写'}</dd>
              <dt>外部提交时间</dt>
              <dd>
                {detail.externalSubmittedAt ? dateLabel(detail.externalSubmittedAt) : '未填写'}
              </dd>
              <dt>辅导员确认财务办理</dt>
              <dd>
                {detail.counselorFinancialApprovedAt
                  ? dateLabel(detail.counselorFinancialApprovedAt)
                  : '尚未确认'}
              </dd>
              {!detail.counselorFinancialApprovedAt && detail.schoolSubmittedAt ? (
                <>
                  <dt>旧版校财务提交记录</dt>
                  <dd>{dateLabel(detail.schoolSubmittedAt)}</dd>
                </>
              ) : null}
              <dt>老师审核记录</dt>
              <dd>{detail.teacherApprovedAt ? dateLabel(detail.teacherApprovedAt) : '尚未记录'}</dd>
              {detail.notes ? (
                <>
                  <dt>补充说明</dt>
                  <dd>{detail.notes}</dd>
                </>
              ) : null}
            </dl>
            {financeClaimWarnings(detail).map((warning) => (
              <p className="ft-warning" role="alert" key={warning}>
                ⚠ {warning}
              </p>
            ))}
            {detail.directPayment?.proofFileIds.length ? (
              <div className="ft-proof-grid">
                {detail.directPayment.proofFileIds.map((id, index) => (
                  <PrivateFinanceFile
                    key={id}
                    client={activeClient}
                    id={id}
                    label={`工作证明 ${index + 1}`}
                    image
                  />
                ))}
              </div>
            ) : null}
            <FinanceGuide
              guide={financeGuideFor(data!, detail.departmentId)}
              kind={detail.kind}
              client={activeClient}
            />
            <div className="ft-actions">
              {detail.canEdit ? (
                <button
                  type="button"
                  onClick={() => open({ kind: 'claim', paymentKind: detail.kind, claim: detail })}
                >
                  编辑草稿
                </button>
              ) : null}
              {detail.allowedActions.map((action) => (
                <button
                  type="button"
                  key={action}
                  className={
                    ['approve', 'submit', 'confirm_received'].includes(action)
                      ? 'primary-button'
                      : undefined
                  }
                  onClick={() => open({ kind: 'action', claim: detail, action })}
                >
                  {actionLabels[action]}
                </button>
              ))}
            </div>
            <h3>办理记录</h3>
            <ol className="ft-history">
              {detail.history.map((event, index) => (
                <li key={index}>
                  <div>
                    <strong>
                      {event.action === 'create'
                        ? '建立草稿'
                        : event.action === 'edit'
                          ? '更新草稿'
                          : event.action === 'record_school_submission' && event.from === event.to
                            ? '经费负责人提交记录（旧版）'
                            : actionLabels[event.action]}
                    </strong>
                    <time dateTime={event.at}>{dateLabel(event.at)}</time>
                  </div>
                  <p>
                    {event.actorDisplayName} ·{' '}
                    {event.action === 'approve' && event.to === 'school_review'
                      ? '系内初审已通过（旧版记录）'
                      : event.action === 'record_school_submission' && event.from === event.to
                        ? '旧版提交记录，不代表辅导员已确认财务办理'
                        : statusLabels[event.to]}
                  </p>
                  {event.note ? <p>{event.note}</p> : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </EditorDrawer>
    </section>
  );
}

function ProjectEditor({
  data,
  project,
  pending,
  error,
  onClose,
  onSave,
}: {
  data: FinanceTrackingPayload;
  project?: FinanceBudgetSummary;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: FinanceBudgetInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProjectDraft>({
    year: project?.year ?? `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
    departmentId: project?.departmentId ?? data.departments[0]?.id ?? '',
    code: project?.code ?? '',
    name: project?.name ?? '',
    reimbursement: amountText(project?.reimbursementCents ?? 0),
    directPayment: amountText(project?.directPaymentCents ?? 0),
    notes: project?.notes ?? '',
  });
  const [organization, setOrganization] = useState(
    data.departments.find((item) => item.id === (project?.departmentId ?? data.departments[0]?.id))
      ?.portId ?? '',
  );
  const organizations = FINANCE_PORTS.filter((port) =>
    data.departments.some((department) => department.portId === port.id),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const field = (key: keyof ProjectDraft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <DialogForm
      open
      title={project ? '调整项目预算' : '录入项目预算'}
      description="按项目编号汇总额度；同一项目的多条预算明细共用额度。"
      submitLabel="保存预算"
      pending={pending}
      error={localError ?? error}
      onClose={onClose}
      onSubmit={async () => {
        try {
          const { reimbursement, directPayment, ...rest } = draft;
          const input = {
            ...rest,
            reimbursementCents: centsOf(reimbursement),
            directPaymentCents: centsOf(directPayment),
          };
          setLocalError(null);
          await onSave(input);
        } catch (cause) {
          setLocalError(messageOf(cause));
        }
      }}
    >
      <div className="ft-form ft-form-grid">
        <label>
          预算年度
          <input
            required
            maxLength={30}
            value={draft.year}
            onChange={(event) => field('year', event.target.value)}
          />
        </label>
        <label>
          所属组织
          <select
            required
            value={organization}
            onChange={(event) => {
              setOrganization(event.target.value as FinanceDepartment['portId']);
              field('departmentId', '');
            }}
          >
            <option value="" disabled>
              请选择组织
            </option>
            {organizations.map((port) => (
              <option key={port.id} value={port.id}>
                {port.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          所属部门
          <select
            required
            value={draft.departmentId}
            onChange={(event) => field('departmentId', event.target.value)}
          >
            <option value="" disabled>
              请选择部门
            </option>
            {data.departments
              .filter((item) => item.portId === organization)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          项目编号
          <input
            required
            maxLength={60}
            placeholder="例如 2-1-1"
            value={draft.code}
            onChange={(event) => field('code', event.target.value)}
          />
        </label>
        <label className="ft-wide">
          项目名称
          <input
            required
            maxLength={150}
            value={draft.name}
            onChange={(event) => field('name', event.target.value)}
          />
        </label>
        <label>
          报销批准额度（元）
          <input
            required
            inputMode="decimal"
            value={draft.reimbursement}
            onChange={(event) => field('reimbursement', event.target.value)}
          />
        </label>
        <label>
          代发批准额度（元）
          <input
            required
            inputMode="decimal"
            value={draft.directPayment}
            onChange={(event) => field('directPayment', event.target.value)}
          />
        </label>
        <label className="ft-wide">
          预算备注
          <textarea
            rows={3}
            maxLength={3000}
            value={draft.notes}
            onChange={(event) => field('notes', event.target.value)}
          />
        </label>
      </div>
    </DialogForm>
  );
}

function ActionDialog({
  claim,
  data,
  client,
  action,
  pending,
  error,
  onClose,
  onSave,
}: {
  claim: FinanceClaimView;
  data: FinanceTrackingPayload;
  client: ApiClient;
  action: FinanceClaimAction;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (note: string, checklist?: string[]) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [checklist, setChecklist] = useState(claim.checklist ?? []);
  const [localError, setLocalError] = useState<string | null>(null);
  const guide = financeGuideFor(data, claim.departmentId);
  const requirements = financeClaimChecklist(claim, guide);
  const description =
    action === 'confirm_received'
      ? `请核实 ${money(claim.amountCents)} 已实际到账，确认后计入已报金额。`
      : action === 'approve'
        ? '确认本笔信息无误后通过系内初审；财务办理进展另行确认。'
        : action === 'record_school_submission'
          ? '请在学校财务系统完成对应审核后，再确认进入财务办理阶段。'
          : action === 'submit'
            ? undefined
            : '此操作同步本笔办理记录。';
  return (
    <DialogForm
      open
      title={actionLabels[action]}
      description={description}
      submitLabel={actionLabels[action]}
      pending={pending}
      error={localError ?? error}
      onClose={onClose}
      onSubmit={async () => {
        if (action === 'submit') {
          if (
            !claim.payeeName.trim() ||
            !claim.payeeStudentId.trim() ||
            claim.amountCents <= 0 ||
            (claim.kind === 'reimbursement' &&
              (!claim.invoiceLines?.length ||
                claim.invoiceLines.some((line) => line.amountCents <= 0))) ||
            (claim.kind === 'direct_payment' &&
              (!claim.directPayment?.workContent.trim() ||
                claim.directPayment.hourlyRateCents <= 0 ||
                !claim.directPayment.proofFileIds.length))
          ) {
            setLocalError('请先编辑草稿，补全发票或代发信息、收款人及工作证明');
            return;
          }
          if (requirements.some((item) => !checklist.includes(item.key))) {
            setLocalError('请完成全部材料与办理确认项');
            return;
          }
        }
        if (['confirm_received', 'record_school_submission'].includes(action) && !acknowledged) {
          setLocalError('请先勾选确认项');
          return;
        }
        setLocalError(null);
        await onSave(note, action === 'submit' ? checklist : undefined);
      }}
    >
      <div className="ft-form">
        {action === 'submit' ? (
          <>
            <FinanceGuide guide={guide} kind={claim.kind} client={client} embedded />
            {financeClaimWarnings(claim).map((warning) => (
              <p className="ft-warning" role="alert" key={warning}>
                ⚠ {warning}
              </p>
            ))}
            <fieldset className="ft-checklist">
              <legend>材料与办理确认</legend>
              {requirements.map((item) => (
                <label className="ft-checkbox" key={item.key}>
                  <input
                    type="checkbox"
                    checked={checklist.includes(item.key)}
                    onChange={(event) =>
                      setChecklist((current) =>
                        event.target.checked
                          ? [...new Set([...current, item.key])]
                          : current.filter((key) => key !== item.key),
                      )
                    }
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </fieldset>
          </>
        ) : null}
        {['confirm_received', 'record_school_submission'].includes(action) ? (
          <label className="ft-checkbox">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              {action === 'confirm_received'
                ? '已核实本笔款项实际到账'
                : '已完成本笔款项对应的财务办理操作'}
            </span>
          </label>
        ) : null}
        <label>
          {action === 'return' ? '需补充内容及原因' : '办理备注（选填）'}
          <textarea
            rows={3}
            required={action === 'return'}
            maxLength={3000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
    </DialogForm>
  );
}

function SettingsEditor({
  data,
  pending,
  error,
  onClose,
  onSave,
}: {
  data: FinanceTrackingPayload;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (departments: FinanceDepartment[]) => Promise<void>;
}) {
  const initialDepartments = data.settings?.departments ?? data.departments;
  const [departments, setDepartments] = useState(() =>
    initialDepartments.map((department) => ({
      ...department,
      reviewerText: department.reviewPolicy?.reviewerUids.join(', ') ?? '',
    })),
  );
  const existingIds = new Set(initialDepartments.map((department) => department.id));
  return (
    <DialogForm
      open
      title="预算目录"
      description="人员与岗位在管理员端统一维护。这里维护预算使用的组织和部门目录。"
      submitLabel="保存预算目录"
      pending={pending}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onSave(
          departments.map(({ reviewerText, ...department }) => {
            if (!data.canManageReviewPolicies) return department;
            const reviewerUids = [...new Set(reviewerText.split(/[\s,，;；]+/).filter(Boolean))];
            return {
              ...department,
              reviewPolicy: reviewerUids.length ? { reviewerUids } : undefined,
            };
          }),
        )
      }
    >
      <div className="ft-form ft-settings">
        <p className="ft-explanation">
          需要调整人员身份与岗位时，请<Link to="/system-settings">前往管理员端</Link>。
        </p>
        <h3>部门目录</h3>
        {departments.map((department, index) => (
          <div key={index} className="ft-directory-row">
            <label>
              部门标识 {index + 1}
              <input
                required
                maxLength={100}
                readOnly={existingIds.has(department.id)}
                value={department.id}
                onChange={(event) =>
                  setDepartments((current) =>
                    current.map((value, position) =>
                      position === index ? { ...value, id: event.target.value } : value,
                    ),
                  )
                }
              />
            </label>
            <label>
              部门名称 {index + 1}
              <input
                required
                maxLength={100}
                value={department.name}
                onChange={(event) =>
                  setDepartments((current) =>
                    current.map((value, position) =>
                      position === index ? { ...value, name: event.target.value } : value,
                    ),
                  )
                }
              />
            </label>
            <label>
              所属组织 {index + 1}
              <select
                value={department.portId}
                onChange={(event) =>
                  setDepartments((current) =>
                    current.map((value, position) =>
                      position === index
                        ? { ...value, portId: event.target.value as FinanceDepartment['portId'] }
                        : value,
                    ),
                  )
                }
              >
                {FINANCE_PORTS.map((port) => (
                  <option key={port.id} value={port.id}>
                    {port.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label={`移除部门 ${department.name || index + 1}`}
              onClick={() =>
                setDepartments((current) => current.filter((_, position) => position !== index))
              }
            >
              移除
            </button>
            {data.canManageReviewPolicies ? (
              <details className="ft-review-policy">
                <summary>审核权限：{department.reviewerText ? '仅指定审核人' : '通用审核'}</summary>
                <label>
                  指定审核人 UID {index + 1}（留空沿用通用审核）
                  <input
                    value={department.reviewerText}
                    onChange={(event) => {
                      setDepartments((current) =>
                        current.map((value, position) =>
                          position === index
                            ? { ...value, reviewerText: event.target.value }
                            : value,
                        ),
                      );
                    }}
                  />
                </label>
              </details>
            ) : department.reviewPolicy ? (
              <p className="ft-review-policy">仅指定审核人可处理审核，由最高管理员维护</p>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setDepartments((current) => [
              ...current,
              {
                id: `department-${requestId()}`,
                name: '',
                portId: 'youth_league',
                reviewerText: '',
              },
            ])
          }
        >
          ＋ 添加部门 / 代表队
        </button>
      </div>
    </DialogForm>
  );
}
