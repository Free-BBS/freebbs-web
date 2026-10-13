import { useEffect, useState } from 'react';
import type { ApiClient } from '../../../core/api/client.js';
import { useOptionalAuth } from '../../../core/auth/AuthProvider.js';
import { FirstBusinessAdminSection } from './FirstBusinessAdminSection.js';

interface AccessUser {
  uid: string;
  username: string;
  displayName: string;
  studentId: string | null;
  avatarUrl: string | null;
  accessLevel: 'member' | 'lead' | null;
}
const accessLabels = { none: '不可访问', member: '可访问', lead: '发展端负责人' } as const;

export function DevelopmentUsersSection({ client }: { client: Pick<ApiClient, 'request'> }) {
  const auth = useOptionalAuth();
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [source, setSource] = useState<AccessUser | null>(null);
  const [draft, setDraft] = useState<AccessUser | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const dirty = draft?.accessLevel !== source?.accessLevel;
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
      .request<AccessUser[]>('/admin/development-users')
      .then((next) => {
        if (!active) return;
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
  async function search() {
    if (dirty) {
      setMessage('当前访问设置有未保存修改，请先保存或放弃。');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const next = await client.request<AccessUser[]>(
        `/admin/development-users${query.trim() ? `?query=${encodeURIComponent(query.trim())}` : ''}`,
      );
      setUsers(next);
      select(next.find((user) => user.uid === draft?.uid) ?? next[0] ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '用户名单加载失败');
    } finally {
      setLoading(false);
    }
  }
  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await client.request(`/admin/development-users/${encodeURIComponent(draft.uid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessLevel: draft.accessLevel }),
      });
      setUsers((current) =>
        current.map((user) =>
          user.uid === draft.uid ? { ...user, accessLevel: draft.accessLevel } : user,
        ),
      );
      select(draft);
      setMessage(`已保存 ${draft.username} 的访问设置`);
      if (auth?.user?.uid === draft.uid) await auth.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '访问设置保存失败');
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="development-user-settings" aria-labelledby="development-users-title">
      <div className="development-settings-intro">
        <div>
          <p className="section-kicker">DEVELOPMENT ACCESS</p>
          <h2 id="development-users-title">发展端访问名单</h2>
          <p>维护访问白名单与发展端负责人任命。</p>
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
      {loading ? <p role="status">正在读取主站用户名单…</p> : null}
      <FirstBusinessAdminSection client={client} users={users} onInitialized={setMessage} />
      <div className="development-directory-layout">
        <aside className="development-user-directory" aria-label="用户列表">
          {!users.length && !loading ? <p>没有找到符合条件的用户。</p> : null}
          {users.map((user) => (
            <button
              type="button"
              key={user.uid}
              className="development-user-row"
              data-active={user.uid === draft?.uid}
              disabled={loading || saving}
              onClick={() =>
                dirty ? setMessage('当前访问设置有未保存修改，请先保存或放弃。') : select(user)
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
                {accessLabels[user.accessLevel ?? 'none']}
              </span>
            </button>
          ))}
        </aside>
        {draft ? (
          <article
            className="development-identity-editor"
            aria-label={`${draft.username} 的访问设置`}
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
            <section className="identity-access-card" aria-labelledby="access-level-title">
              <div>
                <h4 id="access-level-title">发展端访问</h4>
                <p>发展端负责人可以进入本管理员模块。</p>
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
                    disabled={loading || saving}
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
              <span>{dirty ? '有未保存修改' : '访问设置已同步'}</span>
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
                  disabled={!dirty || saving || loading}
                  onClick={() => void save()}
                >
                  {saving ? '保存中…' : '保存访问设置'}
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
