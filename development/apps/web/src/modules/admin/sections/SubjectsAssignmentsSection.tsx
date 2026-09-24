import {
  ROLE_KEYS,
  type AdminRole,
  type AdminRoleAssignment,
  type AdminSubject,
  type AdminTagAssignment,
  type AdminTagDefinition,
  type Page,
  type RoleKey,
} from '@freebbs-development/contracts';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import {
  errorMessage,
  Feedback,
  queryPath,
  SectionState,
  toIsoOrNull,
  type AdminClient,
} from '../admin-support.js';

const emptyPage = <T,>(): Page<T> => ({ items: [], page: 1, pageSize: 20, total: 0 });

function Paging({
  value,
  label,
  onPage,
}: {
  value: Page<unknown>;
  label: string;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(value.total / value.pageSize));
  const directionLabel = label.startsWith('Tag') ? ` ${label}` : label;
  return (
    <div className="admin-pagination" aria-label={`${label}分页`}>
      <button
        type="button"
        aria-label={`上一页${directionLabel}`}
        disabled={value.page <= 1}
        onClick={() => onPage(value.page - 1)}
      >
        上一页
      </button>
      <span>
        第 {value.page} / {pages} 页 · 共 {value.total} 条
      </span>
      <button
        type="button"
        aria-label={`下一页${directionLabel}`}
        disabled={value.page >= pages}
        onClick={() => onPage(value.page + 1)}
      >
        下一页
      </button>
    </div>
  );
}
export function SubjectsAssignmentsSection({ client }: { client: AdminClient }) {
  const [subjects, setSubjects] = useState<Page<AdminSubject>>(emptyPage);
  const [, setRoles] = useState<AdminRole[]>([]);
  const [roleAssignments, setRoleAssignments] = useState<Page<AdminRoleAssignment>>(emptyPage);
  const [tagDefinitions, setTagDefinitions] = useState<AdminTagDefinition[]>([]);
  const [tagAssignments, setTagAssignments] = useState<Page<AdminTagAssignment>>(emptyPage);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [roleUid, setRoleUid] = useState('');
  const [roleKey, setRoleKey] = useState<RoleKey>(ROLE_KEYS[0]);
  const [roleScopeType, setRoleScopeType] = useState('public');
  const [roleScopeId, setRoleScopeId] = useState('*');
  const [roleExpiry, setRoleExpiry] = useState('');
  const [tagUid, setTagUid] = useState('');
  const [tagKey, setTagKey] = useState('sports.team_captain');
  const [tagScopeType, setTagScopeType] = useState('sports_team');
  const [tagScopeId, setTagScopeId] = useState('');
  const [tagExpiry, setTagExpiry] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextSubjects, nextRoles, nextRoleAssignments, nextTags, nextTagAssignments] =
        await Promise.all([
          client.request<Page<AdminSubject>>('/admin/subjects?page=1&pageSize=20'),
          client.request<AdminRole[]>('/admin/roles'),
          client.request<Page<AdminRoleAssignment>>('/admin/role-assignments?page=1&pageSize=20'),
          client.request<AdminTagDefinition[]>('/admin/tag-definitions'),
          client.request<Page<AdminTagAssignment>>('/admin/tag-assignments?page=1&pageSize=20'),
        ]);
      setSubjects(nextSubjects);
      setRoles(nextRoles);
      setRoleAssignments(nextRoleAssignments);
      setTagDefinitions(nextTags);
      setTagAssignments(nextTagAssignments);
      if (nextTags[0]) setTagKey(nextTags[0].key);
    } catch (caught) {
      setLoadError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => void load(), [load]);

  async function filterSubjects(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      setSubjects(
        await client.request<Page<AdminSubject>>(
          queryPath('/admin/subjects', {
            query: search || undefined,
            status: status || undefined,
            page: 1,
            pageSize: 20,
          }),
        ),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function pageSubjects(page: number) {
    setError('');
    try {
      setSubjects(
        await client.request<Page<AdminSubject>>(
          queryPath('/admin/subjects', {
            query: search || undefined,
            status: status || undefined,
            page,
            pageSize: subjects.pageSize,
          }),
        ),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function pageRoleAssignments(page: number) {
    setError('');
    try {
      setRoleAssignments(
        await client.request<Page<AdminRoleAssignment>>(
          queryPath('/admin/role-assignments', { page, pageSize: roleAssignments.pageSize }),
        ),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function pageTagAssignments(page: number) {
    setError('');
    try {
      setTagAssignments(
        await client.request<Page<AdminTagAssignment>>(
          queryPath('/admin/tag-assignments', { page, pageSize: tagAssignments.pageSize }),
        ),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }
  async function grantRole(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!roleUid.trim() || !roleScopeType.trim() || !roleScopeId.trim()) {
      setError('请完整填写用户 UID 和作用域。');
      return;
    }
    if (
      !window.confirm(
        `确认授予角色？\nUID: ${roleUid.trim()}\nKey: ${roleKey}\n作用域: ${roleScopeType.trim()}:${roleScopeId.trim()}\n影响: 该操作会立即向此 UID 授予角色对应的全部有效权限。`,
      )
    )
      return;
    setBusy(true);
    try {
      const created = await client.request<AdminRoleAssignment>('/admin/role-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectUid: roleUid.trim(),
          roleKey,
          scope: { type: roleScopeType.trim(), id: roleScopeId.trim() },
          expiresAt: toIsoOrNull(roleExpiry),
        }),
      });
      setRoleAssignments((current) => ({
        ...current,
        items: [created, ...current.items],
        total: current.total + 1,
      }));
      setSuccess(`已向 ${created.subjectUid} 授予 ${created.roleKey}。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function grantTag(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!tagUid.trim() || !tagKey.trim() || !tagScopeType.trim() || !tagScopeId.trim()) {
      setError('请完整填写用户 UID、Tag 和作用域。');
      return;
    }
    if (
      !window.confirm(
        `确认授予 Tag？\nUID: ${tagUid.trim()}\nKey: ${tagKey.trim()}\n作用域: ${tagScopeType.trim()}:${tagScopeId.trim()}\n影响: 该操作会立即向此 UID 授予 Tag 对应的作用域权限。`,
      )
    )
      return;
    setBusy(true);
    try {
      const created = await client.request<AdminTagAssignment>('/admin/tag-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectUid: tagUid.trim(),
          tagKey: tagKey.trim(),
          scope: { type: tagScopeType.trim(), id: tagScopeId.trim() },
          expiresAt: toIsoOrNull(tagExpiry),
        }),
      });
      setTagAssignments((current) => ({
        ...current,
        items: [created, ...current.items],
        total: current.total + 1,
      }));
      setSuccess(`已向 ${created.subjectUid} 授予 ${created.tagKey}。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function archive(
    kind: 'role' | 'tag',
    assignment: AdminRoleAssignment | AdminTagAssignment,
  ) {
    const key = 'roleKey' in assignment ? assignment.roleKey : assignment.tagKey;
    const impact =
      kind === 'role'
        ? '归档后，该用户将立即失去此角色提供的权限。'
        : '归档后，该用户将立即失去此 Tag 提供的作用域权限。';
    if (
      !window.confirm(
        `确认归档授权？\nUID: ${assignment.subjectUid}\nKey: ${key}\n作用域: ${assignment.scope.type}:${assignment.scope.id}\n影响: ${impact}`,
      )
    )
      return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await client.request(
        `/admin/${kind === 'role' ? 'role' : 'tag'}-assignments/${assignment.id}`,
        { method: 'DELETE' },
      );
      if (kind === 'role') {
        setRoleAssignments((current) => ({
          ...current,
          items: current.items.filter(({ id }) => id !== assignment.id),
          total: Math.max(0, current.total - 1),
        }));
      } else {
        setTagAssignments((current) => ({
          ...current,
          items: current.items.filter(({ id }) => id !== assignment.id),
          total: Math.max(0, current.total - 1),
        }));
      }
      setSuccess(`已归档 ${assignment.subjectUid} 的 ${key} 授权。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-section-layout" aria-labelledby="subjects-heading">
      <header className="admin-section-heading">
        <p className="eyebrow">IDENTITY &amp; GRANTS</p>
        <h3 id="subjects-heading">用户与授权</h3>
        <p>只通过受审计 API 查找主站 UID，并管理具有明确作用域与期限的授权。</p>
      </header>
      <Feedback error={error} success={success} />
      <SectionState loading={loading} error={loadError} onRetry={() => void load()}>
        <div className="admin-two-column">
          <section className="panel" aria-labelledby="subject-directory-heading">
            <h4 id="subject-directory-heading">用户目录</h4>
            <form className="admin-filter-row filter-bar" role="search" onSubmit={filterSubjects}>
              <label>
                搜索用户
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                />
              </label>
              <label>
                用户状态
                <select value={status} onChange={(event) => setStatus(event.currentTarget.value)}>
                  <option value="">全部</option>
                  <option value="active">启用</option>
                  <option value="inactive">停用</option>
                </select>
              </label>
              <button type="submit">筛选用户</button>
            </form>
            {subjects.items.length ? (
              <ul className="record-list responsive-record-list">
                {subjects.items.map((item) => (
                  <li key={item.id} className="record-card">
                    <div>
                      <strong>{item.displayName}</strong>
                      <p>{item.uid}</p>
                    </div>
                    <span className="status-badge" data-status="success">
                      {item.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="record-list-state">没有匹配用户。</p>
            )}
            <p className="admin-page-summary">
              第 {subjects.page} 页 · 共 {subjects.total} 位用户
            </p>
            <Paging value={subjects} label="用户" onPage={(page) => void pageSubjects(page)} />
          </section>

          <section className="panel">
            <h4>授予角色</h4>
            <form aria-label="授予角色" onSubmit={grantRole}>
              <label>
                用户 UID
                <input
                  value={roleUid}
                  onChange={(event) => setRoleUid(event.currentTarget.value)}
                />
              </label>
              <label>
                角色
                <select
                  value={roleKey}
                  onChange={(event) => setRoleKey(event.currentTarget.value as RoleKey)}
                >
                  {ROLE_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </label>
              <div className="admin-form-grid">
                <label>
                  作用域类型
                  <input
                    value={roleScopeType}
                    onChange={(event) => setRoleScopeType(event.currentTarget.value)}
                  />
                </label>
                <label>
                  作用域 ID
                  <input
                    value={roleScopeId}
                    onChange={(event) => setRoleScopeId(event.currentTarget.value)}
                  />
                </label>
              </div>
              <label>
                到期时间
                <input
                  type="datetime-local"
                  value={roleExpiry}
                  onChange={(event) => setRoleExpiry(event.currentTarget.value)}
                />
              </label>
              <button type="submit" disabled={busy}>
                授予角色
              </button>
            </form>
          </section>

          <section className="panel">
            <h4>角色授权记录</h4>
            {roleAssignments.items.length ? (
              <ul className="record-list responsive-record-list">
                {roleAssignments.items.map((assignment) => (
                  <li key={assignment.id} className="record-card">
                    <div>
                      <strong>{assignment.subjectUid}</strong>
                      <p>{assignment.roleKey}</p>
                      <small>
                        {assignment.scope.type}:{assignment.scope.id} ·{' '}
                        {assignment.expiresAt ?? '长期有效'}
                      </small>
                    </div>
                    <button
                      className="danger-button"
                      type="button"
                      disabled={busy}
                      aria-label={`归档 ${assignment.subjectUid} 的角色授权`}
                      onClick={() => void archive('role', assignment)}
                    >
                      归档
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="record-list-state">暂无角色授权。</p>
            )}
            <Paging
              value={roleAssignments}
              label="角色授权"
              onPage={(page) => void pageRoleAssignments(page)}
            />
          </section>

          <section className="panel">
            <h4>授予 Tag</h4>
            <form aria-label="授予 Tag" onSubmit={grantTag}>
              <label>
                Tag 用户 UID
                <input value={tagUid} onChange={(event) => setTagUid(event.currentTarget.value)} />
              </label>
              <label>
                Tag
                <input
                  list="tag-definition-options"
                  value={tagKey}
                  onChange={(event) => setTagKey(event.currentTarget.value)}
                />
                <datalist id="tag-definition-options">
                  {tagDefinitions.map(({ key }) => (
                    <option key={key} value={key} />
                  ))}
                </datalist>
              </label>
              <div className="admin-form-grid">
                <label>
                  Tag 作用域类型
                  <input
                    value={tagScopeType}
                    onChange={(event) => setTagScopeType(event.currentTarget.value)}
                  />
                </label>
                <label>
                  Tag 作用域 ID
                  <input
                    value={tagScopeId}
                    onChange={(event) => setTagScopeId(event.currentTarget.value)}
                  />
                </label>
              </div>
              <label>
                Tag 到期时间
                <input
                  type="datetime-local"
                  value={tagExpiry}
                  onChange={(event) => setTagExpiry(event.currentTarget.value)}
                />
              </label>
              <button type="submit" disabled={busy}>
                授予 Tag
              </button>
            </form>
            {tagAssignments.items.length ? (
              <ul className="record-list responsive-record-list">
                {tagAssignments.items.map((assignment) => (
                  <li key={assignment.id} className="record-card">
                    <div>
                      <strong>{assignment.subjectUid}</strong>
                      <p>{assignment.tagKey}</p>
                      <small>
                        {assignment.scope.type}:{assignment.scope.id}
                      </small>
                    </div>
                    <button
                      className="danger-button"
                      type="button"
                      disabled={busy}
                      aria-label={`归档 ${assignment.subjectUid} 的 Tag 授权`}
                      onClick={() => void archive('tag', assignment)}
                    >
                      归档
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="record-list-state">暂无 Tag 授权。</p>
            )}
            <Paging
              value={tagAssignments}
              label="Tag 授权"
              onPage={(page) => void pageTagAssignments(page)}
            />
          </section>
        </div>
      </SectionState>
    </section>
  );
}
