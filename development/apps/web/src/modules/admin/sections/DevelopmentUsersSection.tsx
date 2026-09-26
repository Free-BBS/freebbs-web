import {
  DEVELOPMENT_IDENTITY_SECTIONS,
  identityLabels,
  type RoleKey,
} from '@freebbs-development/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useOptionalAuth } from '../../../core/auth/AuthProvider.js';
import type { ApiClient } from '../../../core/api/client.js';
import { IdentitySection } from './IdentitySection.js';

interface DevelopmentDirectoryUser {
  uid: string;
  username: string;
  displayName: string;
  studentId: string | null;
  avatarUrl: string | null;
  accessLevel: 'member' | 'lead' | null;
  roles: RoleKey[];
  captainTeamIds: string[];
}

interface SportsTeamSummary {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
}

const accessLabels = {
  none: '不可访问',
  member: '可访问',
  lead: '发展端负责人',
} as const;

function copyUser(user: DevelopmentDirectoryUser): DevelopmentDirectoryUser {
  return { ...user, roles: [...user.roles], captainTeamIds: [...user.captainTeamIds] };
}

function normalized(user: DevelopmentDirectoryUser | null): string {
  if (!user) return '';
  return JSON.stringify({
    accessLevel: user.accessLevel,
    roles: [...user.roles].sort(),
    captainTeamIds: [...user.captainTeamIds].sort(),
  });
}

function avatarFallback(user: DevelopmentDirectoryUser): string {
  return (user.displayName || user.username || '?').trim().slice(0, 1).toLocaleUpperCase();
}

export function DevelopmentUsersSection({ client }: { client: Pick<ApiClient, 'request'> }) {
  const auth = useOptionalAuth();
  const [users, setUsers] = useState<DevelopmentDirectoryUser[]>([]);
  const [teams, setTeams] = useState<SportsTeamSummary[]>([]);
  const [selectedUid, setSelectedUid] = useState('');
  const [draft, setDraft] = useState<DevelopmentDirectoryUser | null>(null);
  const [captainEnabled, setCaptainEnabled] = useState(false);
  const [captainOpen, setCaptainOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedSource = useMemo(
    () => users.find(({ uid }) => uid === selectedUid) ?? null,
    [selectedUid, users],
  );
  const dirty = normalized(draft) !== normalized(selectedSource);

  const selectUser = useCallback((user: DevelopmentDirectoryUser) => {
    setSelectedUid(user.uid);
    setDraft(copyUser(user));
    setCaptainEnabled(user.captainTeamIds.length > 0);
    setMessage('');
    setError('');
  }, []);

  const load = useCallback(
    async (search = '') => {
      setLoading(true);
      setError('');
      try {
        const suffix = search.trim() ? `?query=${encodeURIComponent(search.trim())}` : '';
        const [nextUsers, nextTeams] = await Promise.all([
          client.request<DevelopmentDirectoryUser[]>(`/admin/development-users${suffix}`),
          client.request<SportsTeamSummary[]>('/sports/teams'),
        ]);
        setUsers(nextUsers);
        setTeams(nextTeams.filter(({ status }) => status === 'active'));
        const nextSelected =
          nextUsers.find(({ uid }) => uid === selectedUid) ?? nextUsers[0] ?? null;
        if (nextSelected) selectUser(nextSelected);
        else {
          setSelectedUid('');
          setDraft(null);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '用户名单加载失败');
      } finally {
        setLoading(false);
      }
    },
    [client, selectUser, selectedUid],
  );

  useEffect(() => {
    void load();
  }, [client]);

  function chooseUser(user: DevelopmentDirectoryUser) {
    if (dirty) {
      setMessage('当前身份卡片有未保存修改，请先保存或放弃。');
      return;
    }
    selectUser(user);
  }

  function patch(change: Partial<DevelopmentDirectoryUser>) {
    setDraft((current) => (current ? { ...current, ...change } : current));
    setMessage('');
    setError('');
  }

  function togglePlatformAdmin(enabled: boolean) {
    if (!draft) return;
    patch({
      roles: enabled
        ? [...new Set([...draft.roles, 'platform.admin' as const])]
        : draft.roles.filter((role) => role !== 'platform.admin'),
    });
  }

  function toggleCaptain(enabled: boolean) {
    setCaptainEnabled(enabled);
    if (!enabled) patch({ captainTeamIds: [] });
  }

  function toggleTeam(teamId: string, enabled: boolean) {
    if (!draft) return;
    patch({
      captainTeamIds: enabled
        ? [...new Set([...draft.captainTeamIds, teamId])]
        : draft.captainTeamIds.filter((id) => id !== teamId),
    });
  }

  async function save() {
    if (!draft) return;
    if (captainEnabled && draft.captainTeamIds.length === 0) {
      setError('请至少选择一支负责的代表队。');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await client.request(`/admin/development-users/${encodeURIComponent(draft.uid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessLevel: draft.accessLevel,
          roles: draft.roles,
          captainTeamIds: captainEnabled ? draft.captainTeamIds : [],
        }),
      });
      await load(query);
      setMessage(`已保存 ${draft.username} 的身份设置`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '身份设置保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="development-user-settings" aria-labelledby="development-users-title">
      <div className="development-settings-intro">
        <div>
          <p className="section-kicker">IDENTITY DIRECTORY</p>
          <h2 id="development-users-title">用户身份卡片</h2>
          <p>从主站用户目录选择同学，再配置发展端访问与组织身份。</p>
        </div>
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            void load(query);
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
          <button type="submit">搜索</button>
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
      {loading ? <p role="status">正在读取主站用户名单…</p> : null}

      <div className="development-directory-layout">
        <aside className="development-user-directory" aria-label="用户列表">
          {users.length === 0 && !loading ? <p>没有找到符合条件的用户。</p> : null}
          {users.map((user) => {
            const labels = identityLabels(user.roles);
            const accessKey = user.accessLevel ?? 'none';
            return (
              <button
                type="button"
                key={user.uid}
                className="development-user-row"
                data-active={user.uid === selectedUid}
                onClick={() => chooseUser(user)}
              >
                <span className="development-user-avatar" aria-hidden="true">
                  {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : avatarFallback(user)}
                </span>
                <span className="development-user-row-copy">
                  <strong>{user.username}</strong>
                  <small>
                    {user.displayName} · {user.studentId ?? '无学号'}
                  </small>
                  <span className="development-user-summary">
                    {labels.slice(0, 3).join(' · ') || '暂无组织身份'}
                  </span>
                </span>
                <span className="development-access-badge" data-level={accessKey}>
                  {accessLabels[accessKey]}
                </span>
              </button>
            );
          })}
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
              <button
                type="button"
                className="preview-user-button"
                disabled={!auth}
                onClick={() => auth?.setPreviewUser(draft.uid)}
              >
                以此身份预览
              </button>
            </header>

            <section className="identity-access-card" aria-labelledby="access-level-title">
              <div>
                <h4 id="access-level-title">发展端访问</h4>
                <p>发展端负责人可以进入本管理员模块；普通可访问用户不会看到入口。</p>
              </div>
              <div className="identity-option-row access-level-options">
                {(
                  [
                    [null, '不可访问'],
                    ['member', '可访问'],
                    ['lead', '发展端负责人'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={draft.accessLevel === value}
                    onClick={() => patch({ accessLevel: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <label className="identity-toggle-card">
              <span>
                <strong>平台管理员</strong>
                <small>用于之后的系统设置，不包含本管理员模块。</small>
              </span>
              <input
                type="checkbox"
                checked={draft.roles.includes('platform.admin')}
                onChange={(event) => togglePlatformAdmin(event.currentTarget.checked)}
              />
            </label>

            <div className="identity-sections">
              {DEVELOPMENT_IDENTITY_SECTIONS.map((section) => (
                <IdentitySection
                  key={section.id}
                  section={section}
                  roles={draft.roles}
                  onRolesChange={(roles) => patch({ roles })}
                />
              ))}
            </div>

            <section className="identity-section captain-identity-section">
              <button
                type="button"
                className="identity-section-summary"
                aria-expanded={captainOpen}
                onClick={() => setCaptainOpen((current) => !current)}
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
                      <small>开启后请选择具体负责的代表队。</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={captainEnabled}
                      onChange={(event) => toggleCaptain(event.currentTarget.checked)}
                    />
                  </label>
                  {captainEnabled ? (
                    <div className="captain-team-grid">
                      {teams.map((team) => (
                        <label key={team.id}>
                          <input
                            type="checkbox"
                            checked={draft.captainTeamIds.includes(team.id)}
                            onChange={(event) => toggleTeam(team.id, event.currentTarget.checked)}
                          />
                          <span>{team.name}</span>
                        </label>
                      ))}
                      {teams.length === 0 ? <p>当前还没有可选择的代表队。</p> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>

            <footer className="identity-save-bar" data-dirty={dirty}>
              <span>{dirty ? '有未保存修改' : '身份卡片已同步'}</span>
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!dirty || saving}
                  onClick={() => selectedSource && selectUser(selectedSource)}
                >
                  放弃修改
                </button>
                <button type="button" disabled={!dirty || saving} onClick={() => void save()}>
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
