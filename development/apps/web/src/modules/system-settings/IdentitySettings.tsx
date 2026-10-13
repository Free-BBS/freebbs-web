import {
  systemSettingsIdentityLabels,
  systemSettingsIdentitySections,
  type DevelopmentAssignableRole,
  type SystemSettingsBootstrap,
  type SystemSettingsUser,
  type RoleKey,
} from '@freebbs-development/contracts';
import { useMemo, useRef, useState } from 'react';
import { ApiError, type ApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import { IdentitySection } from '../admin/sections/IdentitySection.js';

const normalized = (user: SystemSettingsUser | null) =>
  user
    ? JSON.stringify({
        roles: [...user.roles].sort(),
        captainTeamIds: [...user.captainTeamIds].sort(),
      })
    : '';

export function IdentitySettings({
  client,
  initial,
  onUsersChange,
}: {
  client: Pick<ApiClient, 'request'>;
  initial: SystemSettingsBootstrap;
  onUsersChange: (users: SystemSettingsUser[]) => void;
}) {
  const auth = useOptionalAuth();
  const [users, setUsers] = useState(initial.users);
  const [source, setSource] = useState<SystemSettingsUser | null>(initial.users[0] ?? null);
  const [draft, setDraft] = useState<SystemSettingsUser | null>(initial.users[0] ?? null);
  const [captainEnabled, setCaptainEnabled] = useState(
    Boolean(initial.users[0]?.captainTeamIds.length),
  );
  const [captainOpen, setCaptainOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const dirty = normalized(draft) !== normalized(source);
  const sections = useMemo(
    () => systemSettingsIdentitySections(initial.organizations),
    [initial.organizations],
  );
  const labelsForRoles = (roles: readonly RoleKey[]) =>
    systemSettingsIdentityLabels(roles, initial.organizations);
  const platformAdminName =
    initial.organizations.roles.find(({ key }) => key === 'platform.admin')?.name ?? '平台管理员';
  function select(user: SystemSettingsUser | null) {
    setSource(user);
    setDraft(user ? structuredClone(user) : null);
    setCaptainEnabled(Boolean(user?.captainTeamIds.length));
    setStale(false);
    setError('');
    setMessage('');
  }
  async function search(replace = false) {
    if (loading || saving) return;
    if (dirty && !replace) {
      setMessage('当前身份卡片有未保存修改，请先保存或放弃。');
      return;
    }
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const searchQuery = replace ? '' : query.trim();
      const next = await client.request<SystemSettingsUser[]>(
        `/system-settings/users${searchQuery ? `?query=${encodeURIComponent(searchQuery)}` : ''}`,
      );
      if (current !== generation.current) return;
      setUsers(next);
      onUsersChange(next);
      select(next.find((user) => user.uid === draft?.uid) ?? next[0] ?? null);
      if (replace) setQuery('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '用户名单加载失败');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  function patch(change: Partial<SystemSettingsUser>) {
    setDraft((current) => (current ? { ...current, ...change } : current));
    setMessage('');
    if (!stale) setError('');
  }
  async function save() {
    if (!draft || saving || stale) return;
    if (captainEnabled && !draft.captainTeamIds.length) {
      setError('请至少选择一支负责的代表队。');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await client.request<SystemSettingsUser>(
        `/system-settings/users/${encodeURIComponent(draft.uid)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            revision: draft.revision,
            roles: draft.roles,
            captainTeamIds: captainEnabled ? draft.captainTeamIds : [],
          }),
        },
      );
      const next = users.map((user) => (user.uid === updated.uid ? updated : user));
      setUsers(next);
      onUsersChange(next);
      select(updated);
      setMessage(`已保存 ${updated.username} 的身份设置`);
      if (auth?.user?.uid === updated.uid) await auth.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '身份设置保存失败');
      if (caught instanceof ApiError && caught.status === 409) setStale(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="development-user-settings" aria-labelledby="system-identities-title">
      <div className="development-settings-intro">
        <div>
          <p className="section-kicker">IDENTITY DIRECTORY</p>
          <h3 id="system-identities-title">用户身份卡片</h3>
          <p>选择同学，维护组织身份与代表队范围。</p>
        </div>
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <label>
            <span className="sr-only">搜索用户名、学号或 UID</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索用户名、学号或 UID"
            />
          </label>
          <button type="submit" disabled={loading || saving}>
            搜索
          </button>
        </form>
      </div>
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
          <p>保留了当前草稿。重新加载会用最新身份替换草稿，请核对后再保存。</p>
          <button type="button" disabled={loading || saving} onClick={() => void search(true)}>
            重新加载身份
          </button>
        </div>
      ) : null}
      {loading ? <p role="status">正在读取用户名单…</p> : null}
      <div className="development-directory-layout">
        <aside className="development-user-directory" aria-label="用户列表">
          {!users.length ? <p>没有找到符合条件的用户。</p> : null}
          {users.map((user) => (
            <button
              type="button"
              key={user.uid}
              className="development-user-row system-identity-row"
              data-active={user.uid === draft?.uid}
              disabled={saving || loading}
              onClick={() =>
                dirty ? setMessage('当前身份卡片有未保存修改，请先保存或放弃。') : select(user)
              }
            >
              <span className="development-user-avatar" aria-hidden="true">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" />
                ) : (
                  (user.displayName || user.username).slice(0, 1)
                )}
              </span>
              <span className="development-user-row-copy">
                <strong>{user.username}</strong>
                <small>
                  {user.displayName} · {user.studentId ?? '无学号'}
                </small>
                <span className="development-user-summary">
                  {labelsForRoles(user.roles).slice(0, 3).join(' · ') || '暂无组织身份'}
                </span>
              </span>
            </button>
          ))}
        </aside>
        {draft ? (
          <article
            className="development-identity-editor"
            aria-label={`${draft.username} 的身份卡片`}
          >
            <header className="identity-editor-header">
              <div>
                <p className="section-kicker">SELECTED USER</p>
                <h3>{draft.displayName || draft.username}</h3>
                <p>
                  {draft.username} · {draft.studentId ?? '无学号'} · {draft.uid}
                </p>
              </div>
            </header>
            <fieldset className="settings-edit-fields" disabled={saving || loading}>
              <label className="identity-toggle-card">
                <span>
                  <strong>{platformAdminName}</strong>
                  <small>维护系统设置和发展端业务。</small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.roles.includes('platform.admin')}
                  onChange={(event) =>
                    patch({
                      roles: event.currentTarget.checked
                        ? [...draft.roles, 'platform.admin']
                        : draft.roles.filter((role) => role !== 'platform.admin'),
                    })
                  }
                />
              </label>
              <div className="identity-sections">
                {sections.map((section) => (
                  <IdentitySection
                    key={section.id}
                    section={section}
                    roles={draft.roles}
                    onRolesChange={(roles) =>
                      patch({
                        roles: roles.filter(
                          (role): role is DevelopmentAssignableRole =>
                            role !== 'platform.super_admin',
                        ),
                      })
                    }
                    labelsForRoles={labelsForRoles}
                  />
                ))}
              </div>
              <section className="identity-section captain-identity-section">
                <button
                  type="button"
                  className="identity-section-summary"
                  aria-expanded={captainOpen}
                  onClick={() => setCaptainOpen(!captainOpen)}
                >
                  <span>代表队队长</span>
                  <small>
                    {captainEnabled ? `已选择 ${draft.captainTeamIds.length} 支代表队` : '尚未启用'}
                  </small>
                </button>
                {captainOpen ? (
                  <div className="captain-team-editor">
                    <label className="identity-toggle-card compact">
                      <span>
                        <strong>担任代表队队长</strong>
                        <small>请选择具体负责的代表队。</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={captainEnabled}
                        onChange={(event) => {
                          setCaptainEnabled(event.currentTarget.checked);
                          if (!event.currentTarget.checked) patch({ captainTeamIds: [] });
                        }}
                      />
                    </label>
                    {captainEnabled ? (
                      <div className="captain-team-grid">
                        {initial.sportsTeams.map((team) => (
                          <label key={team.id}>
                            <input
                              type="checkbox"
                              checked={draft.captainTeamIds.includes(team.id)}
                              onChange={(event) =>
                                patch({
                                  captainTeamIds: event.currentTarget.checked
                                    ? [...draft.captainTeamIds, team.id]
                                    : draft.captainTeamIds.filter((id) => id !== team.id),
                                })
                              }
                            />
                            <span>{team.name}</span>
                          </label>
                        ))}
                        {!initial.sportsTeams.length ? <p>当前还没有可选择的代表队。</p> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </fieldset>
            <footer className="identity-save-bar" data-dirty={dirty}>
              <span>{dirty ? '有未保存修改' : '身份卡片已同步'}</span>
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!dirty || saving || loading}
                  onClick={() => select(source)}
                >
                  放弃修改
                </button>
                <button
                  type="button"
                  disabled={!dirty || saving || loading || stale}
                  onClick={() => void save()}
                >
                  {saving ? '保存中…' : '保存身份设置'}
                </button>
              </div>
            </footer>
          </article>
        ) : (
          <div className="development-identity-editor empty">请选择一位用户。</div>
        )}
      </div>
    </section>
  );
}
