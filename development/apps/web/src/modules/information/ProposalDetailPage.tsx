import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import type { ScopeRef, UserContext } from '@freebbs-development/contracts';
import { EditorDrawer } from '../../components/EditorDrawer.js';
import { ApiError, createApiClient, type ApiClient } from '../../core/api/client.js';

type ProposalStatus =
  'submitted' | 'reviewing' | 'researching' | 'advancing' | 'resolved' | 'closed';

interface PublicProposal {
  id: string;
  title: string;
  problemDescription: string;
  proposedSolution: string;
  category: string;
  submitterUid: string;
  assigneeUid: string | null;
  dueAt: string | null;
  publicProgress: string;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
}

interface MaintenanceProposal extends PublicProposal {
  internalNote: string;
}

type ProposalUser = UserContext & {
  policies?: readonly { action: string; effect?: 'allow' | 'deny'; scope?: ScopeRef }[];
};

export interface ProposalDetailPageProps {
  client?: Pick<ApiClient, 'request'>;
  proposalId: string;
  user?: ProposalUser | null;
}

const statuses: readonly ProposalStatus[] = [
  'submitted',
  'reviewing',
  'researching',
  'advancing',
  'resolved',
  'closed',
];
const statusLabels: Record<ProposalStatus, string> = {
  submitted: '已提交',
  reviewing: '审核中',
  researching: '调研中',
  advancing: '推进中',
  resolved: '已解决',
  closed: '已关闭',
};

function matches(pattern: string, permission: string): boolean {
  return (
    pattern === '*' ||
    pattern === permission ||
    (pattern.endsWith('.*') && permission.startsWith(pattern.slice(0, -1)))
  );
}

function canMaintain(user: ProposalUser | null | undefined): boolean {
  if (user?.roles.includes('platform.super_admin')) return true;
  const policies = (user?.policies ?? []).filter((policy) =>
    matches(policy.action, 'information.proposal.manage'),
  );
  return (
    !policies.some((policy) => policy.effect === 'deny') &&
    policies.some((policy) => policy.effect !== 'deny')
  );
}

function isPublicProposal(value: unknown): value is PublicProposal {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PublicProposal>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.problemDescription === 'string' &&
    typeof candidate.proposedSolution === 'string' &&
    typeof candidate.category === 'string' &&
    typeof candidate.submitterUid === 'string' &&
    (candidate.assigneeUid === null || typeof candidate.assigneeUid === 'string') &&
    typeof candidate.publicProgress === 'string' &&
    (candidate.dueAt === null || typeof candidate.dueAt === 'string') &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    statuses.includes(candidate.status as ProposalStatus)
  );
}

function projectPublicProposal(proposal: PublicProposal): PublicProposal {
  return {
    id: proposal.id,
    title: proposal.title,
    problemDescription: proposal.problemDescription,
    proposedSolution: proposal.proposedSolution,
    category: proposal.category,
    submitterUid: proposal.submitterUid,
    assigneeUid: proposal.assigneeUid,
    dueAt: proposal.dueAt,
    publicProgress: proposal.publicProgress,
    status: proposal.status,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

function isMaintenanceProposal(value: unknown): value is MaintenanceProposal {
  if (!isPublicProposal(value) || !('internalNote' in value)) return false;
  return typeof value.internalNote === 'string';
}

function padded(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

export function utcInstantToLocalDateTimeInput(value: string | null): string {
  if (value === null) return '';
  const instant = new Date(value);
  return `${instant.getFullYear()}-${padded(instant.getMonth() + 1)}-${padded(instant.getDate())}T${padded(instant.getHours())}:${padded(instant.getMinutes())}:${padded(instant.getSeconds())}.${padded(instant.getMilliseconds(), 3)}`;
}

export function localDateTimeInputToUtcInstant(value: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
    value,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0', milliseconds = '0'] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(milliseconds.padEnd(3, '0')),
  ).toISOString();
}

function dueDate(value: string | null): string {
  return value === null ? '尚未设定' : formatProposalDueDate(value);
}

export function formatProposalDueDate(value: string, timeZone?: string): string {
  const values = new Map(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(value))
      .map(({ type, value: part }) => [type, part]),
  );
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

export function ProposalDetailPage({ client, proposalId, user }: ProposalDetailPageProps) {
  const defaultClient = useMemo(createApiClient, []);
  const api = client ?? defaultClient;
  const maintenance = canMaintain(user);
  const [proposal, setProposal] = useState<PublicProposal | null>(null);
  const [internalNote, setInternalNote] = useState('');
  const [status, setStatus] = useState<ProposalStatus>('submitted');
  const [assigneeUid, setAssigneeUid] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [publicProgress, setPublicProgress] = useState('');
  const [category, setCategory] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const requestGeneration = useRef(0);

  const applyProposal = useCallback(
    (loaded: unknown) => {
      if (!isPublicProposal(loaded)) throw new Error('Invalid proposal response');
      const publicProposal = projectPublicProposal(loaded);
      setProposal(publicProposal);
      setStatus(publicProposal.status);
      setAssigneeUid(publicProposal.assigneeUid ?? '');
      setDueAt(utcInstantToLocalDateTimeInput(publicProposal.dueAt));
      setPublicProgress(publicProposal.publicProgress);
      setCategory(publicProposal.category);
      setInternalNote(maintenance && isMaintenanceProposal(loaded) ? loaded.internalNote : '');
    },
    [maintenance],
  );

  const loadProposal = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoadError(null);
    setProposal(null);
    setDrawerOpen(false);
    setPending(false);
    setMutationError(null);
    setFeedback(null);
    setInternalNote('');
    try {
      const loaded = await api.request<unknown>(
        `/information/proposals/${encodeURIComponent(proposalId)}`,
      );
      if (generation !== requestGeneration.current) return;
      applyProposal(loaded);
    } catch (caught) {
      if (generation === requestGeneration.current) {
        setLoadError(caught instanceof ApiError ? caught.message : '提案详情加载失败，请稍后重试');
      }
    }
  }, [api, applyProposal, proposalId]);

  useEffect(() => {
    void loadProposal();
  }, [loadProposal]);

  async function saveMaintenance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (proposal === null || !maintenance) return;
    const generation = requestGeneration.current;
    setPending(true);
    setMutationError(null);
    setFeedback(null);
    try {
      const updated = await api.request<unknown>(`/information/proposals/${proposal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: category.trim(),
          status,
          assigneeUid: assigneeUid.trim() || null,
          dueAt: localDateTimeInputToUtcInstant(dueAt),
          publicProgress: publicProgress.trim(),
          internalNote: internalNote.trim(),
        }),
      });
      if (generation !== requestGeneration.current) return;
      applyProposal(updated);
      setFeedback('提案维护信息已保存');
    } catch (caught) {
      if (generation === requestGeneration.current) {
        setMutationError(
          caught instanceof ApiError ? caught.message : '提案维护信息保存失败，请稍后重试',
        );
      }
    } finally {
      if (generation === requestGeneration.current) setPending(false);
    }
  }

  if (loadError !== null && proposal === null) return <p role="alert">{loadError}</p>;
  if (proposal === null) return <p role="status">正在加载提案详情…</p>;

  return (
    <section aria-labelledby="proposal-detail-title">
      <Link to="/information/proposals">← 返回提案池</Link>
      <div className="proposal-detail-layout">
        <article>
          <header className="page-section-header">
            <div>
              <span>{proposal.category}</span>
              <h2 id="proposal-detail-title">{proposal.title}</h2>
              <p>{statusLabels[proposal.status]}</p>
            </div>
          </header>
          <h3>问题描述</h3>
          <p>{proposal.problemDescription}</p>
          <h3>建议方案</h3>
          <p>{proposal.proposedSolution}</p>
          <h3>公开进展</h3>
          <p>{proposal.publicProgress}</p>
          <section aria-labelledby="proposal-timeline-title">
            <h3 id="proposal-timeline-title">提案进展</h3>
            <ol aria-label="提案进展时间线">
              <li>当前状态：{statusLabels[proposal.status]}</li>
              <li>公开进展：{proposal.publicProgress}</li>
              <li>负责人：{proposal.assigneeUid ?? '尚未分派'}</li>
              <li>计划完成：{dueDate(proposal.dueAt)}</li>
            </ol>
          </section>
          {maintenance ? (
            <button type="button" onClick={() => setDrawerOpen(true)}>
              维护提案
            </button>
          ) : null}
        </article>
        {maintenance ? (
          <EditorDrawer
            open={drawerOpen}
            title="维护提案"
            description="仅权益发展中心维护人员可见的后台字段。"
            onClose={() => setDrawerOpen(false)}
          >
            <form onSubmit={saveMaintenance}>
              <label>
                提案类别
                <input
                  value={category}
                  maxLength={80}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </label>
              <label>
                提案状态
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as ProposalStatus)}
                >
                  {statuses.map((item) => (
                    <option key={item} value={item}>
                      {statusLabels[item]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                负责人 UID
                <input
                  value={assigneeUid}
                  maxLength={128}
                  onChange={(event) => setAssigneeUid(event.target.value)}
                />
              </label>
              <label>
                完成期限
                <input
                  type="datetime-local"
                  step="0.001"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </label>
              <label>
                公开进展
                <textarea
                  value={publicProgress}
                  maxLength={20000}
                  onChange={(event) => setPublicProgress(event.target.value)}
                />
              </label>
              <label>
                内部备注
                <textarea
                  value={internalNote}
                  maxLength={20000}
                  onChange={(event) => setInternalNote(event.target.value)}
                />
              </label>
              <button type="submit" disabled={pending}>
                保存提案维护信息
              </button>
              {feedback ? <p role="status">{feedback}</p> : null}
              {mutationError ? <p role="alert">{mutationError}</p> : null}
            </form>
          </EditorDrawer>
        ) : null}
      </div>
    </section>
  );
}
