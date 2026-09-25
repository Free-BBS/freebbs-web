import { useMemo, useState } from 'react';

import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import { ADMIN_SECTIONS, AdminSectionNav, type AdminSectionId } from './AdminSectionNav.js';
import { AuditLogsSection } from './sections/AuditLogsSection.js';
import { BusinessEntrySection } from './sections/BusinessEntrySection.js';
import { ModulesOwnersSection } from './sections/ModulesOwnersSection.js';
import { RolesPermissionsSection } from './sections/RolesPermissionsSection.js';
import { SubjectsAssignmentsSection } from './sections/SubjectsAssignmentsSection.js';
import { SystemStatusSection } from './sections/SystemStatusSection.js';
import { TagDefinitionsSection } from './sections/TagDefinitionsSection.js';
import { DevelopmentUsersSection } from './sections/DevelopmentUsersSection.js';

export interface AdminPageProps {
  client?: Pick<ApiClient, 'request'>;
}

export function AdminPage({ client: suppliedClient }: AdminPageProps = {}) {
  const client = useMemo(() => suppliedClient ?? createApiClient(), [suppliedClient]);
  const [active, setActive] = useState<AdminSectionId>('subjects');

  const content =
    active === 'access' ? (
      <DevelopmentUsersSection client={client} />
    ) : active === 'subjects' ? (
      <SubjectsAssignmentsSection client={client} />
    ) : active === 'roles' ? (
      <RolesPermissionsSection client={client} />
    ) : active === 'tags' ? (
      <TagDefinitionsSection client={client} />
    ) : active === 'modules' ? (
      <ModulesOwnersSection client={client} />
    ) : active === 'business' ? (
      <BusinessEntrySection client={client} />
    ) : active === 'audit' ? (
      <AuditLogsSection client={client} />
    ) : (
      <SystemStatusSection client={client} />
    );
  const current = ADMIN_SECTIONS.find(({ id }) => id === active);

  return (
    <main className="module-page admin-governance-page" aria-label="发展端系统设置">
      <ModulePageHeader
        kicker="DEVELOPMENT SYSTEM"
        title="系统设置"
        description="独立维护发展端白名单、组织身份、代表队权限与预览效果。"
      />
      <AdminSectionNav active={active} onChange={setActive} />
      <div
        id={`admin-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`admin-tab-${active}`}
        aria-label={current?.label}
        tabIndex={0}
      >
        {content}
      </div>
    </main>
  );
}
