import { useMemo, useState } from 'react';

import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import { DevelopmentUsersSection } from './sections/DevelopmentUsersSection.js';
import { OperationLogDrawer } from './sections/OperationLogDrawer.js';

export interface AdminPageProps {
  client?: Pick<ApiClient, 'request'>;
}

export function AdminPage({ client: suppliedClient }: AdminPageProps = {}) {
  const client = useMemo(() => suppliedClient ?? createApiClient(), [suppliedClient]);
  const [logsOpen, setLogsOpen] = useState(false);

  return (
    <main className="module-page admin-governance-page" aria-label="发展端管理员模块">
      <div className="admin-module-heading">
        <ModulePageHeader
          kicker="DEVELOPMENT ADMIN"
          title="管理员模块"
          description="从清晰的身份卡片维护发展端用户、组织归属和代表队范围。"
        />
        <button
          type="button"
          className="secondary-button operation-log-trigger"
          onClick={() => setLogsOpen(true)}
        >
          操作记录
        </button>
      </div>
      <DevelopmentUsersSection client={client} />
      <OperationLogDrawer client={client} open={logsOpen} onClose={() => setLogsOpen(false)} />
    </main>
  );
}
