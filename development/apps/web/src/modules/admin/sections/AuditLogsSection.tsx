import type { AdminAuditLog, Page } from '@freebbs-development/contracts';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { errorMessage, queryPath, SectionState, type AdminClient } from '../admin-support.js';

const initialPage: Page<AdminAuditLog> = { items: [], page: 1, pageSize: 20, total: 0 };

export function AuditLogsSection({ client }: { client: AdminClient }) {
  const [logs, setLogs] = useState(initialPage);
  const [filters, setFilters] = useState({
    actorUid: '',
    action: '',
    resourceType: '',
    resourceId: '',
    from: '',
    to: '',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    async (page = 1, active = filters) => {
      setLoading(true);
      setError('');
      try {
        setLogs(
          await client.request<Page<AdminAuditLog>>(
            queryPath('/admin/audit-logs', {
              actorUid: active.actorUid || undefined,
              action: active.action || undefined,
              resourceType: active.resourceType || undefined,
              resourceId: active.resourceId || undefined,
              from: active.from ? new Date(active.from).toISOString() : undefined,
              to: active.to ? new Date(active.to).toISOString() : undefined,
              page,
              pageSize: 20,
            }),
          ),
        );
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
    },
    [client, filters],
  );

  useEffect(() => {
    void load(1, {
      actorUid: '',
      action: '',
      resourceType: '',
      resourceId: '',
      from: '',
      to: '',
    });
    // Initial load intentionally ignores draft filters.
  }, [client]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (filters.from && filters.to && new Date(filters.from) > new Date(filters.to)) {
      setError('开始时间不能晚于结束时间。');
      return;
    }
    void load(1);
  }

  const pages = Math.max(1, Math.ceil(logs.total / logs.pageSize));

  return (
    <section className="admin-section-layout" aria-labelledby="audit-heading">
      <header className="admin-section-heading">
        <p className="eyebrow">AUDIT TRAIL</p>
        <h3 id="audit-heading">审计日志</h3>
        <p>按操作人、动作、资源和时间范围查询不可变更的治理记录。</p>
      </header>
      <form
        className="panel admin-audit-filters filter-bar"
        aria-label="审计筛选"
        onSubmit={submit}
      >
        <label>
          操作人 UID
          <input
            value={filters.actorUid}
            onChange={(event) => setFilters({ ...filters, actorUid: event.currentTarget.value })}
          />
        </label>
        <label>
          动作
          <input
            value={filters.action}
            onChange={(event) => setFilters({ ...filters, action: event.currentTarget.value })}
          />
        </label>
        <label>
          资源类型
          <input
            value={filters.resourceType}
            onChange={(event) =>
              setFilters({ ...filters, resourceType: event.currentTarget.value })
            }
          />
        </label>
        <label>
          资源 ID
          <input
            value={filters.resourceId}
            onChange={(event) => setFilters({ ...filters, resourceId: event.currentTarget.value })}
          />
        </label>
        <label>
          开始时间
          <input
            type="datetime-local"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.currentTarget.value })}
          />
        </label>
        <label>
          结束时间
          <input
            type="datetime-local"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.currentTarget.value })}
          />
        </label>
        <button type="submit">筛选日志</button>
      </form>
      <SectionState loading={loading} error={error} onRetry={() => void load(logs.page)}>
        {logs.items.length ? (
          <ol className="record-list responsive-record-list audit-list">
            {logs.items.map((entry) => (
              <li key={entry.id} className="record-card">
                <div>
                  <strong>{entry.action}</strong>
                  <p>
                    {entry.actorUid} · {entry.resourceType}/{entry.resourceId}
                  </p>
                  <details>
                    <summary>查看审计详情</summary>
                    <pre>{JSON.stringify(entry.details, null, 2)}</pre>
                  </details>
                </div>
                <time dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString('zh-CN')}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="record-list-state">当前筛选条件下暂无审计记录。</p>
        )}
        <div className="admin-pagination" aria-label="审计分页">
          <button type="button" disabled={logs.page <= 1} onClick={() => void load(logs.page - 1)}>
            上一页
          </button>
          <span>
            第 {logs.page} / {pages} 页 · 共 {logs.total} 条
          </span>
          <button
            type="button"
            disabled={logs.page >= pages}
            onClick={() => void load(logs.page + 1)}
          >
            下一页
          </button>
        </div>
      </SectionState>
    </section>
  );
}
