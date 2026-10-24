import {
  systemSettingsIdentitySections,
  type SystemSettingsBootstrap,
  type SystemSettingsOrganizations,
  type SystemSettingsUser,
} from '@freebbs-development/contracts';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import { ManagementNavigation } from '../../components/ManagementNavigation.js';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import { IdentitySettings } from './IdentitySettings.js';
import { OrganizationSettings } from './OrganizationSettings.js';
import { BatchSettings } from './BatchSettings.js';
import { SettingsAudit } from './SettingsAudit.js';
import './system-settings.css';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';

const tabs = ['用户身份', '组织配置', '通知', '奖励', '操作记录'] as const;
function ReadonlyPreview({ active, children }: { active: boolean; children: ReactNode }) {
  return active ? (
    <fieldset className="settings-readonly-preview" disabled>
      {children}
    </fieldset>
  ) : (
    <>{children}</>
  );
}
export function SystemSettingsPage({
  client: suppliedClient,
}: { client?: Pick<ApiClient, 'request'> } = {}) {
  const user = useOptionalAuth()?.user;
  const readonly = user?.previewing === true;
  const client = useMemo(() => suppliedClient ?? createApiClient(), [suppliedClient]);
  const [data, setData] = useState<SystemSettingsBootstrap | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState(0);
  const [visitedTabs, setVisitedTabs] = useState([0]);
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  function selectTab(index: number) {
    setVisitedTabs((current) => (current.includes(index) ? current : [...current, index]));
    setTab(index);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    client
      .request<SystemSettingsBootstrap>('/system-settings')
      .then((next) => {
        if (active) setData(next);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '系统设置加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, client]);
  function updateUsers(users: SystemSettingsUser[]) {
    setData((current) =>
      current
        ? {
            ...current,
            users: current.users.map(
              (user) => users.find((updated) => updated.uid === user.uid) ?? user,
            ),
          }
        : current,
    );
  }
  function updateOrganizations(organizations: SystemSettingsOrganizations) {
    setData((current) =>
      current
        ? {
            ...current,
            organizations,
            identitySections: systemSettingsIdentitySections(organizations),
          }
        : current,
    );
  }
  return (
    <section className="module-page system-settings-page" aria-label="人员与组织管理">
      <ManagementNavigation user={user} />
      <ModulePageHeader
        title="人员与组织"
        description="维护组织身份与业务配置，发送通知、发放奖励并查看操作记录。"
      />
      {readonly ? (
        <p role="status">正在预览此用户的系统设置，修改、通知和奖励发放已停用。</p>
      ) : null}
      {loading ? <p role="status">正在加载系统设置…</p> : null}
      {error ? (
        <div className="development-settings-message is-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setAttempt(attempt + 1)}>
            重试加载
          </button>
        </div>
      ) : null}
      {data ? (
        <>
          <nav className="settings-tab-nav" aria-label="系统设置分区">
            <div role="tablist" aria-label="系统设置">
              {tabs.map((label, index) => (
                <button
                  type="button"
                  key={label}
                  id={`${id}-tab-${index}`}
                  ref={(button) => {
                    tabButtons.current[index] = button;
                  }}
                  role="tab"
                  aria-selected={tab === index}
                  aria-controls={`${id}-panel-${index}`}
                  tabIndex={tab === index ? 0 : -1}
                  onClick={() => selectTab(index)}
                  onKeyDown={(event) => {
                    let next = index;
                    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                    else if (event.key === 'ArrowLeft')
                      next = (index - 1 + tabs.length) % tabs.length;
                    else if (event.key === 'Home') next = 0;
                    else if (event.key === 'End') next = tabs.length - 1;
                    else return;
                    event.preventDefault();
                    selectTab(next);
                    tabButtons.current[next]?.focus();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </nav>
          <div
            className="settings-panel"
            role="tabpanel"
            id={`${id}-panel-0`}
            aria-labelledby={`${id}-tab-0`}
            hidden={tab !== 0}
          >
            {visitedTabs.includes(0) ? (
              <IdentitySettings
                client={client}
                initial={data}
                onUsersChange={updateUsers}
                readonly={readonly}
              />
            ) : null}
          </div>
          <div
            className="settings-panel"
            role="tabpanel"
            id={`${id}-panel-1`}
            aria-labelledby={`${id}-tab-1`}
            hidden={tab !== 1}
          >
            {visitedTabs.includes(1) ? (
              <ReadonlyPreview active={readonly}>
                <OrganizationSettings
                  client={client}
                  initial={data}
                  onOrganizationsChange={updateOrganizations}
                />
              </ReadonlyPreview>
            ) : null}
          </div>
          <div
            className="settings-panel"
            role="tabpanel"
            id={`${id}-panel-2`}
            aria-labelledby={`${id}-tab-2`}
            hidden={tab !== 2}
          >
            {visitedTabs.includes(2) ? (
              <ReadonlyPreview active={readonly}>
                <BatchSettings kind="notification" client={client} initial={data} />
              </ReadonlyPreview>
            ) : null}
          </div>
          <div
            className="settings-panel"
            role="tabpanel"
            id={`${id}-panel-3`}
            aria-labelledby={`${id}-tab-3`}
            hidden={tab !== 3}
          >
            {visitedTabs.includes(3) ? (
              <ReadonlyPreview active={readonly}>
                <BatchSettings kind="reward" client={client} initial={data} />
              </ReadonlyPreview>
            ) : null}
          </div>
          <div
            className="settings-panel"
            role="tabpanel"
            id={`${id}-panel-4`}
            aria-labelledby={`${id}-tab-4`}
            hidden={tab !== 4}
          >
            {visitedTabs.includes(4) ? (
              <SettingsAudit
                client={client}
                initial={data.audits}
                active={tab === 4}
                users={data.users}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
