import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { OrganizationGroupWorkspace } from '@freebbs-development/contracts';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import { EntryForm } from './EntryForm.js';
import { Ledger } from './Ledger.js';
import { Materials } from './Materials.js';
import { Settings } from './Settings.js';
import { errorMessage } from './model.js';
import './organization-group.css';
export type GroupClient = Pick<ApiClient, 'request'> & Partial<Pick<ApiClient, 'download'>>;
export function OrganizationGroupPage({
  client,
  enabled = true,
}: {
  client?: GroupClient;
  enabled?: boolean;
}) {
  const fallback = useMemo(createApiClient, []);
  const api = client ?? fallback;
  const [workspace, setWorkspace] = useState<OrganizationGroupWorkspace | null>(null);
  const [yearId, setYearId] = useState('');
  const [tab, setTab] = useState('form');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    setWorkspace(null);
    setError('');
    if (enabled)
      api.request<OrganizationGroupWorkspace>('/organization-group/workspace').then(
        (data) => {
          if (live) {
            setWorkspace(data);
            setYearId(data.activeYearId);
          }
        },
        (cause) => {
          if (live) setError(errorMessage(cause));
        },
      );
    return () => {
      live = false;
    };
  }, [api, enabled]);
  async function reload() {
    const data = await api.request<OrganizationGroupWorkspace>('/organization-group/workspace');
    setWorkspace(data);
    setYearId((current) =>
      workspace && workspace.activeYearId !== data.activeYearId
        ? data.activeYearId
        : data.years.some((year) => year.id === current)
          ? current
          : data.activeYearId,
    );
  }
  if (!enabled)
    return (
      <section className="og-page">
        <p role="status">风采展示暂未开放，请稍后再来。</p>
      </section>
    );
  if (!workspace)
    return (
      <section className="og-page">
        <Link to="/organizations/youth_league/organization">← 返回组织组</Link>
        {error ? (
          <p role="alert" className="og-notice">
            {error}
            <button
              type="button"
              onClick={() => void reload().catch((cause) => setError(errorMessage(cause)))}
            >
              重新加载
            </button>
          </p>
        ) : (
          <p role="status">正在加载组织组台账…</p>
        )}
      </section>
    );
  const year = workspace.years.find((item) => item.id === yearId) ?? workspace.years[0];
  const version = workspace.versions.find((item) => item.id === year?.currentVersionId);
  const tabs = [
    ['form', '活动填报'],
    ['ledger', '活动台账'],
    ['materials', '截止事项与资料'],
    ...(workspace.canManage ? [['settings', '管理设置']] : []),
  ];
  return (
    <section className="og-page">
      <Link className="og-back" to="/organizations/youth_league/organization">
        ← 返回组织组
      </Link>
      <header className="og-header">
        <div>
          <p className="og-eyebrow">团委 · 组织组</p>
          <h1>组织组活动台账</h1>
          <p>把每一次组织生活，留成可回看的共同记录。</p>
        </div>
        <label className="og-year">
          学年
          <select
            aria-label="学年"
            value={year?.id ?? ''}
            onChange={(event) => setYearId(event.target.value)}
          >
            {workspace.years.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {item.archived ? ' · 已归档' : ''}
              </option>
            ))}
          </select>
        </label>
      </header>
      <nav className="og-tabs" role="tablist" aria-label="组织组台账功能">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`og-${id}`}
            id={`og-tab-${id}`}
            onClick={() => setTab(id!)}
          >
            {label}
          </button>
        ))}
      </nav>
      {year ? (
        <>
          <div id="og-form" role="tabpanel" aria-labelledby="og-tab-form" hidden={tab !== 'form'}>
            {version ? (
              <EntryForm
                key={year.id}
                api={api}
                workspace={workspace}
                year={year}
                version={version}
                onSaved={() => setRefresh((value) => value + 1)}
              />
            ) : (
              <section className="og-panel og-empty">
                <h2>{workspace.canManage ? '开始配置正式台账' : '台账正在准备中'}</h2>
                <p role="status">
                  {workspace.submissionBlockedReason ??
                    '请联系管理员配置班级、成员名册和填报问卷。'}
                </p>
                {workspace.canManage ? (
                  <button className="og-primary" type="button" onClick={() => setTab('settings')}>
                    前往管理设置
                  </button>
                ) : null}
              </section>
            )}
          </div>
          {tab === 'ledger' ? (
            <div id="og-ledger" role="tabpanel" aria-labelledby="og-tab-ledger">
              <Ledger key={year.id} api={api} workspace={workspace} year={year} refresh={refresh} />
            </div>
          ) : null}
          {tab === 'materials' ? (
            <div id="og-materials" role="tabpanel" aria-labelledby="og-tab-materials">
              <Materials key={year.id} api={api} workspace={workspace} year={year} />
            </div>
          ) : null}
          {tab === 'settings' && workspace.canManage ? (
            <div id="og-settings" role="tabpanel" aria-labelledby="og-tab-settings">
              <Settings
                key={year.id}
                api={api}
                workspace={workspace}
                year={year}
                onReload={reload}
              />
            </div>
          ) : null}
        </>
      ) : (
        <p role="status">暂无可用学年，请联系管理员。</p>
      )}
    </section>
  );
}
