import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { DetailSection } from '../../components/DetailSection.js';
import { EditorDrawer } from '../../components/EditorDrawer.js';
import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import { StatusBadge } from '../../components/StatusBadge.js';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import type { ScopeRef } from '@freebbs-development/contracts';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import { OutcomePanel } from './OutcomePanel.js';
import { ProblemCommunity } from './ProblemCommunity.js';
import { ProblemEditorDrawer } from './ProblemEditorDrawer.js';
import {
  formatLiaisonDate,
  hasLiaisonPermission,
  problemStatusLabels,
  sourceTypeLabels,
  statusTone,
  type LiaisonUser,
} from './model.js';
import { useProblemDetail } from './useProblemDetail.js';

export interface ProblemDetailPageProps {
  problemId: string;
  client?: Pick<ApiClient, 'request'>;
  user?: LiaisonUser | null;
}

export function ProblemDetailPage({
  problemId,
  client,
  user: suppliedUser,
}: ProblemDetailPageProps) {
  const defaultClient = useMemo(createApiClient, []);
  const api = client ?? defaultClient;
  const auth = useOptionalAuth();
  const user =
    suppliedUser === undefined ? ((auth?.user as LiaisonUser | null) ?? null) : suppliedUser;
  const detail = useProblemDetail({ api, problemId, user });
  const [joinOpen, setJoinOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [teamProposal, setTeamProposal] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamName.trim() || !teamProposal.trim()) {
      setJoinError('请填写团队名称和简短方案');
      return;
    }
    setJoinError(null);
    const saved = await detail.createTeam({ name: teamName.trim(), proposal: teamProposal.trim() });
    if (!saved) return;
    setTeamName('');
    setTeamProposal('');
    setJoinOpen(false);
  }

  if (detail.loading) return <p role="status">正在加载课题社区…</p>;
  if (detail.loadError || !detail.problem) {
    return (
      <section role="alert">
        <p>{detail.loadError ?? '课题不存在或不可访问'}</p>
        <button type="button" onClick={() => void detail.load()}>
          重试
        </button>
      </section>
    );
  }

  const { problem, teams, posts, outcomes } = detail;
  const isOpen = problem.status === 'open';
  return (
    <section className="module-page liaison-detail" aria-label="问题协作社区">
      <Link to="/liaison">← 返回问题榜</Link>
      <ModulePageHeader
        kicker={`${sourceTypeLabels[problem.sourceType]} · ${problem.sourceName}`}
        title={problem.title}
        description={problem.summary}
        actions={
          <>
            {isOpen && detail.canJoin ? (
              <button type="button" onClick={() => setJoinOpen(true)}>
                参与课题
              </button>
            ) : null}
            {detail.canUpdate ? (
              <button className="secondary-action" type="button" onClick={() => setEditOpen(true)}>
                编辑课题
              </button>
            ) : null}
            {problem.status === 'draft' && detail.canSubmitReview ? (
              <button
                className="secondary-action"
                type="button"
                disabled={detail.pending !== null}
                onClick={() => void detail.transition('pending_review')}
              >
                提交审核
              </button>
            ) : null}
            {problem.status === 'rejected' && detail.canUpdate ? (
              <button
                className="secondary-action"
                type="button"
                disabled={detail.pending !== null}
                onClick={() => void detail.transition('draft')}
              >
                恢复草稿
              </button>
            ) : null}
            {problem.status === 'pending_review' && detail.canReview ? (
              <>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={detail.pending !== null}
                  onClick={() => void detail.review('approve')}
                >
                  批准发布
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={detail.pending !== null}
                  onClick={() => void detail.review('reject')}
                >
                  驳回修改
                </button>
              </>
            ) : null}
            {problem.status === 'open' && detail.canUpdate ? (
              <>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={detail.pending !== null}
                  onClick={() => void detail.transition('paused')}
                >
                  暂停课题
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={detail.pending !== null}
                  onClick={() => void detail.transition('closed')}
                >
                  结项课题
                </button>
              </>
            ) : null}
            {problem.status === 'paused' && detail.canUpdate ? (
              <>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={detail.pending !== null}
                  onClick={() => void detail.transition('open')}
                >
                  重新开放
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={detail.pending !== null}
                  onClick={() => void detail.transition('closed')}
                >
                  结项课题
                </button>
              </>
            ) : null}
            {problem.status === 'closed' && detail.canUpdate ? (
              <button
                className="secondary-action"
                type="button"
                disabled={detail.pending !== null}
                onClick={() => void detail.transition('archived')}
              >
                归档课题
              </button>
            ) : null}
          </>
        }
      />
      <StatusBadge status={statusTone(problem.status)}>
        {problemStatusLabels[problem.status]}
      </StatusBadge>
      {detail.feedback ? <p role="status">{detail.feedback}</p> : null}
      {detail.actionError ? <p role="alert">{detail.actionError}</p> : null}

      <DetailSection title="课题简介" description="公开说明、边界和对接方式">
        <div className="liaison-brief-grid">
          <div>
            <h4>背景说明</h4>
            <p>{problem.background}</p>
          </div>
          <div>
            <h4>预期成果</h4>
            <p>{problem.expectedOutcome}</p>
          </div>
          <div>
            <h4>限制条件</h4>
            <p>{problem.constraints || '暂无额外限制'}</p>
          </div>
          <div>
            <h4>公开对接</h4>
            <p>{problem.publicContact}</p>
          </div>
          <div>
            <h4>课题周期</h4>
            <p>
              {formatLiaisonDate(problem.startsAt)} — {formatLiaisonDate(problem.deadline)}
            </p>
          </div>
        </div>
      </DetailSection>

      <DetailSection title="并行团队" description="同一问题允许多个团队采用不同方案并行探索。">
        {teams.length === 0 ? (
          <p>暂时还没有团队参与。</p>
        ) : (
          <ul className="liaison-team-list" aria-label="参与课题的团队">
            {teams.map((team) => {
              const membership = team.members.find(({ memberUid }) => memberUid === user?.uid);
              const canJoinTeam =
                detail.canJoin &&
                hasLiaisonPermission(user, 'liaison.problem.join', 'liaison_problem', [
                  { type: 'liaison_team', id: team.id },
                ]);
              const canConfirmMembers = isOpen && canJoinTeam && team.maintainerUid === user?.uid;
              const pendingMembers =
                team.maintainerUid === user?.uid
                  ? team.members.filter(({ status }) => status === 'pending')
                  : [];
              return (
                <li key={team.id}>
                  <div>
                    <strong>{team.name}</strong>
                    <p>{team.proposal}</p>
                    <small>
                      {team.members.filter(({ status }) => status === 'active').length} 名成员
                    </small>
                    {membership?.status === 'pending' ? (
                      <p className="liaison-membership-state">申请待确认</p>
                    ) : null}
                    {membership?.status === 'active' ? (
                      <p className="liaison-membership-state">已加入团队</p>
                    ) : null}
                    {pendingMembers.length > 0 ? (
                      <ul
                        className="liaison-pending-members"
                        aria-label={`${team.name} 待确认成员`}
                      >
                        {pendingMembers.map((candidate) => (
                          <li key={candidate.id}>
                            <span>{candidate.memberUid} 申请加入</span>
                            {canConfirmMembers ? (
                              <button
                                className="secondary-action"
                                type="button"
                                disabled={detail.pending !== null}
                                aria-label={`确认 ${candidate.memberUid} 加入`}
                                onClick={() =>
                                  void detail.confirmMembership(team, candidate.memberUid)
                                }
                              >
                                确认加入
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {team.maintainerUid === user?.uid && canJoinTeam
                      ? team.members
                          .filter(
                            (candidate) =>
                              candidate.status === 'active' && candidate.role !== 'maintainer',
                          )
                          .map((candidate) => (
                            <button
                              key={candidate.id}
                              className="secondary-action"
                              type="button"
                              disabled={detail.pending !== null}
                              aria-label={`移除成员：${candidate.memberUid}`}
                              onClick={() => void detail.removeMember(team, candidate.memberUid)}
                            >
                              移除 {candidate.memberUid}
                            </button>
                          ))
                      : null}
                  </div>
                  {isOpen && canJoinTeam && !membership ? (
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={detail.pending !== null}
                      onClick={() => void detail.requestJoin(team)}
                    >
                      申请加入
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </DetailSection>

      <ProblemCommunity
        posts={posts}
        teams={teams}
        currentUid={user?.uid ?? ''}
        canPost={detail.canPost && isOpen && user !== null}
        pending={detail.pending !== null}
        onPost={detail.createPost}
        canEdit={(post) => {
          const scopes: ScopeRef[] = [
            { type: 'liaison_problem', id: problem.id },
            ...(post.teamId ? [{ type: 'liaison_team', id: post.teamId }] : []),
          ];
          return (
            isOpen &&
            post.authorUid === user?.uid &&
            hasLiaisonPermission(user, 'liaison.problem.post', 'liaison_problem', scopes)
          );
        }}
        canHide={(post) => {
          const scopes: ScopeRef[] = [
            { type: 'liaison_problem', id: problem.id },
            ...(post.teamId ? [{ type: 'liaison_team', id: post.teamId }] : []),
          ];
          return hasLiaisonPermission(user, 'liaison.problem.update', 'liaison_problem', scopes);
        }}
        onEdit={detail.updatePost}
        onHide={detail.hidePost}
      />

      <OutcomePanel
        outcomes={outcomes}
        teams={teams}
        currentUid={user?.uid ?? ''}
        canSubmit={(team) =>
          detail.canSubmitOutcome &&
          (problem.status === 'open' || problem.status === 'paused') &&
          hasLiaisonPermission(user, 'liaison.problem.outcome.submit', 'liaison_outcome', [
            { type: 'liaison_problem', id: problem.id },
            { type: 'liaison_team', id: team.id },
          ])
        }
        canManage={(outcome) =>
          detail.canManageOutcome &&
          hasLiaisonPermission(user, 'liaison.problem.outcome.manage', 'liaison_outcome', [
            { type: 'liaison_problem', id: problem.id },
            { type: 'liaison_team', id: outcome.teamId },
            { type: 'liaison_outcome', id: outcome.id },
          ])
        }
        pending={detail.pending !== null}
        onSubmit={detail.submitOutcome}
        onAdopt={detail.adoptOutcome}
      />

      <EditorDrawer
        open={joinOpen}
        title="参与课题"
        description="可以创建新团队，或向现有团队提交加入申请。"
        onClose={() => setJoinOpen(false)}
      >
        <form onSubmit={createTeam} noValidate>
          <label>
            团队名称
            <input
              value={teamName}
              maxLength={255}
              onChange={(event) => setTeamName(event.target.value)}
            />
          </label>
          <label>
            简短方案
            <textarea
              value={teamProposal}
              maxLength={20000}
              onChange={(event) => setTeamProposal(event.target.value)}
            />
          </label>
          <button type="submit" disabled={detail.pending !== null}>
            创建并参与团队
          </button>
          {joinError ? <p role="alert">{joinError}</p> : null}
          {detail.actionError ? <p role="alert">{detail.actionError}</p> : null}
        </form>
      </EditorDrawer>
      {detail.canUpdate ? (
        <ProblemEditorDrawer
          open={editOpen}
          problem={problem}
          pending={detail.pending === 'edit'}
          error={detail.actionError}
          onClose={() => setEditOpen(false)}
          onSubmit={async (input) => {
            if (await detail.saveProblem(input)) setEditOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
