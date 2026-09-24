import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import type { UserContext } from '@freebbs-development/contracts';
import { ApiError, type ApiClient } from '../../core/api/client.js';

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

interface ProposalPoolProps {
  client: Pick<ApiClient, 'request'>;
  user?: UserContext | null;
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

function isPublicProposal(value: unknown): value is PublicProposal {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PublicProposal>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.problemDescription === 'string' &&
    typeof candidate.proposedSolution === 'string' &&
    typeof candidate.category === 'string' &&
    typeof candidate.publicProgress === 'string' &&
    (candidate.dueAt === null || typeof candidate.dueAt === 'string') &&
    statuses.includes(candidate.status as ProposalStatus)
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function ProposalPool({ client }: ProposalPoolProps) {
  const [proposals, setProposals] = useState<PublicProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [problemDescription, setProblemDescription] = useState('');
  const [proposedSolution, setProposedSolution] = useState('');
  const [category, setCategory] = useState('');

  const loadProposals = useCallback(async () => {
    try {
      const loaded = await client.request<unknown[]>('/information/proposals');
      setProposals(loaded.filter(isPublicProposal));
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  async function submitProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = {
      title: title.trim(),
      problemDescription: problemDescription.trim(),
      proposedSolution: proposedSolution.trim(),
      category: category.trim(),
    };
    if (Object.values(input).some((value) => !value)) {
      setError('请完整填写提案标题、问题描述、建议方案和类别');
      return;
    }
    setPending(true);
    setError(null);
    setFeedback(null);
    try {
      await client.request<PublicProposal>('/information/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      setTitle('');
      setProblemDescription('');
      setProposedSolution('');
      setCategory('');
      setFeedback('提案已提交');
      await loadProposals();
    } catch (caught) {
      setError(errorMessage(caught, '提案提交失败，请稍后重试'));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="proposal-pool-heading">
      <header className="page-section-header">
        <div>
          <h2 id="proposal-pool-heading">公开提案池</h2>
          <p>公开查看问题、建议方案和推进进展；权益发展中心负责后台维护。</p>
        </div>
      </header>
      {loading ? <p role="status">正在加载提案池…</p> : null}
      {!loading && unavailable ? <p>提案池暂时无法加载。</p> : null}
      {!loading && !unavailable ? (
        <div className="table-scroll">
          <table aria-label="公开提案池">
            <thead>
              <tr>
                <th>提案</th>
                <th>类别</th>
                <th>状态</th>
                <th>公开进展</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {proposals.length === 0 ? (
                <tr>
                  <td colSpan={5}>当前还没有公开提案。</td>
                </tr>
              ) : null}
              {proposals.map((proposal) => (
                <tr key={proposal.id}>
                  <td>{proposal.title}</td>
                  <td>{proposal.category}</td>
                  <td>{statusLabels[proposal.status]}</td>
                  <td>{proposal.publicProgress}</td>
                  <td>
                    <Link
                      aria-label={`查看 ${proposal.title}`}
                      to={`/information/proposals/${encodeURIComponent(proposal.id)}`}
                    >
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <section aria-labelledby="proposal-submit-heading">
        <h3 id="proposal-submit-heading">提交提案</h3>
        <form onSubmit={submitProposal} noValidate>
          <label>
            提案标题
            <input
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            问题描述
            <textarea
              value={problemDescription}
              maxLength={20000}
              onChange={(event) => setProblemDescription(event.target.value)}
            />
          </label>
          <label>
            建议方案
            <textarea
              value={proposedSolution}
              maxLength={20000}
              onChange={(event) => setProposedSolution(event.target.value)}
            />
          </label>
          <label>
            提案类别
            <input
              value={category}
              maxLength={80}
              onChange={(event) => setCategory(event.target.value)}
            />
          </label>
          <button type="submit" disabled={pending}>
            提交提案
          </button>
        </form>
      </section>
      {feedback ? <p role="status">{feedback}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
