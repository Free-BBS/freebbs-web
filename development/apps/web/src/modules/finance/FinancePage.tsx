import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  SOCIAL_ORGANIZATIONS,
  organizationForRole,
  type ScopeRef,
  type UserContext,
} from '@freebbs-development/contracts';

import { AsyncState } from '../../components/AsyncState.js';
import { FilterBar } from '../../components/FilterBar.js';
import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import { ResponsiveRecordList } from '../../components/ResponsiveRecordList.js';
import { StatusBadge, type StatusBadgeStatus } from '../../components/StatusBadge.js';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';

type FinanceStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'archived';
type FinanceKind = 'budget' | 'settlement';

type FinanceUser = UserContext & {
  policies?: readonly {
    action: string;
    resource: string;
    effect: 'allow' | 'deny';
    scope?: ScopeRef;
    expiresAt?: string | null;
  }[];
};

interface FinanceRecord {
  id: string;
  title: string;
  kind: FinanceKind;
  amountCents: number;
  activityId?: string | null;
  status: FinanceStatus;
  organizationId?: string | null;
  reviewerUid?: string | null;
  reviewedAt?: string | null;
  reviewDecision?: 'approved' | 'rejected' | null;
  ownerUid: string;
  scope: ScopeRef;
  createdAt: string;
  updatedAt: string;
}

interface FinanceDraft {
  title: string;
  kind: FinanceKind;
  amount: string;
  activityId: string;
  scopeType: string;
  organizationId: string;
  scopeId: string;
}

const emptyDraft: FinanceDraft = {
  title: '',
  kind: 'budget',
  amount: '0.00',
  activityId: '',
  scopeType: 'public',
  organizationId: '',
  scopeId: '*',
};
const statusLabels: Record<FinanceStatus, string> = {
  draft: '草稿',
  submitted: '待审批',
  approved: '已批准',
  rejected: '已驳回',
  archived: '已归档',
};

const statusTones: Record<FinanceStatus, StatusBadgeStatus> = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'success',
  rejected: 'error',
  archived: 'neutral',
};

function leadOrganizationIds(user: FinanceUser | null): string[] {
  if (user === null) return [];
  if (user.roles.includes('platform.super_admin')) {
    return SOCIAL_ORGANIZATIONS.map(({ id }) => id);
  }
  const own = user.roles.flatMap((role) => {
    const membership = organizationForRole(role);
    return membership?.level === 'lead' ? [membership.organizationId] : [];
  });
  if (own.includes('tuanwei')) return SOCIAL_ORGANIZATIONS.map(({ id }) => id);
  return [...new Set(own)];
}

function memberOrganizationIds(user: FinanceUser | null): string[] {
  if (user === null) return [];
  return [
    ...new Set(
      user.roles.flatMap((role) => {
        const membership = organizationForRole(role);
        return membership ? [membership.organizationId] : [];
      }),
    ),
  ];
}

function canReviewFinance(user: FinanceUser | null): boolean {
  if (user === null) return false;
  if (user.roles.includes('platform.super_admin')) return true;
  return user.roles.some((role) => {
    const membership = organizationForRole(role);
    return membership?.organizationId === 'tuanwei' && membership.level === 'lead';
  });
}

function organizationName(organizationId: string | null | undefined): string {
  if (organizationId == null) return '\u672a\u5f52\u5c5e\uff08\u5386\u53f2\u8bb0\u5f55\uff09';
  return SOCIAL_ORGANIZATIONS.find(({ id }) => id === organizationId)?.name ?? organizationId;
}
function statusOf(error: unknown): number | null {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '操作失败，请稍后重试';
}

function matches(pattern: string, value: string): boolean {
  return (
    pattern === '*' ||
    pattern === value ||
    (pattern.endsWith('.*') && value.startsWith(pattern.slice(0, -1)))
  );
}

function permitted(user: FinanceUser | null, action: string, scope: ScopeRef): boolean {
  if (user === null) return false;
  const now = Date.now();
  const policies = (user.policies ?? []).filter(
    (policy) =>
      matches(policy.action, action) &&
      matches(policy.resource, 'finance_record') &&
      (policy.scope === undefined ||
        (policy.scope.type === scope.type && policy.scope.id === scope.id)) &&
      (policy.expiresAt == null || Date.parse(policy.expiresAt) > now),
  );
  return (
    !policies.some((policy) => policy.effect === 'deny') &&
    policies.some((policy) => policy.effect === 'allow')
  );
}

function hasAnyGrant(user: FinanceUser | null, action: string): boolean {
  if (user === null) return false;
  const now = Date.now();
  return (user.policies ?? []).some(
    (policy) =>
      matches(policy.action, action) &&
      matches(policy.resource, 'finance_record') &&
      policy.effect === 'allow' &&
      (policy.expiresAt == null || Date.parse(policy.expiresAt) > now),
  );
}

function scopeFromDraft(draft: FinanceDraft): ScopeRef {
  const activityId = draft.activityId.trim();
  if (activityId) return { type: 'activity', id: activityId };
  const organizationId = draft.organizationId.trim();
  return organizationId
    ? { type: 'social_organization', id: organizationId }
    : { type: draft.scopeType.trim(), id: draft.scopeId.trim() };
}

function draftFromRecord(record: FinanceRecord): FinanceDraft {
  return {
    title: record.title,
    kind: record.kind,
    amount: (record.amountCents / 100).toFixed(2),
    activityId: record.activityId ?? '',
    scopeType: record.scope.type,
    scopeId: record.scope.id,
    organizationId: record.organizationId ?? '',
  };
}

function validateDraft(draft: FinanceDraft): { amountCents: number; scope: ScopeRef } | string {
  if (!draft.title.trim()) return '请填写记录标题';
  const amountCents = parseAmountToCents(draft.amount);
  if (amountCents === null) return '金额最多保留两位小数，并且不能为负数';
  const scope = scopeFromDraft(draft);
  if (!/^[a-z][a-z0-9_]*$/.test(scope.type) || !scope.id) return '请填写有效的记录范围';
  return { amountCents, scope };
}

export function formatAmount(amountCents: number): string {
  const sign = amountCents < 0 ? '-' : '';
  const absolute = Math.abs(amountCents);
  return `${sign}¥${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function parseAmountToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [yuan, fraction = ''] = trimmed.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function countsAsApproved(record: FinanceRecord): boolean {
  return (
    record.status === 'approved' ||
    (record.status === 'archived' && record.reviewDecision === 'approved')
  );
}

function summarizeOrganization(records: FinanceRecord[], organizationId: string) {
  const organizationRecords = records.filter((record) => record.organizationId === organizationId);
  const approvedBudget = organizationRecords
    .filter((record) => record.kind === 'budget' && countsAsApproved(record))
    .reduce((total, record) => total + record.amountCents, 0);
  const spent = organizationRecords
    .filter((record) => record.kind === 'settlement' && countsAsApproved(record))
    .reduce((total, record) => total + record.amountCents, 0);
  const pending = organizationRecords
    .filter((record) => record.kind === 'settlement' && record.status === 'submitted')
    .reduce((total, record) => total + record.amountCents, 0);
  return {
    organizationId,
    approvedBudget,
    spent,
    pending,
    remaining: approvedBudget - spent,
    usagePercent:
      approvedBudget === 0 ? 0 : Math.min(100, Math.round((spent / approvedBudget) * 100)),
  };
}

export interface FinancePageProps {
  client?: Pick<ApiClient, 'request'>;
  user?: FinanceUser | null;
}

export function FinancePage({ client: suppliedClient, user: suppliedUser }: FinancePageProps = {}) {
  const client = useMemo(() => suppliedClient ?? createApiClient(), [suppliedClient]);
  const auth = useOptionalAuth();
  const user =
    suppliedUser === undefined ? ((auth?.user as FinanceUser | null) ?? null) : suppliedUser;
  const organizationIds = useMemo(() => leadOrganizationIds(user), [user]);
  const defaultOrganizationId = organizationIds[0] ?? '';

  const [records, setRecords] = useState<FinanceRecord[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [createDraft, setCreateDraft] = useState<FinanceDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<FinanceDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [policyRevision, setPolicyRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FinanceStatus | ''>('');

  useEffect(() => {
    const now = Date.now();
    const nextExpiry = Math.min(
      ...(user?.policies ?? [])
        .map((policy) => (policy.expiresAt == null ? Number.NaN : Date.parse(policy.expiresAt)))
        .filter((expiresAt) => Number.isFinite(expiresAt) && expiresAt > now),
    );
    if (!Number.isFinite(nextExpiry)) return;
    const delay = Math.min(Math.max(nextExpiry - now + 1, 1), 2_147_483_647);
    const timer = window.setTimeout(() => setPolicyRevision((current) => current + 1), delay);
    return () => window.clearTimeout(timer);
  }, [policyRevision, user]);

  useEffect(() => {
    if (!defaultOrganizationId) return;
    setCreateDraft((current) =>
      current.organizationId ? current : { ...current, organizationId: defaultOrganizationId },
    );
  }, [defaultOrganizationId]);

  function replaceConfirmed(record: FinanceRecord) {
    setRecords((current) => {
      if (current === null) return [record];
      return current.some((item) => item.id === record.id)
        ? current.map((item) => (item.id === record.id ? record : item))
        : [...current, record];
    });
  }

  const loadRecords = useCallback(
    async (preserveConfirmed = false) => {
      setError(null);
      try {
        setRecords(await client.request<FinanceRecord[]>('/finance/records'));
      } catch (caught) {
        if (!preserveConfirmed) setRecords(null);
        setError(caught);
      }
    },
    [client],
  );

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  async function runAction(
    record: FinanceRecord,
    success: string,
    operation: () => Promise<FinanceRecord>,
  ): Promise<boolean> {
    setBusyId(record.id);
    setFormError('');
    setFeedback('');
    try {
      const confirmed = await operation();
      replaceConfirmed(confirmed);
      await loadRecords(true);
      setFeedback(success);
      return true;
    } catch (caught) {
      setFormError(`${errorMessage(caught)}；页面保留服务端已确认状态`);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function createRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validated = validateDraft(createDraft);
    if (typeof validated === 'string') {
      setFormError(validated);
      return;
    }
    if (!permitted(user, 'finance.record.create', validated.scope)) {
      setFormError('你没有在该范围创建财务记录的权限');
      return;
    }
    setBusyId('new');
    setFormError('');
    setFeedback('');
    try {
      const confirmed = await client.request<FinanceRecord>('/finance/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: createDraft.title.trim(),
          kind: createDraft.kind,
          amountCents: validated.amountCents,
          activityId: createDraft.activityId.trim() || null,
          status: 'draft',
          ...(createDraft.organizationId.trim()
            ? { organizationId: createDraft.organizationId.trim() }
            : {}),
          scope: validated.scope,
        }),
      });
      replaceConfirmed(confirmed);
      await loadRecords(true);
      setCreateDraft({ ...emptyDraft, organizationId: defaultOrganizationId });
      setFeedback('财务草稿已创建');
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  function beginEdit(record: FinanceRecord) {
    setEditingId(record.id);
    setEditDraft(draftFromRecord(record));
    setFormError('');
    setFeedback('');
  }

  async function saveEdit(record: FinanceRecord, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editDraft === null) return;
    const validated = validateDraft(editDraft);
    if (typeof validated === 'string') {
      setFormError(validated);
      return;
    }
    const canMove =
      permitted(user, 'finance.record.update', record.scope) &&
      permitted(user, 'finance.record.update', validated.scope);
    const canEditOwn =
      record.ownerUid === user?.uid &&
      permitted(user, 'finance.record.create', record.scope) &&
      permitted(user, 'finance.record.create', validated.scope);
    if (!canMove && !canEditOwn) {
      setFormError('你没有修改当前范围或目标范围的权限');
      return;
    }
    const saved = await runAction(record, '财务草稿已更新', () =>
      client.request<FinanceRecord>('/finance/records', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: record.id,
          title: editDraft.title.trim(),
          kind: editDraft.kind,
          amountCents: validated.amountCents,
          activityId: editDraft.activityId.trim() || null,
          ...(editDraft.organizationId.trim()
            ? { organizationId: editDraft.organizationId.trim() }
            : {}),
          scope: validated.scope,
        }),
      }),
    );
    if (saved) {
      setEditingId(null);
      setEditDraft(null);
    }
  }

  function canMaintainRecord(record: FinanceRecord): boolean {
    return (
      permitted(user, 'finance.record.update', record.scope) ||
      (record.ownerUid === user?.uid && permitted(user, 'finance.record.create', record.scope))
    );
  }

  function canRunTransition(record: FinanceRecord, to: FinanceStatus): boolean {
    if (to === 'approved' || to === 'rejected') {
      return canReviewFinance(user) || permitted(user, 'finance.record.approve', record.scope);
    }
    if (to === 'archived') return permitted(user, 'finance.record.update', record.scope);
    if (to === 'submitted' || to === 'draft') return canMaintainRecord(record);
    return false;
  }

  async function transition(record: FinanceRecord, to: FinanceStatus, success: string) {
    if (!canRunTransition(record, to)) {
      setFeedback('');
      setFormError('权限已失效或不适用于该记录');
      return;
    }
    const reviewDecision = to === 'approved' || to === 'rejected' ? to : null;
    const dedicatedReview = reviewDecision !== null && canReviewFinance(user);
    await runAction(record, success, () =>
      client.request<FinanceRecord>(
        dedicatedReview
          ? `/finance/records/${encodeURIComponent(record.id)}/reviews`
          : `/finance/records/${encodeURIComponent(record.id)}/transitions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dedicatedReview ? { decision: reviewDecision } : { to }),
        },
      ),
    );
  }

  function fields(draft: FinanceDraft, setDraft: (draft: FinanceDraft) => void, prefix: string) {
    const activityLinked = draft.activityId.trim().length > 0;
    const organizationScoped = !activityLinked && draft.organizationId.trim().length > 0;
    return (
      <>
        <label>
          {prefix}记录标题
          <input
            aria-label={`${prefix}记录标题`}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <label>
          {prefix}类型
          <select
            aria-label={`${prefix}类型`}
            value={draft.kind}
            onChange={(event) => setDraft({ ...draft, kind: event.target.value as FinanceKind })}
          >
            <option value="budget">预算</option>
            <option value="settlement">结算</option>
          </select>
        </label>
        <label>
          {prefix}金额（元）
          <input
            aria-label={`${prefix}金额（元）`}
            inputMode="decimal"
            value={draft.amount}
            onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
          />
        </label>
        {organizationIds.length > 0 ? (
          <label>
            {prefix}组织
            <select
              aria-label={`${prefix}组织`}
              value={draft.organizationId}
              onChange={(event) => setDraft({ ...draft, organizationId: event.target.value })}
            >
              <option value="">历史未归属</option>
              {organizationIds.map((organizationId) => (
                <option key={organizationId} value={organizationId}>
                  {organizationName(organizationId)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          {prefix}关联活动 ID（可选）
          <input
            aria-label={`${prefix}关联活动 ID（可选）`}
            value={draft.activityId}
            onChange={(event) => setDraft({ ...draft, activityId: event.target.value })}
          />
        </label>
        <label>
          {prefix}范围类型
          <input
            aria-label={`${prefix}范围类型`}
            value={
              activityLinked
                ? 'activity'
                : organizationScoped
                  ? 'social_organization'
                  : draft.scopeType
            }
            readOnly={activityLinked || organizationScoped}
            onChange={(event) => setDraft({ ...draft, scopeType: event.target.value })}
          />
        </label>
        <label>
          {prefix}范围标识
          <input
            aria-label={`${prefix}范围标识`}
            value={
              activityLinked
                ? draft.activityId
                : organizationScoped
                  ? draft.organizationId
                  : draft.scopeId
            }
            readOnly={activityLinked || organizationScoped}
            onChange={(event) => setDraft({ ...draft, scopeId: event.target.value })}
          />
        </label>
      </>
    );
  }

  const canCreateAtCurrentScope = permitted(
    user,
    'finance.record.create',
    scopeFromDraft(createDraft),
  );
  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    return (records ?? []).filter(
      (record) =>
        (!statusFilter || record.status === statusFilter) &&
        (!normalizedQuery ||
          [
            record.title,
            record.activityId ?? '',
            organizationName(record.organizationId),
            record.scope.type,
            record.scope.id,
          ].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedQuery))),
    );
  }, [query, records, statusFilter]);
  const budgetSummaries = useMemo(() => {
    const available = records ?? [];
    const memberships = memberOrganizationIds(user);
    const globalViewer =
      user?.roles.includes('platform.super_admin') ||
      user?.roles.includes('affiliation.tuanwei_lead');
    const recordOrganizations = [
      ...new Set(
        available.flatMap((record) => (record.organizationId ? [record.organizationId] : [])),
      ),
    ];
    const organizationIdsForOverview = globalViewer
      ? recordOrganizations
      : memberships.length > 0
        ? memberships
        : recordOrganizations;
    return organizationIdsForOverview.map((organizationId) =>
      summarizeOrganization(available, organizationId),
    );
  }, [records, user]);

  if (error !== null && statusOf(error) === 403) {
    return (
      <section className="module-page finance-page" aria-label="财务治理">
        <ModulePageHeader title="财务治理" description="查看组织预算、结算与审批进展。" />
        <AsyncState
          state="error"
          title="暂无财务访问权限"
          description="财务信息只对获得明确授权的同学开放。"
        />
      </section>
    );
  }

  return (
    <section className="module-page finance-page" aria-label="财务治理">
      <ModulePageHeader
        title="财务治理"
        description="先看清部门可用预算，再处理申请、结算与审批。"
      />

      {records !== null && budgetSummaries.length > 0 ? (
        <section className="finance-budget-overview" aria-label="部门预算概览">
          <header>
            <div>
              <span>DEPARTMENT BUDGET</span>
              <h3>部门预算一目了然</h3>
            </div>
            <p>余额按已批准预算减去已批准结算计算，审批中的支出单独列出。</p>
          </header>
          <div className="finance-budget-grid">
            {budgetSummaries.map((summary) => (
              <article
                className="finance-budget-card"
                key={summary.organizationId}
                role="region"
                aria-label={`${organizationName(summary.organizationId)}预算概览`}
              >
                <div className="finance-budget-card__heading">
                  <span>{organizationName(summary.organizationId)}</span>
                  <small>本部门</small>
                </div>
                <div className="finance-budget-remaining">
                  <span>剩余预算</span>
                  <strong>{formatAmount(summary.remaining)}</strong>
                </div>
                <div
                  className="finance-budget-progress"
                  role="progressbar"
                  aria-label={`${organizationName(summary.organizationId)}预算使用进度`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={summary.usagePercent}
                >
                  <i style={{ width: `${summary.usagePercent}%` }} />
                </div>
                <dl>
                  <div>
                    <dt>已批预算</dt>
                    <dd>{formatAmount(summary.approvedBudget)}</dd>
                  </div>
                  <div>
                    <dt>已使用</dt>
                    <dd>{formatAmount(summary.spent)}</dd>
                  </div>
                  <div>
                    <dt>审批中</dt>
                    <dd>{formatAmount(summary.pending)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <FilterBar
        className="finance-filter"
        ariaLabel="筛选财务记录"
        onSubmit={(event) => event.preventDefault()}
      >
        <label>
          搜索财务记录
          <input
            type="search"
            value={query}
            placeholder="标题、组织、活动或范围"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label>
          记录状态
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.currentTarget.value as FinanceStatus | '')}
          >
            <option value="">全部状态</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </FilterBar>

      {feedback ? <p role="status">{feedback}</p> : null}
      {formError ? <p role="alert">{formError}</p> : null}

      <div className="content-grid finance-content">
        <section className="panel finance-record-panel" aria-labelledby="finance-list-title">
          <h3 id="finance-list-title">财务记录</h3>
          <ResponsiveRecordList
            ariaLabel="财务记录"
            records={visibleRecords}
            state={error !== null ? 'error' : records === null ? 'loading' : 'ready'}
            errorMessage="财务记录加载失败，请稍后重试。"
            emptyTitle={records?.length === 0 ? '暂无财务记录' : '没有匹配的财务记录'}
            emptyDescription={
              records?.length === 0
                ? '创建第一条预算或结算草稿后会显示在这里。'
                : '请调整关键词或状态筛选后再试。'
            }
            getKey={(record) => record.id}
            renderRecord={(record) => {
              const canUpdate = permitted(user, 'finance.record.update', record.scope);
              const canMaintain = canMaintainRecord(record);
              const canApprove =
                canReviewFinance(user) || permitted(user, 'finance.record.approve', record.scope);
              const busy = busyId === record.id;
              const editing = editingId === record.id && editDraft !== null;
              return (
                <article className="finance-record" aria-labelledby={`finance-${record.id}-title`}>
                  <header>
                    <div>
                      <h4 id={`finance-${record.id}-title`}>{record.title}</h4>
                      <p>{record.kind === 'budget' ? '预算' : '结算'}</p>
                    </div>
                    <div className="finance-record-summary">
                      <StatusBadge status={statusTones[record.status]}>
                        {statusLabels[record.status]}
                      </StatusBadge>
                      <strong>{formatAmount(record.amountCents)}</strong>
                    </div>
                  </header>
                  <div className="finance-record-meta">
                    <p>组织：{organizationName(record.organizationId)}</p>
                    <p>关联活动：{record.activityId ?? '无'}</p>
                    <p>
                      范围：{record.scope.type}/{record.scope.id}
                    </p>
                    <p>
                      审核：
                      {record.reviewDecision
                        ? `${statusLabels[record.reviewDecision]} · ${record.reviewerUid ?? '未知审核人'}${record.reviewedAt ? ` · ${record.reviewedAt}` : ''}`
                        : '待审核'}
                    </p>
                  </div>

                  {editing ? (
                    <form onSubmit={(event) => void saveEdit(record, event)}>
                      {fields(editDraft, setEditDraft, '编辑')}
                      <button type="submit" disabled={busy}>
                        保存修改
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft(null);
                        }}
                      >
                        取消编辑
                      </button>
                    </form>
                  ) : record.status === 'draft' && canMaintain ? (
                    <button
                      type="button"
                      aria-label={`编辑 ${record.title}`}
                      onClick={() => beginEdit(record)}
                    >
                      编辑
                    </button>
                  ) : null}

                  <div className="action-row module-page-actions">
                    {record.status === 'draft' && canMaintain ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void transition(record, 'submitted', '财务记录已提交审批')}
                      >
                        提交审批
                      </button>
                    ) : null}
                    {record.status === 'submitted' && canApprove ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void transition(record, 'approved', '财务记录已批准')}
                        >
                          批准
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void transition(record, 'rejected', '财务记录已驳回')}
                        >
                          驳回
                        </button>
                      </>
                    ) : null}
                    {record.status === 'rejected' && canMaintain ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void transition(record, 'draft', '财务记录已退回草稿')}
                      >
                        退回草稿
                      </button>
                    ) : null}
                    {(record.status === 'approved' || record.status === 'rejected') && canUpdate ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void transition(record, 'archived', '财务记录已归档')}
                      >
                        归档
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            }}
          />
        </section>

        {hasAnyGrant(user, 'finance.record.create') ? (
          <section className="panel finance-create-panel" aria-labelledby="finance-form-title">
            <h3 id="finance-form-title">创建财务草稿</h3>
            <p>先保存草稿，确认金额与归属后再提交审批。</p>
            <form className="finance-draft-form" onSubmit={createRecord}>
              {fields(createDraft, setCreateDraft, '')}
              <button type="submit" disabled={busyId === 'new' || !canCreateAtCurrentScope}>
                {busyId === 'new' ? '正在创建…' : '保存草稿'}
              </button>
            </form>
          </section>
        ) : null}
      </div>
    </section>
  );
}
