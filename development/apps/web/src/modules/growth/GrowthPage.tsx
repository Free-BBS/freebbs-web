import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GrowthSummary } from '@freebbs-development/contracts';
import { DetailSection } from '../../components/DetailSection.js';
import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import type { ApiClient } from '../../core/api/client.js';
import { AchievementCollection } from './AchievementCollection.js';
interface GrowthPageProps {
  client: Pick<ApiClient, 'request'>;
  uid: string;
  displayName: string;
}
function activityDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
export function GrowthPage({ client, uid, displayName }: GrowthPageProps) {
  const [summary, setSummary] = useState<GrowthSummary | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [year, setYear] = useState('all');
  const [domain, setDomain] = useState('all');
  useEffect(() => {
    setYear('all');
    setDomain('all');
  }, [uid]);
  useEffect(() => {
    let active = true;
    setSummary(null);
    setError('');
    void client.request<GrowthSummary>('/growth/summary').then(
      (result) => {
        if (active) setSummary(result);
      },
      () => {
        if (active) setError('成长记录暂时无法加载，请稍后重试。');
      },
    );
    return () => {
      active = false;
    };
  }, [client, uid, attempt]);
  const domains = summary?.byDomain.filter((item) => item.count > 0) ?? [];
  const labels = new Map(summary?.byDomain.map((item) => [item.key, item.label]) ?? []);
  const years = [
    ...new Set(
      summary?.activities.flatMap((item) => {
        const date = activityDate(item.endsAt);
        return date ? [String(date.getFullYear())] : [];
      }) ?? [],
    ),
  ]
    .sort()
    .reverse();
  const filtered = (summary?.activities ?? [])
    .filter((item) => {
      const date = activityDate(item.endsAt);
      return (
        (domain === 'all' || item.domain === domain) &&
        (year === 'all' || (year === 'undated' ? !date : String(date?.getFullYear()) === year))
      );
    })
    .sort(
      (a, b) =>
        (activityDate(b.endsAt)?.getTime() ?? -Infinity) -
        (activityDate(a.endsAt)?.getTime() ?? -Infinity),
    );
  const months = new Map<string, typeof filtered>();
  for (const item of filtered) {
    const date = activityDate(item.endsAt);
    const month = date ? `${date.getFullYear()} 年 ${date.getMonth() + 1} 月` : '日期待补充';
    months.set(month, [...(months.get(month) ?? []), item]);
  }
  return (
    <section className="module-page growth-page" aria-label="个人成长档案">
      <ModulePageHeader title="个人成长档案" description="收藏每一次探索，记录自己的成长节奏。" />
      {error ? (
        <div className="growth-state">
          <p role="alert">{error}</p>
          <button
            type="button"
            className="growth-button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重新加载
          </button>
        </div>
      ) : null}
      {!summary && !error ? (
        <div className="growth-state" role="status">
          正在整理成长足迹…
        </div>
      ) : null}
      {summary ? (
        <>
          <div className="growth-hero">
            <div className="growth-hero-copy">
              <p className="growth-eyebrow">MY GROWTH PASSPORT</p>
              <h3>{displayName}的成长足迹</h3>
              <p>每一次报名，都是探索校园的新起点。</p>
              <Link className="growth-cta" to="/collections/registrations">
                发现更多活动<span aria-hidden="true"> ↗</span>
              </Link>
            </div>
            <div className="growth-stats">
              <div className="growth-total" aria-label="已结束的活动报名">
                <strong>{summary.total}</strong>
                <span>已结束的活动报名</span>
              </div>
              <div className="growth-total" aria-label="探索领域">
                <strong>{domains.length}</strong>
                <span>探索领域</span>
              </div>
              <div className="growth-total" aria-label="解锁成就">
                <strong>{summary.achievements.filter((item) => item.unlocked).length}</strong>
                <span>解锁成就</span>
              </div>
            </div>
          </div>
          <p className="growth-basis">
            目前以已结束且未取消的报名记录统计；实际到场记录和小程序经历将在接入后核验。
          </p>
          <AchievementCollection key={uid} uid={uid} achievements={summary.achievements} />
          <div className="growth-grid">
            <DetailSection
              title="探索版图"
              description="从熟悉的领域出发，也给新的兴趣留一点空间。"
            >
              <div className="growth-domains">
                {domains.length ? (
                  domains.map((item) => (
                    <div className="growth-domain" key={item.key}>
                      <div>
                        <strong>
                          {item.label} · {item.count} 次
                        </strong>
                        <span>{Math.round((item.count / Math.max(summary.total, 1)) * 100)}%</span>
                      </div>
                      <progress
                        aria-label={`${item.label}报名占比`}
                        value={item.count}
                        max={Math.max(summary.total, item.count, 1)}
                      />
                    </div>
                  ))
                ) : (
                  <p className="growth-empty">
                    还没有已结束的活动报名。可以先去活动页发现感兴趣的项目。
                  </p>
                )}
              </div>
            </DetailSection>
          </div>
          <DetailSection
            title="活动足迹"
            description="按月份回看，把探索串成自己的时间线。"
            actions={
              <div className="growth-filters">
                <label>
                  年份
                  <select
                    aria-label="年份"
                    value={year}
                    onChange={(event) => setYear(event.target.value)}
                  >
                    <option value="all">全部年份</option>
                    {years.map((value) => (
                      <option key={value} value={value}>
                        {value} 年
                      </option>
                    ))}
                    <option value="undated">日期待补充</option>
                  </select>
                </label>
                <label>
                  领域
                  <select
                    aria-label="领域"
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                  >
                    <option value="all">全部领域</option>
                    {[...new Set(summary.activities.map((item) => item.domain))].map((value) => (
                      <option key={value} value={value}>
                        {labels.get(value) ?? '其他'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            }
          >
            {months.size ? (
              <div className="growth-timeline">
                {[...months].map(([month, items]) => (
                  <section className="growth-month" key={month}>
                    <h4>{month}</h4>
                    <ul className="growth-activities">
                      {items.map((item) => (
                        <li key={item.id}>
                          <span className="growth-timeline-dot" aria-hidden="true" />
                          <div>
                            {item.status === 'published' ? (
                              <Link to={`/events/${encodeURIComponent(item.id)}`}>
                                {item.title}
                              </Link>
                            ) : (
                              <strong>{item.title}</strong>
                            )}
                            <p>
                              {labels.get(item.domain) ?? '其他'}
                              <span aria-hidden="true"> · </span>
                              {activityDate(item.endsAt) ? (
                                <time dateTime={item.endsAt!}>
                                  {activityDate(item.endsAt)!.getMonth() + 1} 月{' '}
                                  {activityDate(item.endsAt)!.getDate()} 日结束
                                </time>
                              ) : (
                                '结束日期待补充'
                              )}
                            </p>
                          </div>
                          <span className="growth-record-label">报名记录</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <p className="growth-empty">
                {summary.activities.length
                  ? '当前筛选下暂无活动足迹。'
                  : '还没有可展示的活动足迹。'}
              </p>
            )}
          </DetailSection>
        </>
      ) : null}
    </section>
  );
}
