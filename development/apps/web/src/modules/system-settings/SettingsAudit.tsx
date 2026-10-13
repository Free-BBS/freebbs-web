import type { AdminAuditLog, Page, SystemSettingsUser } from '@freebbs-development/contracts';
import { useEffect, useState } from 'react';
import type { ApiClient } from '../../core/api/client.js';

const actionLabels: Record<string, string> = {
  'system_settings.user.update': '更新用户身份',
  'system_settings.organizations.update': '更新组织信息',
  'system_settings.notification.publish': '发送通知',
  'system_settings.reward.grant': '发放奖励',
  'system_settings.module.update': '调整模块',
  'business.admin_override': '维护业务内容',
};

export function SettingsAudit({
  client,
  initial,
  active,
  users,
}: {
  client: Pick<ApiClient, 'request'>;
  initial: Page<AdminAuditLog>;
  active: boolean;
  users: SystemSettingsUser[];
}) {
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    setError('');
    client
      .request<Page<AdminAuditLog>>(`/system-settings/audit-logs?page=${page}&pageSize=20`)
      .then((next) => {
        if (alive) setRecords(next);
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : '操作记录加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [active, client, page, refresh]);
  return (
    <section className="settings-section settings-audit" aria-label="系统操作记录">
      <header>
        <h3>系统操作记录</h3>
        <p>查看管理员、时间和操作前后的变化。</p>
      </header>
      <div className="settings-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => setRefresh((current) => current + 1)}
        >
          刷新记录
        </button>
      </div>
      {loading ? <p role="status">正在读取操作记录…</p> : null}
      {error ? (
        <p className="development-settings-message is-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && !records.items.length ? <p>暂无操作记录。</p> : null}
      <ol className="operation-log-list">
        {records.items.map((record) => (
          <li key={record.id}>
            <strong>
              {users.find(({ uid }) => uid === record.actorUid)?.username ?? record.actorUid}
            </strong>
            <span>{actionLabels[record.action] ?? '维护业务内容'}</span>
            {record.status === 'pending' ? (
              <span className="settings-audit-status" data-status="pending">
                待核实
              </span>
            ) : record.status === 'failed' ? (
              <span className="settings-audit-status" data-status="failed">
                操作未完成
              </span>
            ) : null}
            <time dateTime={record.createdAt}>
              {new Date(record.createdAt).toLocaleString('zh-CN')}
            </time>
            <details>
              <summary>查看变更摘要</summary>
              <p>操作：{record.action}</p>
              <p>对象：{record.resourceId}</p>
              <p>操作人 UID：{record.actorUid}</p>
              <pre>{JSON.stringify(record.details, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ol>
      <nav className="settings-pagination" aria-label="操作记录分页">
        <button
          type="button"
          className="secondary-button"
          disabled={loading || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          上一页
        </button>
        <span>
          第 {page} 页 · 共 {records.total} 条
        </span>
        <button
          type="button"
          className="secondary-button"
          disabled={loading || page * records.pageSize >= records.total}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
      </nav>
    </section>
  );
}
