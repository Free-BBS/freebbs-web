export type PermissionAction = '*' | `${string}.${string}`;

export interface ScopeRef {
  type: string;
  id: string;
}

export interface PermissionTag {
  key: string;
  scope?: ScopeRef;
  expiresAt?: string | null;
}

export const LIAISON_PROBLEM_PERMISSION_ACTIONS = [
  'liaison.problem.read',
  'liaison.problem.create',
  'liaison.problem.update',
  'liaison.problem.submit_review',
  'liaison.problem.review',
  'liaison.problem.join',
  'liaison.problem.post',
  'liaison.problem.outcome.submit',
  'liaison.problem.outcome.manage',
] as const;

export function validateTagScope(tag: string, scope: ScopeRef | undefined): boolean {
  if (tag !== 'sports.team_captain') {
    return true;
  }

  return scope?.type === 'sports_team' && scope.id.length > 0 && scope.id !== '*';
}
