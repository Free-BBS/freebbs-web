import type { ScopeRef, UserContext } from '@freebbs-development/contracts';

export type LiaisonProblemStatus =
  'draft' | 'pending_review' | 'rejected' | 'open' | 'paused' | 'closed' | 'archived';

export interface LiaisonPolicy {
  action: string;
  resource: string;
  effect?: 'allow' | 'deny';
  scope?: ScopeRef;
  expiresAt?: string | null;
}

export type LiaisonUser = UserContext & { policies?: readonly LiaisonPolicy[] };

export interface LiaisonProblem {
  id: string;
  title: string;
  summary: string;
  background: string;
  sourceType: 'lab' | 'company' | 'campus' | 'other';
  sourceName: string;
  tags: string[];
  expectedOutcome: string;
  constraints: string;
  startsAt: string | null;
  deadline: string | null;
  publicContact: string;
  internalContactNote?: string;
  recorderUid?: string;
  reviewerUid?: string | null;
  reviewedAt?: string | null;
  status: LiaisonProblemStatus;
  ownerUid?: string;
  scope?: ScopeRef;
  createdAt: string;
  updatedAt: string;
}

export interface LiaisonTeamMember {
  id: string;
  problemId: string;
  teamId: string;
  memberUid: string;
  role: 'maintainer' | 'member';
  joinedAt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LiaisonTeam {
  id: string;
  problemId: string;
  name: string;
  proposal: string;
  maintainerUid: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  members: LiaisonTeamMember[];
}

export interface LiaisonPost {
  id: string;
  problemId: string;
  teamId: string | null;
  authorUid: string;
  kind: 'discussion' | 'progress';
  body: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LiaisonOutcome {
  id: string;
  problemId: string;
  teamId: string;
  version: number;
  title: string;
  description: string;
  linkUrl: string | null;
  attachmentRef: string | null;
  submittedAt: string;
  adoptedAt: string | null;
  adoptedByUid: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProblemPage {
  items: Array<LiaisonProblem & { teamCount: number }>;
  page: number;
  pageSize: number;
  total: number;
}

export const problemStatusLabels: Record<LiaisonProblemStatus, string> = {
  draft: '草稿',
  pending_review: '待审核',
  rejected: '待修改',
  open: '进行中',
  paused: '已暂停',
  closed: '已结项',
  archived: '已归档',
};

export const sourceTypeLabels: Record<LiaisonProblem['sourceType'], string> = {
  lab: '课题组',
  company: '企业',
  campus: '校内单位',
  other: '其他来源',
};

function matches(pattern: string, value: string): boolean {
  return (
    pattern === '*' ||
    pattern === value ||
    (pattern.endsWith('.*') && value.startsWith(pattern.slice(0, -1)))
  );
}

export function hasLiaisonPermission(
  user: LiaisonUser | null | undefined,
  action: string,
  resource: 'liaison_problem' | 'liaison_outcome',
  scopes: readonly ScopeRef[] = [],
): boolean {
  if (!user) return false;
  const now = Date.now();
  const applies = (policy: LiaisonPolicy, scope?: ScopeRef) =>
    matches(policy.action, action) &&
    matches(policy.resource, resource) &&
    (policy.expiresAt == null || Date.parse(policy.expiresAt) > now) &&
    (policy.scope === undefined ||
      (scope !== undefined &&
        policy.scope.type === scope.type &&
        (policy.scope.id === '*' || policy.scope.id === scope.id)));
  const decide = (scope?: ScopeRef) => {
    const policies = (user.policies ?? []).filter((policy) => applies(policy, scope));
    if (policies.some(({ effect }) => effect === 'deny')) return false;
    return policies.some(({ effect }) => effect !== 'deny');
  };
  return scopes.length === 0 ? decide() : scopes.every((scope) => decide(scope));
}

export function problemScope(problemId: string): ScopeRef {
  return { type: 'liaison_problem', id: problemId };
}

export function formatLiaisonDate(value: string | null): string {
  if (value === null) return '长期开放';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function statusTone(status: LiaisonProblemStatus) {
  if (status === 'open') return 'success' as const;
  if (status === 'pending_review' || status === 'paused') return 'warning' as const;
  return 'neutral' as const;
}

export function conciseText(value: string, limit = 160): string {
  const text = value.trim();
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
}
