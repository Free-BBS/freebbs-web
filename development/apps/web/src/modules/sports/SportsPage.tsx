import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { ScopeRef, UserContext } from '@freebbs-development/contracts';
import { createApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import { SportsPictograms } from './SportsPictograms.js';

export interface DevelopmentApi {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

export type SportsTeamStatus = 'draft' | 'active' | 'archived';
export interface SportsTeamRecord {
  id: string;
  name: string;
  description: string;
  season: string;
  trainingSchedule: string;
  status: SportsTeamStatus;
  ownerUid?: string;
  scope: ScopeRef;
}

interface SportsPolicy {
  action: string;
  resource: string;
  effect?: 'allow' | 'deny';
  scope?: ScopeRef;
  expiresAt?: string | null;
}
export type SportsUser = UserContext & { policies?: readonly SportsPolicy[] };

export interface SportsPageProps {
  client?: DevelopmentApi;
  user?: SportsUser | null;
}

export const statusLabels: Record<SportsTeamStatus, string> = {
  draft: '筹备中',
  active: '活跃',
  archived: '已归档',
};

function matches(pattern: string, value: string): boolean {
  return (
    pattern === '*' ||
    pattern === value ||
    (pattern.endsWith('.*') && value.startsWith(pattern.slice(0, -1)))
  );
}

function sameScope(grant: ScopeRef | undefined, requested: ScopeRef | undefined): boolean {
  if (grant === undefined) return true;
  return requested !== undefined && grant.type === requested.type && grant.id === requested.id;
}

export function permitted(
  user: SportsUser | null,
  action: string,
  resource: 'sports_team' | 'sports_checkin' | 'sports_match' | 'sports_showcase',
  scope?: ScopeRef,
): boolean {
  if (user === null) return false;
  const now = Date.now();
  const matching = (user.policies ?? []).filter(
    (policy) =>
      matches(policy.action, action) &&
      matches(policy.resource, resource) &&
      sameScope(policy.scope, scope) &&
      (policy.expiresAt === undefined ||
        policy.expiresAt === null ||
        Date.parse(policy.expiresAt) > now),
  );
  return (
    !matching.some((policy) => policy.effect === 'deny') &&
    matching.some((policy) => policy.effect !== 'deny')
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '未知错误';
}

function conciseSummary(value: string, maximumCodePoints = 180): string {
  const codePoints = Array.from(value);
  return codePoints.length > maximumCodePoints
    ? `${codePoints.slice(0, maximumCodePoints).join('')}…`
    : value;
}

export function SportsPage({ client }: SportsPageProps) {
  const defaultClient = useMemo(createApiClient, []);
  const auth = useOptionalAuth();
  const activeClient = client ?? auth?.client ?? defaultClient;
  const [teams, setTeams] = useState<SportsTeamRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    setLoadError(null);
    try {
      setTeams(await activeClient.request<SportsTeamRecord[]>('/sports/teams'));
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [activeClient]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  return (
    <section className="module-page" aria-labelledby="sports-title">
      <header className="page-section-header">
        <div>
          <p className="eyebrow">体育中心</p>
          <h2 id="sports-title">無体育</h2>
          <p>第一时间看马杯赛程，也在这里认识每一支代表队。</p>
        </div>
      </header>

      <Link className="ma-cup-feature" to="/sports/matches">
        <span className="ma-cup-copy">
          <span className="eyebrow">首发栏目 · 实时赛程</span>
          <strong>马杯立刻看</strong>
          <span>左右滑动日期，在时间线上查看正在发生、即将开始和已经结束的比赛。</span>
          <b>
            进入赛程 <span aria-hidden="true">→</span>
          </b>
        </span>
        <SportsPictograms />
      </Link>

      <div className="sports-section-heading">
        <div>
          <p className="eyebrow">队伍名片</p>
          <h3>体育代表队</h3>
        </div>
      </div>

      {teams === null && loadError === null && <p role="status">正在加载代表队…</p>}
      {loadError !== null && <p role="alert">代表队加载失败：{loadError}</p>}
      {teams?.length === 0 && <p>暂无体育代表队</p>}

      {teams !== null && teams.length > 0 && (
        <div className="workbench-grid sports-team-grid">
          {teams.map((team) => (
            <article
              className="workbench-card"
              aria-labelledby={`sports-${team.id}-title`}
              key={team.id}
            >
              <span
                className="status-badge"
                data-status={team.status === 'active' ? 'success' : 'warning'}
              >
                {statusLabels[team.status]}
              </span>
              <h3 id={`sports-${team.id}-title`}>{team.name}</h3>
              <p>{conciseSummary(team.description)}</p>
              <dl className="module-meta-list">
                <div>
                  <dt>赛季</dt>
                  <dd>{team.season || '待补充'}</dd>
                </div>
                <div>
                  <dt>训练或比赛安排</dt>
                  <dd>{team.trainingSchedule || '待发布'}</dd>
                </div>
              </dl>
              <Link className="text-link" to={`/sports/${encodeURIComponent(team.id)}`}>
                查看队伍详情
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
