import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { CollectionResponseSummary } from '@freebbs-development/contracts';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import { sourceLabels } from './source-adapters.js';

export function MyRegistrations({ client }: { client?: Pick<ApiClient, 'request'> }) {
  const fallback = useMemo(createApiClient, []);
  const api = client ?? fallback;
  const [items, setItems] = useState<CollectionResponseSummary[] | null>(null);
  useEffect(() => {
    let active = true;
    api.request<CollectionResponseSummary[]>('/collections/mine').then(
      (value) => {
        if (active) setItems(value);
      },
      () => {
        if (active) setItems([]);
      },
    );
    return () => {
      active = false;
    };
  }, [api]);
  return (
    <main className="collections-page collections-subpage">
      <header className="collections-subpage-heading">
        <div>
          <Link to="/collections">← 返回萬事集</Link>
          <p>MY WALLET</p>
          <h1>我的报名</h1>
          <span>每一次提交都收进这里，方便你随时回看。</span>
        </div>
      </header>
      <section className="collection-receipt-list">
        {items === null ? (
          <p>正在翻找记录…</p>
        ) : items.length === 0 ? (
          <div className="collections-empty">
            <strong>钱包里还没有报名凭证</strong>
            <Link to="/collections/registrations">去看看开放中的活动</Link>
          </div>
        ) : (
          items.map((item) => (
            <article key={`${item.source}:${item.id}`}>
              <span>{sourceLabels[item.source]}</span>
              <div>
                <strong>{item.formTitle}</strong>
                <p>
                  {new Intl.DateTimeFormat('zh-CN', {
                    dateStyle: 'long',
                    timeStyle: 'short',
                  }).format(new Date(item.submittedAt))}
                </p>
              </div>
              <b>{item.status === 'submitted' ? '已提交' : '已取消'}</b>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
