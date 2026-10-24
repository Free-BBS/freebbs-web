import { useMemo, useState } from 'react';

import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import { ManagementNavigation } from '../../components/ManagementNavigation.js';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import { isSuperAdmin } from '../../core/permissions/Can.js';
import { DevelopmentUsersSection } from './sections/DevelopmentUsersSection.js';
import { OperationLogDrawer } from './sections/OperationLogDrawer.js';

export interface AdminPageProps {
  client?: Pick<ApiClient, 'request'>;
}

export function AdminPage({ client: suppliedClient }: AdminPageProps = {}) {
  const auth = useOptionalAuth();
  const client = useMemo(
    () => suppliedClient ?? auth?.client ?? createApiClient(),
    [suppliedClient, auth?.client],
  );
  const [logsOpen, setLogsOpen] = useState(false);

  if (!auth?.user || !isSuperAdmin(auth.user)) {
    return <p role="alert">需要发展端负责人资格才能查看负责人任命。</p>;
  }

  return (
    <main className="module-page admin-governance-page" aria-label="负责人任命">
      <ManagementNavigation user={auth.user} />
      <div className="admin-module-heading">
        <ModulePageHeader title="负责人任命" description="维护发展端负责人资格与操作记录。" />
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
