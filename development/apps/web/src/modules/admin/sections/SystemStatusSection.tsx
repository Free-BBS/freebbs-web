import type { AdminSystemStatus } from '@freebbs-development/contracts';
import { useCallback, useEffect, useState } from 'react';

import { errorMessage, SectionState, type AdminClient } from '../admin-support.js';

export function SystemStatusSection({ client }: { client: AdminClient }) {
  const [status, setStatus] = useState<AdminSystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStatus(await client.request<AdminSystemStatus>('/admin/system-status'));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => void load(), [load]);

  return (
    <section className="admin-section-layout" aria-labelledby="system-heading">
      <header className="admin-section-heading">
        <p className="eyebrow">SYSTEM READOUT</p>
        <h3 id="system-heading">系统状态</h3>
        <p>仅展示安全的版本、数据模式、迁移与模块计数，不暴露主机、密码或令牌。</p>
      </header>
      <SectionState loading={loading} error={error} onRetry={() => void load()} empty={!status}>
        {status ? (
          <dl className="system-status-grid">
            <div>
              <dt>版本</dt>
              <dd>{status.version}</dd>
            </div>
            <div>
              <dt>数据模式</dt>
              <dd>{status.dataMode}</dd>
            </div>
            <div>
              <dt>已应用迁移</dt>
              <dd>{status.appliedMigrationCount}</dd>
            </div>
            <div>
              <dt>模块总数</dt>
              <dd>{status.moduleCounts.total}</dd>
            </div>
            <div>
              <dt>启用模块</dt>
              <dd>{status.moduleCounts.enabled}</dd>
            </div>
            <div>
              <dt>停用模块</dt>
              <dd>{status.moduleCounts.disabled}</dd>
            </div>
          </dl>
        ) : null}
      </SectionState>
    </section>
  );
}
