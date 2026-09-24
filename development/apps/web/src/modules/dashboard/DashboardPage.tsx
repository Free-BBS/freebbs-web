import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { DetailSection } from '../../components/DetailSection.js';
import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import { createApiClient, type ApiClient } from '../../core/api/client.js';

export interface DashboardPageProps {
  client?: Pick<ApiClient, 'request'>;
}

interface RecentAnnouncement {
  id: string;
  status: string;
  title: string;
  updatedAt: string;
}

interface RecentActivity {
  id: string;
  startsAt: string | null;
  status: string;
  title: string;
}

interface RecentItem {
  id: string;
  kind: '公告' | '活动';
  timestamp: string | null;
  title: string;
}

type LoadState = 'loading' | 'ready' | 'error';

function sortTimestamp(item: RecentItem): number {
  if (item.timestamp === null) return 0;
  const timestamp = Date.parse(item.timestamp);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatDate(value: string | null): string {
  if (value === null) return '时间待定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待定';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(date);
}

export function DashboardPage({ client }: DashboardPageProps) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [state, setState] = useState<LoadState>('loading');
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    let active = true;
    setState('loading');

    void Promise.all([
      api.request<RecentAnnouncement[]>('/information/announcements'),
      api.request<RecentActivity[]>('/events/activities'),
    ])
      .then(([announcements, activities]) => {
        if (!active) return;
        const items: RecentItem[] = [
          ...announcements
            .filter((announcement) => announcement.status === 'published')
            .map((announcement) => ({
              id: `announcement:${announcement.id}`,
              kind: '公告' as const,
              timestamp: announcement.updatedAt,
              title: announcement.title,
            })),
          ...activities
            .filter((activity) => activity.status === 'published')
            .map((activity) => ({
              id: `activity:${activity.id}`,
              kind: '活动' as const,
              timestamp: activity.startsAt,
              title: activity.title,
            })),
        ]
          .sort((left, right) => sortTimestamp(right) - sortTimestamp(left))
          .slice(0, 4);
        setRecentItems(items);
        setState('ready');
      })
      .catch(() => {
        if (!active) return;
        setRecentItems([]);
        setState('error');
      });

    return () => {
      active = false;
    };
  }, [api]);

  return (
    <section className="module-page dashboard-page" aria-label="发展端工作台">
      <ModulePageHeader
        title="发展端工作台"
        description="了解校园近况，让想法与伙伴在这里相遇。"
        actions={
          <Link className="primary-action-link" to="/events">
            查看近期活动
          </Link>
        }
      />

      <div className="workbench-grid dashboard-grid">
        <DetailSection title="行动提示">
          <ul>
            <li>组织活动：完善时间、地点与报名信息。</li>
            <li>遇到问题：提交咨询，或参与联络揭榜。</li>
            <li>分享经验：留下清晰流程和最新联系方式。</li>
          </ul>
        </DetailSection>

        <DetailSection title="最近内容">
          {state === 'loading' ? <p role="status">正在同步最近内容…</p> : null}
          {state === 'error' ? <p role="alert">最近内容暂时无法同步，请稍后刷新。</p> : null}
          {state === 'ready' && recentItems.length === 0 ? <p>暂时没有新的公开内容。</p> : null}
          {state === 'ready' && recentItems.length > 0 ? (
            <ul className="dashboard-recent-list" aria-label="最近公开内容">
              {recentItems.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span>
                    {item.kind} · {formatDate(item.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </DetailSection>
      </div>
    </section>
  );
}
