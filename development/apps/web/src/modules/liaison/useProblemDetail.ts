import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, type ApiClient } from '../../core/api/client.js';
import type { OutcomeInput } from './OutcomePanel.js';
import type { ProblemInput } from './ProblemEditorDrawer.js';
import {
  hasLiaisonPermission,
  problemScope,
  type LiaisonOutcome,
  type LiaisonPost,
  type LiaisonProblem,
  type LiaisonProblemStatus,
  type LiaisonTeam,
  type LiaisonUser,
} from './model.js';

interface UseProblemDetailOptions {
  api: Pick<ApiClient, 'request'>;
  problemId: string;
  user: LiaisonUser | null;
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message.trim() ? error.message : fallback;
}

function publicProblem(value: LiaisonProblem): LiaisonProblem {
  return {
    id: value.id,
    title: value.title,
    summary: value.summary,
    background: value.background,
    sourceType: value.sourceType,
    sourceName: value.sourceName,
    tags: [...value.tags],
    expectedOutcome: value.expectedOutcome,
    constraints: value.constraints,
    startsAt: value.startsAt,
    deadline: value.deadline,
    publicContact: value.publicContact,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function useProblemDetail({ api, problemId, user }: UseProblemDetailOptions) {
  const [problem, setProblem] = useState<LiaisonProblem | null>(null);
  const [teams, setTeams] = useState<LiaisonTeam[]>([]);
  const [posts, setPosts] = useState<LiaisonPost[]>([]);
  const [outcomes, setOutcomes] = useState<LiaisonOutcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const scope = problemScope(problemId);
  const canJoin = hasLiaisonPermission(user, 'liaison.problem.join', 'liaison_problem', [scope]);
  const canPost = hasLiaisonPermission(user, 'liaison.problem.post', 'liaison_problem', [scope]);
  const canUpdate = hasLiaisonPermission(user, 'liaison.problem.update', 'liaison_problem', [
    scope,
  ]);
  const canSubmitReview = hasLiaisonPermission(
    user,
    'liaison.problem.submit_review',
    'liaison_problem',
    [scope],
  );
  const canReview = hasLiaisonPermission(user, 'liaison.problem.review', 'liaison_problem', [
    scope,
  ]);
  const canSubmitOutcome = hasLiaisonPermission(
    user,
    'liaison.problem.outcome.submit',
    'liaison_outcome',
    [scope],
  );
  const canManageOutcome = hasLiaisonPermission(
    user,
    'liaison.problem.outcome.manage',
    'liaison_outcome',
    [scope],
  );

  const keepSensitiveForMaintainer = useCallback(
    (loaded: LiaisonProblem) => {
      const projected = publicProblem(loaded);
      if (canUpdate && typeof loaded.internalContactNote === 'string') {
        projected.internalContactNote = loaded.internalContactNote;
      }
      return projected;
    },
    [canUpdate],
  );

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setLoadError(null);
    setActionError(null);
    setFeedback(null);
    setProblem(null);
    setTeams([]);
    setPosts([]);
    setOutcomes([]);
    try {
      const base = `/liaison/problems/${encodeURIComponent(problemId)}`;
      const [loadedProblem, loadedTeams, loadedPosts, loadedOutcomes] = await Promise.all([
        api.request<LiaisonProblem>(base),
        api.request<LiaisonTeam[]>(`${base}/teams`),
        api.request<LiaisonPost[]>(`${base}/posts`),
        api.request<LiaisonOutcome[]>(`${base}/outcomes`),
      ]);
      if (generation !== requestGeneration.current) return;
      setProblem(keepSensitiveForMaintainer(loadedProblem));
      setTeams(loadedTeams);
      setPosts(loadedPosts);
      setOutcomes(loadedOutcomes);
    } catch (error) {
      if (generation === requestGeneration.current) {
        setLoadError(message(error, '课题详情加载失败，请稍后重试'));
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [api, keepSensitiveForMaintainer, problemId]);

  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [load, user?.uid]);

  const run = useCallback(
    async <T>(key: string, operation: () => Promise<T>, failure: string): Promise<T | null> => {
      const generation = requestGeneration.current;
      setPending(key);
      setActionError(null);
      setFeedback(null);
      try {
        const result = await operation();
        return generation === requestGeneration.current ? result : null;
      } catch (error) {
        if (generation === requestGeneration.current) setActionError(message(error, failure));
        return null;
      } finally {
        if (generation === requestGeneration.current) setPending(null);
      }
    },
    [],
  );

  async function createTeam(input: { name: string; proposal: string }): Promise<boolean> {
    const created = await run(
      'team',
      () =>
        api.request<LiaisonTeam>(`/liaison/problems/${encodeURIComponent(problemId)}/teams`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      '参与课题失败，请重试',
    );
    if (created === null) return false;
    setTeams((current) => [...current, created]);
    setFeedback('已创建团队并参与课题');
    return true;
  }

  async function requestJoin(team: LiaisonTeam): Promise<void> {
    const membership = await run<LiaisonTeam['members'][number]>(
      `join:${team.id}`,
      () =>
        api.request(
          `/liaison/problems/${encodeURIComponent(problemId)}/teams/${encodeURIComponent(team.id)}/members`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'request' }),
          },
        ),
      '加入申请提交失败',
    );
    if (membership === null) return;
    setTeams((current) =>
      current.map((item) =>
        item.id === team.id ? { ...item, members: [...item.members, membership] } : item,
      ),
    );
    setFeedback(`已向“${team.name}”提交加入申请`);
  }

  async function confirmMembership(team: LiaisonTeam, memberUid: string): Promise<void> {
    const membership = await run<LiaisonTeam['members'][number]>(
      `confirm:${team.id}:${memberUid}`,
      () =>
        api.request<LiaisonTeam['members'][number]>(
          `/liaison/problems/${encodeURIComponent(problemId)}/teams/${encodeURIComponent(team.id)}/members`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'confirm', memberUid }),
          },
        ),
      '确认加入失败，请重试',
    );
    if (membership === null) return;
    setTeams((current) =>
      current.map((item) =>
        item.id === team.id
          ? {
              ...item,
              members: item.members.map((candidate) =>
                candidate.id === membership.id ? membership : candidate,
              ),
            }
          : item,
      ),
    );
    setFeedback(`已确认 ${memberUid} 加入`);
  }

  async function createPost(input: {
    teamId: string | null;
    kind: 'discussion' | 'progress';
    body: string;
  }): Promise<boolean> {
    const created = await run(
      'post',
      () =>
        api.request<LiaisonPost>(`/liaison/problems/${encodeURIComponent(problemId)}/posts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      '动态发布失败，请重试',
    );
    if (created === null) return false;
    setPosts((current) => [...current, created]);
    setFeedback(input.kind === 'progress' ? '团队进展已发布' : '讨论已发布');
    return true;
  }

  async function updatePost(postId: string, body: string): Promise<boolean> {
    const updated = await run(
      `post:${postId}`,
      () =>
        api.request<LiaisonPost>(
          `/liaison/problems/${encodeURIComponent(problemId)}/posts/${encodeURIComponent(postId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
          },
        ),
      '动态修改失败，请重试',
    );
    if (updated === null) return false;
    setPosts((current) => current.map((post) => (post.id === postId ? updated : post)));
    setFeedback('动态修改已保存');
    return true;
  }

  async function hidePost(postId: string): Promise<void> {
    const updated = await run(
      `post:${postId}`,
      () =>
        api.request<LiaisonPost>(
          `/liaison/problems/${encodeURIComponent(problemId)}/posts/${encodeURIComponent(postId)}/transitions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'hidden' }),
          },
        ),
      '动态隐藏失败，请重试',
    );
    if (updated === null) return;
    setPosts((current) => current.filter((post) => post.id !== postId));
    setFeedback('违规动态已隐藏');
  }

  async function removeMember(team: LiaisonTeam, memberUid: string): Promise<void> {
    const removed = await run(
      `member:${team.id}:${memberUid}`,
      () =>
        api.request<void>(
          `/liaison/problems/${encodeURIComponent(problemId)}/teams/${encodeURIComponent(team.id)}/members/${encodeURIComponent(memberUid)}`,
          { method: 'DELETE' },
        ),
      '成员移除失败，请重试',
    );
    if (removed === null) return;
    setTeams((current) =>
      current.map((candidate) =>
        candidate.id === team.id
          ? {
              ...candidate,
              members: candidate.members.filter((member) => member.memberUid !== memberUid),
            }
          : candidate,
      ),
    );
    setFeedback(`已移除成员 ${memberUid}`);
  }

  async function submitOutcome(input: OutcomeInput): Promise<boolean> {
    const created = await run(
      'outcome',
      () =>
        api.request<LiaisonOutcome>(`/liaison/problems/${encodeURIComponent(problemId)}/outcomes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      '成果提交失败，请重试',
    );
    if (created === null) return false;
    setOutcomes((current) => [...current, created]);
    setFeedback('成果版本已提交');
    return true;
  }

  async function adoptOutcome(outcomeId: string) {
    const updated = await run(
      `outcome:${outcomeId}`,
      () =>
        api.request<LiaisonOutcome>(
          `/liaison/problems/${encodeURIComponent(problemId)}/outcomes/${encodeURIComponent(outcomeId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'adopted' }),
          },
        ),
      '成果状态更新失败',
    );
    if (updated === null) return;
    setOutcomes((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setFeedback('成果已标记为采纳，课题保持当前状态');
  }

  async function saveProblem(input: ProblemInput): Promise<boolean> {
    if (!problem) return false;
    const updated = await run(
      'edit',
      () =>
        api.request<LiaisonProblem>(`/liaison/problems/${encodeURIComponent(problem.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      '课题保存失败，请重试',
    );
    if (updated === null) return false;
    setProblem(keepSensitiveForMaintainer(updated));
    setFeedback('课题信息已保存');
    return true;
  }

  async function review(decision: 'approve' | 'reject') {
    if (!problem) return;
    const updated = await run(
      'review',
      () =>
        api.request<LiaisonProblem>(`/liaison/problems/${encodeURIComponent(problem.id)}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, note: null }),
        }),
      '审核失败，请重试',
    );
    if (updated === null) return;
    setProblem(keepSensitiveForMaintainer(updated));
    setFeedback(decision === 'approve' ? '课题已批准发布' : '课题已驳回修改');
  }

  async function transition(to: LiaisonProblemStatus) {
    if (!problem) return;
    const updated = await run(
      'transition',
      () =>
        api.request<LiaisonProblem>(
          `/liaison/problems/${encodeURIComponent(problem.id)}/transitions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to }),
          },
        ),
      '课题状态更新失败，请重试',
    );
    if (updated === null) return;
    setProblem(keepSensitiveForMaintainer(updated));
    const labels: Partial<Record<LiaisonProblemStatus, string>> = {
      draft: '课题已恢复为草稿',
      pending_review: '课题已提交审核',
      open: '课题已重新开放',
      paused: '课题已暂停',
      closed: '课题已结项',
      archived: '课题已归档',
    };
    setFeedback(labels[to] ?? '课题状态已更新');
  }

  return {
    problem,
    teams,
    posts,
    outcomes,
    loading,
    loadError,
    actionError,
    feedback,
    pending,
    canJoin,
    canPost,
    canUpdate,
    canSubmitReview,
    canReview,
    canSubmitOutcome,
    canManageOutcome,
    load,
    createTeam,
    requestJoin,
    confirmMembership,
    createPost,
    updatePost,
    hidePost,
    removeMember,
    submitOutcome,
    adoptOutcome,
    saveProblem,
    review,
    transition,
  };
}
