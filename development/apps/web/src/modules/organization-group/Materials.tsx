import { useEffect, useState } from 'react';
import type {
  OrganizationGroupDeadline,
  OrganizationGroupResource,
  OrganizationGroupScope,
  OrganizationGroupFile,
  OrganizationGroupWorkspace,
  OrganizationGroupYear,
} from '@freebbs-development/contracts';
import type { GroupClient } from './OrganizationGroupPage.js';
import { FileTile, uploadFile } from './Files.js';
import { jsonOptions } from './api.js';
import {
  displayShanghai,
  errorMessage,
  queryString,
  shanghaiInput,
  shanghaiTimestamp,
} from './model.js';

export function Materials({
  api,
  workspace,
  year,
}: {
  api: GroupClient;
  workspace: OrganizationGroupWorkspace;
  year: OrganizationGroupYear;
}) {
  const [deadlines, setDeadlines] = useState<OrganizationGroupDeadline[]>([]);
  const [resources, setResources] = useState<OrganizationGroupResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [deadlineEdit, setDeadlineEdit] = useState<OrganizationGroupDeadline | null | undefined>(
    undefined,
  );
  const [resourceEdit, setResourceEdit] = useState<OrganizationGroupResource | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    setDeadlines([]);
    setResources([]);
    Promise.all([
      api.request<{ items: OrganizationGroupDeadline[] }>(
        `/organization-group/deadlines?${queryString({ yearId: year.id })}`,
      ),
      api.request<{ items: OrganizationGroupResource[] }>(
        `/organization-group/resources?${queryString({ yearId: year.id })}`,
      ),
    ]).then(
      ([ddl, res]) => {
        if (live) {
          setDeadlines(ddl.items);
          setResources(res.items);
          setLoading(false);
        }
      },
      (cause) => {
        if (live) {
          setError(errorMessage(cause));
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [api, year.id, refresh]);
  useEffect(() => {
    setDeadlineEdit(undefined);
    setResourceEdit(undefined);
  }, [year.id]);
  const saved = () => {
    setDeadlineEdit(undefined);
    setResourceEdit(undefined);
    setRefresh((value) => value + 1);
  };
  return (
    <div className="og-materials">
      {workspace.canManage ? (
        <div className="og-actions og-management-actions">
          <button
            className="og-primary"
            type="button"
            onClick={() => {
              setDeadlineEdit(null);
              setResourceEdit(undefined);
            }}
          >
            添加截止事项
          </button>
          <button
            type="button"
            onClick={() => {
              setResourceEdit(null);
              setDeadlineEdit(undefined);
            }}
          >
            发布资料
          </button>
        </div>
      ) : null}
      {deadlineEdit !== undefined && workspace.canManage ? (
        <DeadlineEditor
          key={deadlineEdit?.id ?? 'new'}
          api={api}
          workspace={workspace}
          year={year}
          original={deadlineEdit}
          onSaved={saved}
          onCancel={() => setDeadlineEdit(undefined)}
        />
      ) : null}
      {resourceEdit !== undefined && workspace.canManage ? (
        <ResourceEditor
          key={resourceEdit?.id ?? 'new'}
          api={api}
          workspace={workspace}
          year={year}
          deadlines={deadlines}
          original={resourceEdit}
          onSaved={saved}
          onCancel={() => setResourceEdit(undefined)}
        />
      ) : null}
      {error ? (
        <p role="alert" className="og-notice">
          {error}
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            重新加载资料
          </button>
        </p>
      ) : null}
      {loading ? <p role="status">正在加载截止事项与资料…</p> : null}
      <section className="og-panel">
        <div className="og-panel-heading">
          <div>
            <h2>截止事项</h2>
            <p>时间均为北京时间，按即将截止、已过期、已取消分别展示。</p>
          </div>
          <span className="og-badge">{deadlines.length} 项</span>
        </div>
        {(['upcoming', 'expired', 'cancelled'] as const).map((status) => {
          const items = deadlines.filter((item) => item.displayStatus === status);
          return items.length ? (
            <div className="og-deadline-group" key={status}>
              <h3>
                {status === 'upcoming' ? '即将截止' : status === 'expired' ? '已过期' : '已取消'}
              </h3>
              {items.map((item) => (
                <article className="og-deadline" key={item.id}>
                  <div className="og-deadline-date">
                    <small>
                      {status === 'upcoming' ? '截止' : status === 'expired' ? '过期' : '取消'}
                    </small>
                    <strong>{displayShanghai(item.dueAt)}</strong>
                  </div>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                    <small>{scopeLabel(item.scope, workspace)}</small>
                    <div className="og-file-grid">
                      {resources
                        .filter((resource) => resource.deadlineId === item.id)
                        .map((resource) => (
                          <div key={resource.id}>
                            <h4>{resource.title}</h4>
                            <FileTile file={resource.file} api={api} />
                          </div>
                        ))}
                    </div>
                  </div>
                  {workspace.canManage ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDeadlineEdit(item);
                        setResourceEdit(undefined);
                      }}
                    >
                      编辑事项
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null;
        })}
        {!loading && !deadlines.length ? (
          <div className="og-empty">
            <p>当前学年暂无可查看的截止事项。</p>
          </div>
        ) : null}
      </section>
      <section className="og-panel">
        <div className="og-panel-heading">
          <div>
            <h2>资料库</h2>
            <p>图片与 PDF 可在站内预览，其余支持的文档与压缩包直接下载。</p>
          </div>
          <span className="og-badge">{resources.length} 份</span>
        </div>
        <div className="og-resource-grid">
          {resources.map((item) => (
            <article className="og-resource" key={item.id}>
              <h3>{item.title}</h3>
              {item.description ? <p>{item.description}</p> : null}
              <small>
                {scopeLabel(item.scope, workspace)}
                {item.deadlineId
                  ? ` · 关联：${deadlines.find((ddl) => ddl.id === item.deadlineId)?.title ?? '截止事项'}`
                  : ''}
              </small>
              <FileTile file={item.file} api={api} />
              {workspace.canManage ? (
                <button
                  type="button"
                  onClick={() => {
                    setResourceEdit(item);
                    setDeadlineEdit(undefined);
                  }}
                >
                  编辑资料 / 替换附件
                </button>
              ) : null}
            </article>
          ))}
        </div>
        {!loading && !resources.length ? (
          <div className="og-empty">
            <p>当前学年暂无可查看的资料。</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
function scopeLabel(scope: OrganizationGroupScope, workspace: OrganizationGroupWorkspace) {
  if (scope.kind === 'all') return '全部有访问权成员';
  if (scope.kind === 'department') return '组织组成员';
  if (scope.kind === 'classes')
    return `指定班级：${scope.ids.map((id) => workspace.classes.find((item) => item.id === id)?.label ?? id).join('、')}`;
  return '指定用户';
}
function ScopePicker({
  scope,
  onChange,
  workspace,
  usersText,
  onUsersTextChange,
}: {
  scope: OrganizationGroupScope;
  onChange: (scope: OrganizationGroupScope) => void;
  workspace: OrganizationGroupWorkspace;
  usersText: string;
  onUsersTextChange: (value: string) => void;
}) {
  return (
    <div className="og-fields og-span">
      <label>
        可见范围
        <select
          value={scope.kind}
          onChange={(event) => {
            const kind = event.target.value as OrganizationGroupScope['kind'];
            onChange(kind === 'classes' || kind === 'users' ? { kind, ids: [] } : { kind });
          }}
        >
          <option value="all">全部有访问权成员</option>
          <option value="department">组织组成员</option>
          <option value="classes">指定班级</option>
          <option value="users">指定用户</option>
        </select>
      </label>
      {scope.kind === 'classes' ? (
        <fieldset className="og-multiple">
          <legend>选择可见班级</legend>
          <div className="og-checks">
            {workspace.classes.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={scope.ids.includes(item.id)}
                  onChange={(event) =>
                    onChange({
                      kind: 'classes',
                      ids: event.target.checked
                        ? [...scope.ids, item.id]
                        : scope.ids.filter((id) => id !== item.id),
                    })
                  }
                />
                {item.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : scope.kind === 'users' ? (
        <label>
          可见用户 UID
          <textarea
            rows={3}
            value={usersText}
            onChange={(event) => onUsersTextChange(event.target.value)}
          />
          <small>每行一个已配置目录成员的 UID。</small>
        </label>
      ) : null}
    </div>
  );
}
function validateScope(scope: OrganizationGroupScope, workspace: OrganizationGroupWorkspace) {
  if (scope.kind === 'classes' || scope.kind === 'users') {
    if (!scope.ids.length) throw new Error('请至少指定一个可见班级或用户。');
    const known = new Set(
      scope.kind === 'classes'
        ? workspace.classes.map((item) => item.id)
        : [...workspace.members.map((item) => item.uid), ...workspace.managerUids],
    );
    if (scope.ids.some((id) => !known.has(id))) throw new Error('可见范围包含未配置的班级或用户。');
  }
}
function DeadlineEditor({
  api,
  workspace,
  year,
  original,
  onSaved,
  onCancel,
}: {
  api: GroupClient;
  workspace: OrganizationGroupWorkspace;
  year: OrganizationGroupYear;
  original: OrganizationGroupDeadline | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    title: original?.title ?? '',
    description: original?.description ?? '',
    dueAt: original ? shanghaiInput(original.dueAt) : '',
    scope: original?.scope ?? ({ kind: 'department' } as OrganizationGroupScope),
    status: original?.status ?? ('active' as 'active' | 'cancelled'),
  });
  const [revision, setRevision] = useState(original?.revision);
  const [usersText, setUsersText] = useState(
    original?.scope.kind === 'users' ? original.scope.ids.join('\n') : '',
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [latest, setLatest] = useState<OrganizationGroupDeadline | null>(null);
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      if (!draft.title.trim()) throw new Error('请填写事项标题。');
      const scope: OrganizationGroupScope =
        draft.scope.kind === 'users'
          ? { kind: 'users', ids: usersText.split(/[\s,，]+/).filter(Boolean) }
          : draft.scope;
      validateScope(scope, workspace);
      await api.request(
        original
          ? `/organization-group/deadlines/${encodeURIComponent(original.id)}`
          : '/organization-group/deadlines',
        jsonOptions(original ? 'PATCH' : 'POST', {
          ...draft,
          scope,
          dueAt: shanghaiTimestamp(draft.dueAt),
          ...(original ? { revision } : { yearId: year.id }),
        }),
      );
      onSaved();
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    try {
      const result = await api.request<{ items: OrganizationGroupDeadline[] }>(
        `/organization-group/deadlines?${queryString({ yearId: year.id })}`,
      );
      const current = result.items.find((item) => item.id === original?.id);
      if (current) setLatest(current);
      else throw new Error('当前事项已不可查看，请返回列表。');
    } catch (cause) {
      setMessage(errorMessage(cause));
    }
  }
  return (
    <section className="og-panel">
      <h2>{original ? '编辑截止事项' : '添加截止事项'}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset className="og-fields" disabled={busy}>
          <label>
            事项标题
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
            />
          </label>
          <label>
            截止时间（北京时间）
            <input
              type="datetime-local"
              value={draft.dueAt}
              onChange={(event) =>
                setDraft((current) => ({ ...current, dueAt: event.target.value }))
              }
            />
          </label>
          <label className="og-span">
            事项说明
            <textarea
              rows={3}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>
          <ScopePicker
            workspace={workspace}
            scope={draft.scope}
            onChange={(scope) => setDraft((current) => ({ ...current, scope }))}
            usersText={usersText}
            onUsersTextChange={setUsersText}
          />
          <label>
            事项状态
            <select
              value={draft.status}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  status: event.target.value as 'active' | 'cancelled',
                }))
              }
            >
              <option value="active">有效</option>
              <option value="cancelled">已取消</option>
            </select>
          </label>
        </fieldset>
        {message ? (
          <p role="alert" className="og-notice">
            {message}
          </p>
        ) : null}
        {original && message ? (
          <div className="og-conflict">
            <button type="button" disabled={busy} onClick={() => void reload()}>
              读取事项最新修订
            </button>
            {latest ? (
              <>
                <p>
                  最新事项：{latest.title} · {displayShanghai(latest.dueAt)} · 修订{' '}
                  {latest.revision}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setRevision(latest.revision);
                    setLatest(null);
                    setMessage('最新修订已核对，当前草稿保留。');
                  }}
                >
                  确认采用最新修订
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        <div className="og-actions">
          <button className="og-primary" disabled={busy}>
            {busy ? '保存中…' : '保存事项'}
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
        </div>
      </form>
    </section>
  );
}
function ResourceEditor({
  api,
  workspace,
  year,
  deadlines,
  original,
  onSaved,
  onCancel,
}: {
  api: GroupClient;
  workspace: OrganizationGroupWorkspace;
  year: OrganizationGroupYear;
  deadlines: OrganizationGroupDeadline[];
  original: OrganizationGroupResource | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    title: original?.title ?? '',
    description: original?.description ?? '',
    scope: original?.scope ?? ({ kind: 'department' } as OrganizationGroupScope),
    deadlineId: original?.deadlineId ?? '',
  });
  const [file, setFile] = useState<OrganizationGroupFile | null>(original?.file ?? null);
  const [usersText, setUsersText] = useState(
    original?.scope.kind === 'users' ? original.scope.ids.join('\n') : '',
  );
  const [revision, setRevision] = useState(original?.revision);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [latest, setLatest] = useState<OrganizationGroupResource | null>(null);
  async function choose(selected?: File) {
    if (!selected) return;
    setUploading(true);
    setMessage('');
    try {
      if (selected.size > workspace.maxResourceBytes)
        throw new Error(
          `资料附件不得超过 ${Math.round(workspace.maxResourceBytes / 1048576)} MiB。`,
        );
      const uploaded = await uploadFile(api, selected, year.id, 'resource');
      setFile(uploaded);
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setUploading(false);
    }
  }
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      if (!draft.title.trim()) throw new Error('请填写资料标题。');
      if (!file) throw new Error('请上传资料附件。');
      const scope: OrganizationGroupScope =
        draft.scope.kind === 'users'
          ? { kind: 'users', ids: usersText.split(/[\s,，]+/).filter(Boolean) }
          : draft.scope;
      validateScope(scope, workspace);
      await api.request(
        original
          ? `/organization-group/resources/${encodeURIComponent(original.id)}`
          : '/organization-group/resources',
        jsonOptions(original ? 'PATCH' : 'POST', {
          ...draft,
          scope,
          deadlineId: draft.deadlineId || null,
          fileId: file.id,
          ...(original ? { revision } : { yearId: year.id }),
        }),
      );
      onSaved();
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    try {
      const result = await api.request<{ items: OrganizationGroupResource[] }>(
        `/organization-group/resources?${queryString({ yearId: year.id })}`,
      );
      const current = result.items.find((item) => item.id === original?.id);
      if (current) setLatest(current);
      else throw new Error('当前资料已不可查看，请返回列表。');
    } catch (cause) {
      setMessage(errorMessage(cause));
    }
  }
  return (
    <section className="og-panel">
      <h2>{original ? '编辑资料与附件' : '发布资料'}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset className="og-fields" disabled={busy || uploading}>
          <label>
            资料标题
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
            />
          </label>
          <label>
            关联截止事项
            <select
              value={draft.deadlineId}
              onChange={(event) =>
                setDraft((current) => ({ ...current, deadlineId: event.target.value }))
              }
            >
              <option value="">不关联</option>
              {deadlines.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <small>资料可见范围同时受关联事项限制。</small>
          </label>
          <label className="og-span">
            资料说明
            <textarea
              rows={3}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>
          <ScopePicker
            workspace={workspace}
            scope={draft.scope}
            onChange={(scope) => setDraft((current) => ({ ...current, scope }))}
            usersText={usersText}
            onUsersTextChange={setUsersText}
          />
          <label className="og-span">
            {original ? '替换资料附件' : '资料附件'}
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z"
              onChange={(event) => void choose(event.target.files?.[0])}
            />
            <small>
              上限 {Math.round(workspace.maxResourceBytes / 1048576)} MiB；替换附件在保存后生效。
            </small>
          </label>
        </fieldset>
        {uploading ? <p role="status">正在上传资料…</p> : null}
        {file ? <FileTile file={file} api={api} /> : null}
        {message ? (
          <p role="alert" className="og-notice">
            {message}
          </p>
        ) : null}
        {original && message ? (
          <div className="og-conflict">
            <button type="button" disabled={busy || uploading} onClick={() => void reload()}>
              读取资料最新修订
            </button>
            {latest ? (
              <>
                <p>
                  最新资料：{latest.title} · {latest.file.originalName} · 修订 {latest.revision}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setRevision(latest.revision);
                    setLatest(null);
                    setMessage('已核对最新修订，草稿和已上传附件保留。');
                  }}
                >
                  确认采用最新修订
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        <div className="og-actions">
          <button className="og-primary" disabled={busy || uploading}>
            {busy ? '保存中…' : '保存资料'}
          </button>
          <button type="button" disabled={busy || uploading} onClick={onCancel}>
            取消
          </button>
        </div>
      </form>
    </section>
  );
}
