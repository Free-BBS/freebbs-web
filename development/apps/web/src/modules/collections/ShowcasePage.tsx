import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { ShowcaseArticle } from '@freebbs-development/contracts';
import { createApiClient, type ApiClient } from '../../core/api/client.js';

export function ShowcasePage({ client }: { client?: Pick<ApiClient, 'request'> }) {
  const fallback = useMemo(createApiClient, []);
  const api = client ?? fallback;
  const [articles, setArticles] = useState<ShowcaseArticle[] | null>(null);
  useEffect(() => {
    let active = true;
    api.request<ShowcaseArticle[]>('/collections/showcase').then(
      (value) => {
        if (active) setArticles(value);
      },
      () => {
        if (active) setArticles([]);
      },
    );
    return () => {
      active = false;
    };
  }, [api]);
  const lead = articles?.[0];
  return (
    <main className="collections-page collections-subpage showcase-page">
      <header className="collections-subpage-heading">
        <div>
          <Link to="/collections">← 返回萬事集</Link>
          <p>STORIES & MOMENTS</p>
          <h1>内容橱窗</h1>
          <span>活动结束之后，故事仍然可以继续被看见。</span>
        </div>
      </header>
      {articles === null ? (
        <p className="collections-empty">正在布置橱窗…</p>
      ) : articles.length === 0 ? (
        <p className="collections-empty">橱窗正在换展，稍后再来看看。</p>
      ) : (
        <>
          <Link className="showcase-lead" to={`/collections/showcase/${lead?.id}`}>
            <div className="showcase-cover" aria-hidden="true">
              <span>{lead?.organizationName}</span>
            </div>
            <div>
              <p>
                本期首展 ·{' '}
                {lead
                  ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' }).format(
                      new Date(lead.publishedAt),
                    )
                  : ''}
              </p>
              <h2>{lead?.title}</h2>
              <span>{lead?.excerpt}</span>
              <b>阅读全文 →</b>
            </div>
          </Link>
          <section className="showcase-grid" aria-label="更多文章">
            {articles.slice(1).map((article) => (
              <Link to={`/collections/showcase/${article.id}`} key={article.id}>
                <div className="showcase-card-cover">
                  <span>{article.organizationName}</span>
                </div>
                <p>
                  {new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(
                    new Date(article.publishedAt),
                  )}
                </p>
                <h2>{article.title}</h2>
                <span>{article.excerpt}</span>
                <small>♡ {article.likeCount}</small>
              </Link>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
