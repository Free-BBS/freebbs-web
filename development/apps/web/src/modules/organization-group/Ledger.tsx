import { useEffect, useState } from 'react';
import type {
  OrganizationGroupEditContext,
  OrganizationGroupEntry,
  OrganizationGroupEntryList,
  OrganizationGroupWorkspace,
  OrganizationGroupYear,
} from '@freebbs-development/contracts';
import type { GroupClient } from './OrganizationGroupPage.js';
import { EntryForm } from './EntryForm.js';
import { FileTile, downloadBlob } from './Files.js';
import { displayShanghai, errorMessage, queryString } from './model.js';
import { jsonOptions } from './api.js';
export function Ledger({
  api,
  workspace,
  year,
  refresh,
}: {
  api: GroupClient;
  workspace: OrganizationGroupWorkspace;
  year: OrganizationGroupYear;
  refresh: number;
}) {
  const [filters, setFilters] = useState({
    classId: '',
    activityTypeId: '',
    authorUid: '',
    dateFrom: '',
    dateTo: '',
    query: '',
    sort: 'created_desc',
  });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<OrganizationGroupEntryList | null>(null);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<OrganizationGroupEntry | null>(null);
  const [editing, setEditing] = useState<OrganizationGroupEditContext | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const query = queryString({ yearId: year.id, ...filters, page, pageSize: 20 });
  useEffect(() => {
    let live = true;
    setRows(null);
    setError('');
    api.request<OrganizationGroupEntryList>(`/organization-group/entries?${query}`).then(
      (data) => {
        if (live) setRows(data);
      },
      (cause) => {
        if (live) setError(errorMessage(cause));
      },
    );
    return () => {
      live = false;
    };
  }, [api, query, refresh, revision]);
  useEffect(() => {
    setDetail(null);
    setEditing(null);
    setPage(1);
  }, [year.id]);
  function filter(key: keyof typeof filters, value: string) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }
  async function open(id: string) {
    setBusy(true);
    try {
      setDetail(
        await api.request<OrganizationGroupEntry>(
          `/organization-group/entries/${encodeURIComponent(id)}`,
        ),
      );
      setEditing(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function edit() {
    if (!detail?.canEdit) return;
    setBusy(true);
    try {
      setEditing(
        await api.request<OrganizationGroupEditContext>(
          `/organization-group/entries/${encodeURIComponent(detail.id)}/edit-context`,
        ),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function lock() {
    if (!detail) return;
    setBusy(true);
    try {
      setDetail(
        await api.request<OrganizationGroupEntry>(
          `/organization-group/entries/${encodeURIComponent(detail.id)}/lock`,
          jsonOptions('PATCH', { revision: detail.revision, locked: !detail.locked }),
        ),
      );
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const original = detail
    ? workspace.versions.find((item) => item.id === detail.versionId)
    : undefined;
  if (editing)
    return (
      <EntryForm
        key={editing.entry.id}
        api={api}
        workspace={workspace}
        year={year}
        version={editing.version}
        entry={editing.entry}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setRevision((value) => value + 1);
          void open(editing.entry.id);
        }}
      />
    );
  if (detail)
    return (
      <section className="og-panel">
        <div className="og-panel-heading">
          <div>
            <h2>{detail.activityTypeLabel}</h2>
            <p>
              {detail.classLabel} · {detail.authorName} · {detail.participantCount} 人次
            </p>
          </div>
          <button type="button" onClick={() => setDetail(null)}>
            返回台账
          </button>
        </div>
        <div className="og-actions">
          <span className="og-badge">问卷 v{original?.number ?? detail.versionId}</span>
          <span className="og-badge">{detail.locked ? '已锁定' : '未锁定'}</span>
          <small>{displayShanghai(detail.createdAt)}</small>
        </div>
        <dl className="og-detail">
          <div>
            <dt>活动日期</dt>
            <dd>{detail.activityDate ?? '未填写'}</dd>
          </div>
          <div>
            <dt>活动概要</dt>
            <dd>{detail.summary}</dd>
          </div>
          {detail.difficulties !== undefined ? (
            <div>
              <dt>困难反馈</dt>
              <dd>{detail.difficulties || '未填写'}</dd>
            </div>
          ) : null}
          {original?.fields.map((field) => (
            <div key={field.id}>
              <dt>{field.label}</dt>
              <dd>
                {field.kind === 'image' ? (
                  <div className="og-file-grid">
                    {detail.extraPhotos
                      .filter(
                        (file) =>
                          Array.isArray(detail.extraAnswers[field.id]) &&
                          (detail.extraAnswers[field.id] as string[]).includes(file.id),
                      )
                      .map((file) => (
                        <FileTile key={file.id} api={api} file={file} />
                      ))}
                  </div>
                ) : Array.isArray(detail.extraAnswers[field.id]) ? (
                  (detail.extraAnswers[field.id] as string[]).join('、')
                ) : (
                  String(detail.extraAnswers[field.id] ?? '未填写')
                )}
              </dd>
            </div>
          ))}
        </dl>
        <h3>现场照片</h3>
        <div className="og-file-grid">
          {detail.photos.map((file) => (
            <FileTile key={file.id} file={file} api={api} />
          ))}
        </div>
        {error ? (
          <p role="alert" className="og-notice">
            {error}
          </p>
        ) : null}
        <div className="og-actions">
          {detail.canEdit ? (
            <button
              className="og-primary"
              type="button"
              disabled={busy}
              onClick={() => void edit()}
            >
              编辑我的活动
            </button>
          ) : (
            <small>{detail.editBlockedReason}</small>
          )}
          {workspace.canManage ? (
            <>
              <button type="button" disabled={busy} onClick={() => void lock()}>
                {detail.locked ? '解锁记录' : '锁定记录'}
              </button>
              <button type="button" disabled={busy} onClick={() => void open(detail.id)}>
                刷新当前修订
              </button>
            </>
          ) : null}
        </div>
      </section>
    );
  return (
    <section>
      <div className="og-stats" aria-label="筛选范围统计">
        <div>
          <small>活动数</small>
          <strong>{rows?.statistics.activityCount ?? '—'}</strong>
        </div>
        <div>
          <small>参与人次</small>
          <strong>{rows?.statistics.participantTimes ?? '—'}</strong>
        </div>
        <div>
          <small>当前筛选记录</small>
          <strong>{rows?.total ?? '—'}</strong>
        </div>
      </div>
      {rows ? (
        <details className="og-category-stats">
          <summary>按班级与活动类型查看统计</summary>
          <div className="og-fields">
            <section>
              <h3>班级活动数</h3>
              {Object.entries(rows.statistics.byClass).map(([id, count]) => (
                <p key={id}>
                  {workspace.classes.find((item) => item.id === id)?.label ?? id}：{count} 次
                </p>
              ))}
            </section>
            <section>
              <h3>类型活动数</h3>
              {Object.entries(rows.statistics.byActivityType).map(([id, count]) => (
                <p key={id}>
                  {workspace.versions
                    .filter((item) => item.yearId === year.id)
                    .flatMap((item) => item.activityTypes)
                    .find((item) => item.id === id)?.label ?? id}
                  ：{count} 次
                </p>
              ))}
            </section>
          </div>
        </details>
      ) : null}
      <section className="og-panel">
        <div className="og-panel-heading">
          <div>
            <h2>活动台账</h2>
            <p>统计与导出均以当前可查看、已筛选的全部记录计算。</p>
          </div>
          {workspace.canExport ? (
            <button
              type="button"
              onClick={() =>
                void downloadBlob(
                  api,
                  `/organization-group/export.xlsx?${query}`,
                  `组织组活动台账-${year.label}.xlsx`,
                ).catch((cause) => setError(errorMessage(cause)))
              }
            >
              导出 Excel
            </button>
          ) : null}
        </div>
        <div className="og-filters">
          <label>
            搜索
            <input
              aria-label="搜索活动"
              value={filters.query}
              placeholder="概要与附加回答中的关键词"
              onChange={(event) => filter('query', event.target.value)}
            />
          </label>
          <label>
            筛选班级
            <select
              value={filters.classId}
              onChange={(event) => filter('classId', event.target.value)}
            >
              <option value="">全部班级</option>
              {workspace.classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            筛选类型
            <select
              value={filters.activityTypeId}
              onChange={(event) => filter('activityTypeId', event.target.value)}
            >
              <option value="">全部类型</option>
              {Array.from(
                new Map(
                  workspace.versions
                    .filter((item) => item.yearId === year.id)
                    .flatMap((item) => item.activityTypes)
                    .map((item) => [item.id, item]),
                ).values(),
              ).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            填写人 UID
            <input
              value={filters.authorUid}
              onChange={(event) => filter('authorUid', event.target.value)}
            />
          </label>
          <label>
            活动日期起
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => filter('dateFrom', event.target.value)}
            />
          </label>
          <label>
            活动日期止
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) => filter('dateTo', event.target.value)}
            />
          </label>
          <label>
            排序
            <select value={filters.sort} onChange={(event) => filter('sort', event.target.value)}>
              <option value="created_desc">最新提交</option>
              <option value="created_asc">最早提交</option>
              <option value="date_desc">活动日期从近到远</option>
              <option value="date_asc">活动日期从远到近</option>
              <option value="participants_desc">参与人数从多到少</option>
              <option value="participants_asc">参与人数从少到多</option>
            </select>
          </label>
        </div>
        {error ? (
          <p role="alert" className="og-notice">
            {error}
            <button type="button" onClick={() => setRevision((value) => value + 1)}>
              重新加载
            </button>
          </p>
        ) : null}
        {!rows && !error ? <p role="status">正在整理活动台账…</p> : null}
        {rows?.items.length ? (
          <div className="og-ledger-list">
            {rows.items.map((item) => (
              <article className="og-entry-card" key={item.id}>
                <div>
                  <div className="og-actions">
                    <span className="og-badge">{item.classLabel}</span>
                    <small>{item.activityDate ?? displayShanghai(item.createdAt)}</small>
                    {item.locked ? <span className="og-badge">已锁定</span> : null}
                  </div>
                  <h3>{item.activityTypeLabel}</h3>
                  <p>{item.summary}</p>
                  <small>
                    {item.authorName} · {item.participantCount} 人次 · {item.photos.length} 张照片
                  </small>
                </div>
                <button type="button" disabled={busy} onClick={() => void open(item.id)}>
                  查看详情
                </button>
              </article>
            ))}
          </div>
        ) : rows ? (
          <div className="og-empty">
            <h3>还没有符合条件的活动</h3>
            <p>调整筛选条件，或从活动填报开始记录。</p>
          </div>
        ) : null}
        {rows ? (
          <nav className="og-pagination" aria-label="台账分页">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              上一页
            </button>
            <span>
              第 {page} / {Math.max(1, Math.ceil(rows.total / rows.pageSize))} 页 · 共 {rows.total}{' '}
              条
            </span>
            <button
              type="button"
              disabled={page * rows.pageSize >= rows.total}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </button>
          </nav>
        ) : null}
      </section>
    </section>
  );
}
