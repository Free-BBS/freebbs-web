import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AsyncState } from '../../components/AsyncState.js';
import { StatusBadge } from '../../components/StatusBadge.js';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import {
  knowledgeListPath,
  statusLabels,
  tone,
  typeLabels,
  type KnowledgeAudience,
  type KnowledgeEntry,
} from './model.js';

export interface KnowledgeDetailPageProps {
  entryId: string;
  audience?: KnowledgeAudience;
  client?: Pick<ApiClient, 'request'>;
}

export function KnowledgeDetailPage({
  entryId,
  audience = 'general',
  client,
}: KnowledgeDetailPageProps) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [result, setResult] = useState<{
    entryId: string;
    audience: KnowledgeAudience;
    entry: KnowledgeEntry | null;
    failed: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setResult(null);
    void api
      .request<KnowledgeEntry[]>(`/knowledge/entries?audience=${audience}`)
      .then((entries) => {
        if (active)
          setResult({
            entryId,
            audience,
            entry:
              entries.find(
                (entry) => entry.id === entryId && (entry.audience ?? 'general') === audience,
              ) ?? null,
            failed: false,
          });
      })
      .catch(() => {
        if (active) setResult({ entryId, audience, entry: null, failed: true });
      });
    return () => {
      active = false;
    };
  }, [api, entryId, audience, attempt]);

  const current = result?.entryId === entryId && result.audience === audience ? result : null;
  const entry = current?.entry;

  return (
    <section className="module-page knowledge-reader" aria-label="经验阅读">
      <Link className="reader-back" aria-label="返回经验库" to={knowledgeListPath(audience)}>
        ← 返回经验库
      </Link>
      {current === null ? <AsyncState state="loading" loadingLabel="正在加载经验…" /> : null}
      {current?.failed ? (
        <AsyncState
          state="error"
          title="经验加载失败"
          description="暂时无法读取内容，请稍后重试。"
          action={
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </button>
          }
        />
      ) : null}
      {current && !current.failed && !entry ? (
        <AsyncState
          state="empty"
          title="暂时无法查看这篇经验"
          description="内容可能已移除，或你暂时没有访问权限。"
        />
      ) : null}
      {entry ? (
        <article className="knowledge-reading-sheet">
          <header>
            <div className="record-metadata">
              <span className="record-eyebrow">{entry.category || typeLabels[entry.type]}</span>
              <StatusBadge status={tone(entry.status)}>{statusLabels[entry.status]}</StatusBadge>
            </div>
            <h2>{entry.title}</h2>
            {entry.summary ? <p className="knowledge-reading-summary">{entry.summary}</p> : null}
            <div className="record-metadata">
              {(entry.tags ?? []).map((tag) => (
                <span className="record-tag" key={tag}>
                  {tag}
                </span>
              ))}
              {entry.maintainedAt ? <span>更新于 {entry.maintainedAt.slice(0, 10)}</span> : null}
              {entry.maintainerUid ? <span>维护人：{entry.maintainerUid}</span> : null}
            </div>
          </header>
          <div className="knowledge-reading-body" aria-label="经验正文">
            {entry.body}
          </div>
        </article>
      ) : null}
    </section>
  );
}
