import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { ShowcaseArticle } from '@freebbs-development/contracts';
import { ApiError, createApiClient, type ApiClient } from '../../core/api/client.js';

export function ShowcaseDetailPage({ client }: { client?: Pick<ApiClient, 'request'> }) {
  const { articleId = '' } = useParams();
  const fallback = useMemo(createApiClient, []);
  const api = client ?? fallback;
  const [article, setArticle] = useState<ShowcaseArticle | null>(null);
  const [loadError, setLoadError] = useState<'missing' | 'unavailable' | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setArticle(null);
    setLoadError(null);
    api
      .request<ShowcaseArticle>(`/collections/showcase/${encodeURIComponent(articleId)}`)
      .then((value) => {
        if (active) setArticle(value);
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof ApiError && error.status === 404 ? 'missing' : 'unavailable',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [api, articleId, loadAttempt]);
  async function toggleLike() {
    if (!article || busy) return;
    setBusy(true);
    try {
      const updated = await api.request<ShowcaseArticle>(
        `/collections/showcase/${encodeURIComponent(article.id)}/likes`,
        { method: article.liked ? 'DELETE' : 'POST' },
      );
      setArticle(updated);
    } finally {
      setBusy(false);
    }
  }
  if (!article)
    return (
      <main className="collections-page collections-subpage">
        <div className="collections-empty">
          <p role="status">
            {loadError === 'missing'
              ? '这篇文章已找不到。'
              : loadError === 'unavailable'
                ? '文章暂时无法加载。'
                : '正在打开文章…'}
          </p>
          {loadError === 'unavailable' && (
            <button
              className="bbs-action"
              type="button"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              重新加载
            </button>
          )}
          <Link to="/collections/showcase">返回内容橱窗</Link>
        </div>
      </main>
    );
  return (
    <main className="collections-page collections-subpage">
      <article className="showcase-article">
        <Link to="/collections/showcase">← 返回内容橱窗</Link>
        <header>
          <p>
            {article.organizationName} ·{' '}
            {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' }).format(
              new Date(article.publishedAt),
            )}
          </p>
          <h1>{article.title}</h1>
          <span>{article.excerpt}</span>
        </header>
        <div className="showcase-article-cover" aria-hidden="true">
          <span>{article.organizationName}</span>
        </div>
        <div className="showcase-article-body">
          {article.body.split(/\n{2,}/).map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {article.externalUrl ? (
          <a
            className="collections-primary-action"
            href={article.externalUrl}
            target="_blank"
            rel="noreferrer"
          >
            阅读原文 ↗
          </a>
        ) : null}
        <footer>
          <button
            type="button"
            className={article.liked ? 'is-liked' : ''}
            disabled={busy}
            onClick={() => void toggleLike()}
          >
            {article.liked ? '♥ 已喜欢' : '♡ 喜欢'} · {article.likeCount}
          </button>
        </footer>
      </article>
    </main>
  );
}
