import type { AdminAuditLog, Page } from '@freebbs-development/contracts';
import { useEffect, useState } from 'react';

import type { ApiClient } from '../../../core/api/client.js';

const path = '/admin/audit-logs?action=admin.development_user.update&page=1&pageSize=20';

export function OperationLogDrawer({
  client,
  open,
  onClose,
}: {
  client: Pick<ApiClient, 'request'>;
  open: boolean;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<AdminAuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    void client
      .request<Page<AdminAuditLog>>(path)
      .then((page) => {
        if (active) setRecords(page.items);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '操作记录加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, open]);

  if (!open) return null;
  return (
    <div className="operation-log-backdrop" onMouseDown={onClose}>
      <aside
        className="operation-log-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-log-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="section-kicker">CHANGE HISTORY</p>
            <h2 id="operation-log-title">操作记录</h2>
          </div>
          <button type="button" aria-label="关闭操作记录" onClick={onClose}>
            ×
          </button>
        </header>
        {loading ? <p role="status">正在读取操作记录…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {!loading && !error && records.length === 0 ? <p>还没有身份设置记录。</p> : null}
        <ol className="operation-log-list">
          {records.map((record) => (
            <li key={record.id}>
              <strong>{record.actorUid}</strong>
              <span>更新了 {record.resourceId} 的身份卡片</span>
              <time dateTime={record.createdAt}>
                {new Date(record.createdAt).toLocaleString('zh-CN')}
              </time>
              <details>
                <summary>查看变更摘要</summary>
                <pre>{JSON.stringify(record.details, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
