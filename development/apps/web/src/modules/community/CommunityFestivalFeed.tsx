import { useEffect, useState } from 'react';

import type { FestivalSubmissionList } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { CommunityIcon } from './CommunityIcon.js';

export function CommunityFestivalFeed({ client }: { client: ApiClient }) {
  const [data, setData] = useState<FestivalSubmissionList | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let current = true;
    setData(null);
    setError('');
    void client
      .request<FestivalSubmissionList>(`/events/festival/submissions?view=showcase&page=${page}`)
      .then((result) => {
        if (current) setData(result);
      })
      .catch(() => {
        if (current) setError('电子系春晚作品暂时无法加载，请重试。');
      });
    return () => {
      current = false;
    };
  }, [client, page, revision]);

  if (error)
    return (
      <div className="community-alert" role="alert">
        {error}
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          重新加载作品
        </button>
      </div>
    );
  if (!data) return <p className="community-empty">正在收集电子系春晚的精彩作品…</p>;
  const items = data.items.filter((item) => item.displayConsent && item.status === 'approved');
  return (
    <>
      {items.length === 0 ? (
        <p className="community-empty">舞台正在等待第一份热爱，来提交你的作品吧。</p>
      ) : null}
      {items.map((item) => (
        <article className="community-card community-card--festival" key={item.id}>
          <a
            className="community-card__body community-festival-link"
            href="/development/events/student-festival"
          >
            <div className="community-card__meta">
              <span className="community-avatar" aria-hidden="true">
                {item.authorName.slice(0, 1)}
              </span>
              <span>
                <strong>{item.authorName}</strong>
                <small>
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>{' '}
                  · 电子系春晚
                </small>
              </span>
              <span className="community-status">展示中</span>
            </div>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <div className="community-tags">
              <span>#电子系春晚</span>
              <span>#校园作品</span>
            </div>
          </a>
          <footer className="community-festival-footer">
            <span>
              <CommunityIcon name="stage" />
              电子系春晚作品
            </span>
            <a href="/development/events/student-festival">
              查看电子系春晚作品
              <CommunityIcon name="arrow" />
            </a>
          </footer>
        </article>
      ))}
      {data.total > data.pageSize ? (
        <nav className="community-festival-pagination" aria-label="电子系春晚作品分页">
          <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
            上一页
          </button>
          <span className="community-number">
            {page} / {Math.ceil(data.total / data.pageSize)}
          </span>
          <button
            type="button"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </button>
        </nav>
      ) : null}
    </>
  );
}
