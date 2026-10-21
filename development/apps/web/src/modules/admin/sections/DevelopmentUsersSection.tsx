import type { DevelopmentDirectoryFilters, Page } from '@freebbs-development/contracts';
import {
  directoryUrl,
  directoryResult,
  DirectoryFilters,
  DirectoryPagination,
} from '../../system-settings/DirectoryControls.js';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApiClient } from '../../../core/api/client.js';
import { useOptionalAuth } from '../../../core/auth/AuthProvider.js';
import { FirstBusinessAdminSection } from './FirstBusinessAdminSection.js';
import { isSuperAdmin } from '../../../core/permissions/Can.js';

interface AccessUser {
  uid: string;
  username: string;
  displayName: string;
  studentId: string | null;
  avatarUrl: string | null;
  accessLevel: 'member' | 'lead' | null;
}
function normalizeUser(user: AccessUser): AccessUser {
  return { ...user, accessLevel: user.accessLevel === 'lead' ? 'lead' : 'member' };
}

function IdentityPreviewButton({ uid, disabled }: { uid: string; disabled: boolean }) {
  const auth = useOptionalAuth();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="secondary-button"
      disabled={disabled}
      onClick={() => {
        auth?.setPreviewUser(uid);
        navigate('/community');
      }}
    >
      预览此用户界面
    </button>
  );
}

export function DevelopmentUsersSection({ client }: { client: Pick<ApiClient, 'request'> }) {
  const auth = useOptionalAuth();
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [source, setSource] = useState<AccessUser | null>(null);
  const [draft, setDraft] = useState<AccessUser | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<DevelopmentDirectoryFilters>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const dirty = draft?.accessLevel !== source?.accessLevel;
  const busy = loading || saving;
  function select(user: AccessUser | null) {
    setSource(user);
    setDraft(user ? { ...user } : null);
    setError('');
    setMessage('');
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    client
      .request<AccessUser[] | Page<AccessUser>>(directoryUrl('/admin/development-users', '', {}, 1))
      .then((result) => {
        if (!active) return;
        const paged = directoryResult(result);
        const next = paged.items.map(normalizeUser);
        setPage(paged.page);
        setTotal(paged.total);
        setUsers(next);
        select(next[0] ?? null);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '用户名单加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client]);
  async function search(requestedPage = 1) {
    if (busy) return;
    if (dirty) {
      setMessage('当前负责人设置有未保存修改，请先保存或放弃。');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = directoryResult(
        await client.request<AccessUser[] | Page<AccessUser>>(
          directoryUrl('/admin/development-users', query, filters, requestedPage),
        ),
      );
      const next = result.items.map(normalizeUser);
      setPage(result.page);
      setTotal(result.total);
      setUsers(next);
      select(next.find((user) => user.uid === draft?.uid) ?? next[0] ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '用户名单加载失败');
    } finally {
      setLoading(false);
    }
  }
  async function save() {
    if (!draft || busy) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await client.request(`/admin/development-users/${encodeURIComponent(draft.uid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessLevel: draft.accessLevel === 'lead' ? 'lead' : null }),
      });
      setUsers((current) =>
        current.map((user) =>
          user.uid === draft.uid ? { ...user, accessLevel: draft.accessLevel } : user,
        ),
      );
      select(draft);
      setMessage(`已保存 ${draft.username} 的负责人设置`);
      if (auth?.user?.uid === draft.uid) await auth.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '负责人设置保存失败');
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="development-user-settings" aria-labelledby="development-users-title">
      <div className="development-settings-intro">
        <div>
          <p className="section-kicker">DEVELOPMENT MEMBERS</p>
          <h2 id="development-users-title">发展端成员与负责人</h2>
          <p>所有已登录用户均可访问发展端；在此管理发展端负责人。</p>
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
          <button type="submit" disabled={busy}>
            搜索
          </button>
          <DirectoryFilters value={filters} onChange={setFilters} />
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
      <FirstBusinessAdminSection client={client} users={users} onInitialized={setMessage} />
      <DirectoryPagination
        page={page}
        total={total}
        loading={busy}
        onPage={(next) => void search(next)}
      />
      <div className="development-directory-layout">
        <aside className="development-user-directory" aria-label="用户列表">
          {!users.length && !loading ? <p>没有找到符合条件的用户。</p> : null}
          {users.map((user) => (
            <button
              key={user.uid}
              type="button"
              aria-label={`编辑 ${user.username} 的负责人设置`}
              className="development-user-row"
              data-active={user.uid === draft?.uid}
              disabled={busy}
              onClick={() =>
                dirty ? setMessage('当前负责人设置有未保存修改，请先保存或放弃。') : select(user)
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
              </span>
              <span className="development-access-badge" data-level={user.accessLevel ?? 'none'}>
                {user.accessLevel === 'lead' ? '发展端负责人' : '普通成员'}
              </span>
            </button>
          ))}
        </aside>
        {draft ? (
          <article
            className="development-identity-editor"
            aria-label={`${draft.username} 的负责人设置`}
          >
            <header className="identity-editor-header">
              <div>
                <p className="section-kicker">SELECTED USER</p>
                <h3>{draft.displayName || draft.username}</h3>
                <p>
                  {draft.username} · {draft.studentId ?? '无学号'} · {draft.uid}
                </p>
              </div>
              {auth?.authMode === 'main' &&
              auth.user &&
              isSuperAdmin(auth.user) &&
              auth.user.viewer?.canPreviewDevelopment === true ? (
                <IdentityPreviewButton uid={draft.uid} disabled={dirty || busy} />
              ) : null}
            </header>
            <section className="identity-access-card" aria-labelledby="access-level-title">
              <div>
                <h4 id="access-level-title">发展端身份</h4>
                <p>所有登录用户默认为普通成员，发展端负责人可以进入本管理员模块。</p>
              </div>
              <div className="identity-option-row access-level-options">
                {(
                  [
                    ['member', '普通成员'],
                    ['lead', '发展端负责人'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    disabled={busy}
                    aria-pressed={draft.accessLevel === value}
                    onClick={() => {
                      setDraft({ ...draft, accessLevel: value });
                      setError('');
                      setMessage('');
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
            <footer className="identity-save-bar" data-dirty={dirty}>
              <span>{dirty ? '有未保存修改' : '负责人设置已同步'}</span>
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!dirty || busy}
                  onClick={() => select(source)}
                >
                  放弃修改
                </button>
                <button type="button" disabled={!dirty || busy} onClick={() => void save()}>
                  {saving ? '保存中…' : '保存负责人设置'}
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
