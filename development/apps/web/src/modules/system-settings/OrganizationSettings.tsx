import type {
  ModuleManifest,
  SystemSettingsBootstrap,
  SystemSettingsOrganizations,
} from '@freebbs-development/contracts';
import { useState } from 'react';
import { ApiError, type ApiClient } from '../../core/api/client.js';

export function OrganizationSettings({
  initial,
  client,
  onOrganizationsChange,
}: {
  initial: SystemSettingsBootstrap;
  client: Pick<ApiClient, 'request'>;
  onOrganizationsChange: (organizations: SystemSettingsOrganizations) => void;
}) {
  const [source, setSource] = useState(initial.organizations);
  const [draft, setDraft] = useState(() => structuredClone(initial.organizations));
  const [modules, setModules] = useState(initial.modules);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const dirty = JSON.stringify(source) !== JSON.stringify(draft);
  async function save() {
    if (busy || stale) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await client.request<SystemSettingsOrganizations>(
        '/system-settings/organizations',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        },
      );
      setSource(result);
      setDraft(structuredClone(result));
      onOrganizationsChange(result);
      setMessage('组织配置已保存');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '组织配置保存失败');
      if (caught instanceof ApiError && caught.status === 409) setStale(true);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await client.request<SystemSettingsOrganizations>(
        '/system-settings/organizations',
      );
      setSource(result);
      setDraft(structuredClone(result));
      onOrganizationsChange(result);
      setStale(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '组织配置加载失败');
    } finally {
      setBusy(false);
    }
  }
  async function toggle(module: ModuleManifest) {
    if (module.id === 'admin' || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const updated = await client.request<ModuleManifest>('/system-settings/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId: module.id, enabled: module.status !== 'enabled' }),
      });
      setModules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setMessage(
        `${updated.name}已${updated.status === 'enabled' ? '启用' : '停用'}，重新进入页面后更新导航。`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '模块设置保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section" aria-label="组织配置">
      <header>
        <h3>组织与身份名称</h3>
        <p>维护展示名称和说明，组织及身份标识保持固定。</p>
      </header>
      {message ? (
        <p className="development-settings-message" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="development-settings-message is-error" role="alert">
          {error}
        </p>
      ) : null}
      {stale ? (
        <div className="settings-conflict">
          <p>当前草稿已保留。重新加载将替换为最新组织配置。</p>
          <button type="button" disabled={busy} onClick={() => void reload()}>
            重新加载组织配置
          </button>
        </div>
      ) : null}
      <fieldset className="settings-edit-fields" disabled={busy}>
        <div className="settings-metadata-grid">
          {draft.organizations.map((organization) => {
            const label =
              initial.organizations.organizations.find(({ id }) => id === organization.id)?.name ??
              organization.id;
            return (
              <article className="settings-card" key={organization.id}>
                <h4>{label}</h4>
                <label>
                  {label}名称
                  <input
                    maxLength={80}
                    value={organization.name}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        organizations: current.organizations.map((item) =>
                          item.id === organization.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  {label}说明
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={organization.description}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        organizations: current.organizations.map((item) =>
                          item.id === organization.id
                            ? { ...item, description: event.target.value }
                            : item,
                        ),
                      }))
                    }
                  />
                </label>
              </article>
            );
          })}
        </div>
        <details className="settings-card settings-role-names">
          <summary>身份展示名称</summary>
          <div className="settings-metadata-grid">
            {draft.roles.map((role) => (
              <label key={role.key}>
                {initial.organizations.roles.find(({ key }) => key === role.key)?.name ?? role.key}
                <input
                  maxLength={80}
                  value={role.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      roles: current.roles.map((item) =>
                        item.key === role.key ? { ...item, name: event.target.value } : item,
                      ),
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </details>
      </fieldset>
      <div className="settings-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !dirty}
          onClick={() => {
            setDraft(structuredClone(source));
            setError('');
          }}
        >
          放弃修改
        </button>
        <button type="button" disabled={busy || stale || !dirty} onClick={() => void save()}>
          {busy ? '保存中…' : '保存组织配置'}
        </button>
      </div>
      <section className="settings-history">
        <h3>业务模块</h3>
        <p>维护业务模块开放状态。</p>
        <div className="settings-metadata-grid">
          {modules
            .filter(({ id }) => id !== 'admin')
            .map((module) => (
              <article className="settings-card settings-module-card" key={module.id}>
                <h4>{module.name}</h4>
                <p>{module.description}</p>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void toggle(module)}
                >
                  {module.status === 'enabled' ? '停用' : '启用'}
                  {module.name}
                </button>
              </article>
            ))}
        </div>
      </section>
    </section>
  );
}
