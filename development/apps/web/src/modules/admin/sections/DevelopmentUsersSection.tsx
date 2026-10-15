import type {
  BatchAllowDevelopmentUsersResponse,
  DevelopmentDirectoryFilters,
  Page,
} from '@freebbs-development/contracts';
import './development-users.css';
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
const accessLabels = { none: '不可访问', member: '可访问', lead: '发展端负责人' } as const;

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
  const [selectedUsers, setSelectedUsers] = useState<Map<string, string>>(new Map());
  const [batchReview, setBatchReview] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const dirty = draft?.accessLevel !== source?.accessLevel;
  const busy = loading || saving || batchSaving;
  const currentPageSelected =
    users.length > 0 && users.every((user) => selectedUsers.has(user.uid));
  function toggleUsers(targets: AccessUser[], checked: boolean) {
    const next = new Map(selectedUsers);
    for (const user of targets) {
      if (checked) next.set(user.uid, user.username);
      else next.delete(user.uid);
    }
    if (next.size > 100) {
      setError('每次最多选择 100 位用户，请先提交或减少选择。');
      return;
    }
    setSelectedUsers(next);
    setBatchReview(false);
  }
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
        const next = paged.items;
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
      setMessage('当前访问设置有未保存修改，请先保存或放弃。');
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
      const next = result.items;
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
  async function allowSelected() {
    if (busy || dirty || !batchReview || selectedUsers.size === 0) return;
    setBatchSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await client.request<BatchAllowDevelopmentUsersResponse>(
        '/admin/development-users/batch-allow',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uids: [...selectedUsers.keys()] }),
        },
      );
      const levels = new Map(result.items.map((item) => [item.uid, item.accessLevel]));
      const update = (user: AccessUser) =>
        levels.has(user.uid) ? { ...user, accessLevel: levels.get(user.uid)! } : user;
      setUsers((current) => current.map(update));
      setSource((current) => (current ? update(current) : null));
      setDraft((current) => (current ? update(current) : null));
      setSelectedUsers(new Map());
      setBatchReview(false);
      setMessage(
        `已开放 ${result.items.length} 位用户，${result.changedCount} 位新增准入，${result.unchangedCount} 位保留原访问权限。`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '批量开放失败，请重试');
    } finally {
      setBatchSaving(false);
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
      <section className="development-batch-controls" aria-label="批量开放发展端访问">
        <label className="development-batch-select-page">
          <input
            type="checkbox"
            aria-label="选择当前页用户"
            checked={currentPageSelected}
            disabled={busy || !users.length}
            onChange={(event) => toggleUsers(users, event.target.checked)}
          />
          选择当前页用户
        </label>
        <span>已选择 {selectedUsers.size} 位用户（最多 100 位）</span>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !selectedUsers.size}
          onClick={() => {
            setSelectedUsers(new Map());
            setBatchReview(false);
          }}
        >
          清空选择
        </button>
        <button
          type="button"
          disabled={busy || dirty || !selectedUsers.size}
          onClick={() => {
            setBatchReview(true);
            setError('');
          }}
        >
          批量开放所选用户
        </button>
        <p>
          跨页与搜索会保留勾选；仅开放已选择用户，保留已有负责人权限。
          {dirty ? '请先保存或放弃当前访问设置修改。' : ''}
        </p>
      </section>
      {batchReview ? (
        <section className="development-batch-review" aria-label="确认批量开放">
          <p>
            将允许以下 {selectedUsers.size}{' '}
            位用户访问发展端，已有访问权限保持不变，不授予业务管理员身份：
          </p>
          <ul>
            {[...selectedUsers].map(([uid, username]) => (
              <li key={uid}>
                {username}（{uid}）
              </li>
            ))}
          </ul>
          <div>
            <button type="button" disabled={busy || dirty} onClick={() => void allowSelected()}>
              {batchSaving ? '正在批量开放…' : `确认开放 ${selectedUsers.size} 位用户`}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setBatchReview(false)}
            >
              取消批量开放
            </button>
          </div>
        </section>
      ) : null}
      <div className="development-directory-layout">
        <aside className="development-user-directory" aria-label="用户列表">
          {!users.length && !loading ? <p>没有找到符合条件的用户。</p> : null}
          {users.map((user) => (
            <div className="development-batch-user" key={user.uid}>
              <input
                type="checkbox"
                aria-label={`选择 ${user.username}`}
                checked={selectedUsers.has(user.uid)}
                disabled={busy}
                onChange={(event) => toggleUsers([user], event.target.checked)}
              />
              <button
                type="button"
                aria-label={`编辑 ${user.username} 的访问设置`}
                className="development-user-row"
                data-active={user.uid === draft?.uid}
                disabled={busy}
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
            </div>
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
              {auth?.authMode === 'main' &&
              auth.user &&
              isSuperAdmin(auth.user) &&
              auth.user.viewer?.canPreviewDevelopment === true ? (
                <IdentityPreviewButton
                  uid={draft.uid}
                  disabled={dirty || busy || source?.accessLevel == null}
                />
              ) : null}
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
                    disabled={busy}
                    aria-pressed={draft.accessLevel === value}
                    onClick={() => {
                      setDraft({ ...draft, accessLevel: value });
                      setBatchReview(false);
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
                  disabled={!dirty || busy}
                  onClick={() => select(source)}
                >
                  放弃修改
                </button>
                <button type="button" disabled={!dirty || busy} onClick={() => void save()}>
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
