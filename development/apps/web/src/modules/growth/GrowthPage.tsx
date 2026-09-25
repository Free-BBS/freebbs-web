import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { GrowthSummary } from '@freebbs-development/contracts';
import { DetailSection } from '../../components/DetailSection.js';
import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import type { ApiClient } from '../../core/api/client.js';

interface GrowthPageProps {
  client: Pick<ApiClient, 'request'>;
  uid: string;
  displayName: string;
}

export function GrowthPage({ client, uid, displayName }: GrowthPageProps) {
  const [summary, setSummary] = useState<GrowthSummary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setSummary(null);
    setError('');
    void client.request<GrowthSummary>('/growth/summary').then(
      (result) => {
        if (active) setSummary(result);
      },
      () => {
        if (active) setError('成长记录暂时无法加载，请稍后刷新。');
      },
    );
    return () => {
      active = false;
    };
  }, [client, uid]);

  const activityLabels = new Map(summary?.byDomain.map(({ key, label }) => [key, label]) ?? []);
  return (
    <section className="module-page growth-page" aria-label="个人成长档案">
      <ModulePageHeader title="个人成长档案" description="汇集当前账号的活动经历与成就称号。" />
      {error ? <p role="alert">{error}</p> : null}
      {!summary && !error ? <p role="status">正在整理成长足迹…</p> : null}
      {summary ? (
        <>
          <div className="growth-hero">
            <div>
              <p className="growth-eyebrow">MY GROWTH</p>
              <h3>{displayName}的成长足迹</h3>
              <p>根据当前账号在发展端的报名记录整理。</p>
            </div>
            <div className="growth-total" aria-label="已结束的活动报名">
              <strong>{summary.total}</strong>
              <span>已结束的活动报名</span>
            </div>
          </div>
          <p className="growth-basis">
            目前以已结束且未取消的报名记录统计；实际到场记录和小程序经历将在接入后核验。
          </p>
          <div className="growth-grid">
            <DetailSection title="各领域活动" description="按活动所属组织领域统计">
              <div className="growth-domains">
                {summary.byDomain.filter(({ count }) => count > 0).length ? (
                  summary.byDomain
                    .filter(({ count }) => count > 0)
                    .map(({ key, label, count }) => (
                      <span className="growth-domain" key={key}>
                        {label} · {count} 次
                      </span>
                    ))
                ) : (
                  <p>还没有已结束的活动报名。可以先去活动页发现感兴趣的项目。</p>
                )}
              </div>
            </DetailSection>
            <DetailSection title="成就称号" description="依据当前可核实的活动记录解锁">
              <ul className="growth-achievements">
                {summary.achievements.map((achievement) => (
                  <li
                    className={achievement.unlocked ? 'is-unlocked' : 'is-locked'}
                    key={achievement.id}
                  >
                    <strong>{achievement.title}</strong>
                    <span>{achievement.description}</span>
                    <small>
                      {achievement.unlocked
                        ? '已解锁'
                        : `进度 ${Math.min(achievement.progress, achievement.target)}/${achievement.target}`}
                    </small>
                  </li>
                ))}
              </ul>
            </DetailSection>
          </div>
          <DetailSection title="活动足迹">
            {summary.activities.length ? (
              <ul className="growth-activities">
                {summary.activities.map((activity) => (
                  <li key={activity.id}>
                    {activity.status === 'published' ? (
                      <Link to={`/events/${encodeURIComponent(activity.id)}`}>
                        {activity.title}
                      </Link>
                    ) : (
                      <strong>{activity.title}</strong>
                    )}
                    <span>{activityLabels.get(activity.domain) ?? '其他'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>还没有可展示的活动足迹。</p>
            )}
          </DetailSection>
        </>
      ) : null}
    </section>
  );
}
