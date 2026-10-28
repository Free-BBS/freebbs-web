import { useEffect, useRef, useState } from 'react';
import type {
  OrganizationGroupEditContext,
  OrganizationGroupEntry,
  OrganizationGroupEntryList,
  OrganizationGroupFile,
  OrganizationGroupAnswer,
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
  const exportVersion = useRef(0);
  useEffect(() => {
    exportVersion.current += 1;
    return () => {
      exportVersion.current += 1;
    };
  }, [api, query, workspace.revision, workspace.canExport]);
  async function exportLedger() {
    const version = exportVersion.current;
    const isCurrent = () => version === exportVersion.current;
    setError('');
    try {
      await downloadBlob(
        api,
        `/organization-group/export.xlsx?${query}`,
        `组织组活动台账-${year.label}.xlsx`,
        isCurrent,
      );
    } catch (cause) {
      if (isCurrent()) setError(errorMessage(cause));
    }
  }
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
  }, [api, query, refresh, revision, workspace.revision, workspace.canViewAll]);
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
  const current = workspace.versions.find((item) => item.id === year.currentVersionId);
  const column = (
    key:
      | 'classId'
      | 'participantCount'
      | 'activityDate'
      | 'activityTypeIds'
      | 'summary'
      | 'photos'
      | 'difficulties'
      | 'participantNames',
    fallback: string,
  ) => current?.corePresentation?.[key]?.label ?? fallback;
  const extraColumns = Array.from(
    new Map(
      workspace.versions
        .filter((item) => item.yearId === year.id)
        .flatMap((item) => item.fields)
        .map((field) => [field.id, field]),
    ).values(),
  );
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
            <h2>{(detail.activityTypeLabels ?? [detail.activityTypeLabel]).join(' · ')}</h2>
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
            <dt>{original?.corePresentation?.activityDate?.label ?? '活动时间'}</dt>
            <dd>{detail.activityDate ?? '未填写'}</dd>
          </div>
          <div>
            <dt>{original?.corePresentation?.summary?.label ?? '活动内容'}</dt>
            <dd>{detail.summary}</dd>
          </div>
          {detail.difficulties !== undefined ? (
            <div>
              <dt>{original?.corePresentation?.difficulties?.label ?? '备注'}</dt>
              <dd>{detail.difficulties || '未填写'}</dd>
            </div>
          ) : null}
          {detail.participantNames ? (
            <div>
              <dt>{original?.corePresentation?.participantNames?.label ?? '具体参与人员'}</dt>
              <dd>{detail.participantNames}</dd>
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
      <section className="og-panel og-ledger-panel">
        <div className="og-panel-heading">
          <div>
            <h2>{workspace.canViewAll ? '全局活动台账' : '我的活动台账'}</h2>
            <p>
              {workspace.canViewAll ? '全系班级活动记录' : '仅显示本人提交的活动'} · 共{' '}
              {rows?.total ?? '—'} 条
            </p>
          </div>
          {workspace.canExport ? (
            <button type="button" onClick={() => void exportLedger()}>
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
              placeholder="活动内容、参与人员或备注"
              onChange={(event) => filter('query', event.target.value)}
            />
          </label>
          {workspace.canViewAll ? (
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
          ) : null}
          <label>
            筛选标签
            <select
              value={filters.activityTypeId}
              onChange={(event) => filter('activityTypeId', event.target.value)}
            >
              <option value="">全部标签</option>
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
        </div>
        <details className="og-more-filters">
          <summary>
            更多筛选
            {filters.authorUid ||
            filters.dateFrom ||
            filters.dateTo ||
            filters.sort !== 'created_desc'
              ? ' · 已应用'
              : ''}
          </summary>
          <div className="og-filters">
            {workspace.canViewAll ? (
              <label>
                填写人 UID
                <input
                  value={filters.authorUid}
                  onChange={(event) => filter('authorUid', event.target.value)}
                />
              </label>
            ) : null}
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
        </details>
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
          <div
            className="og-table-scroll"
            role="region"
            aria-label={workspace.canViewAll ? '全局活动台账表格' : '本人活动台账表格'}
            tabIndex={0}
          >
            <table className="og-ledger-table">
              <caption className="og-sr-only">
                {workspace.canViewAll ? '全系活动记录' : '本人提交的活动记录'}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="og-col-class">
                    {column('classId', '班级')}
                  </th>
                  <th scope="col" className="og-col-number">
                    {column('participantCount', '参与人数')}
                  </th>
                  <th scope="col" className="og-col-date">
                    {column('activityDate', '活动时间')}
                  </th>
                  <th scope="col" className="og-col-tags">
                    {column('activityTypeIds', '活动标签')}
                  </th>
                  <th scope="col" className="og-col-content">
                    {column('summary', '活动内容')}
                  </th>
                  <th scope="col" className="og-col-photo">
                    {column('photos', '照片')}
                  </th>
                  <th scope="col" className="og-col-content">
                    {column('difficulties', '备注')}
                  </th>
                  <th scope="col" className="og-col-names">
                    {column('participantNames', '具体参与人员')}
                  </th>
                  {extraColumns.map((field) => (
                    <th scope="col" className="og-col-content" key={field.id}>
                      {field.label}
                    </th>
                  ))}
                  <th scope="col" className="og-col-date">
                    提交记录
                  </th>
                  <th scope="col" className="og-col-action">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row" className="og-col-class">
                      {item.classLabel}
                      {item.locked ? <span className="og-row-status">已锁定</span> : null}
                    </th>
                    <td className="og-col-number">{item.participantCount}</td>
                    <td>{item.activityDate ?? '未填写'}</td>
                    <td>
                      <div className="og-cell-tags">
                        {(item.activityTypeLabels ?? [item.activityTypeLabel]).map((label) => (
                          <span className="og-badge" key={label}>
                            {label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="og-cell-text">{item.summary}</td>
                    <td>
                      {item.photos[0] ? (
                        <button
                          type="button"
                          className="og-photo-button"
                          aria-label={`查看${item.classLabel}活动的${item.photos.length}张照片`}
                          onClick={() => void open(item.id)}
                        >
                          <LedgerPhoto api={api} file={item.photos[0]} />
                          <span>{item.photos.length} 张</span>
                        </button>
                      ) : (
                        <span className="og-muted">—</span>
                      )}
                    </td>
                    <td className="og-cell-text">{item.difficulties || '—'}</td>
                    <td className="og-cell-text">{item.participantNames || '—'}</td>
                    {extraColumns.map((field) => (
                      <td className="og-cell-text" key={field.id}>
                        {answerText(item.extraAnswers[field.id], field.kind === 'image')}
                      </td>
                    ))}
                    <td>
                      <span>{item.authorName}</span>
                      <small className="og-submitted-time">{displayShanghai(item.createdAt)}</small>
                    </td>
                    <td>
                      <button type="button" disabled={busy} onClick={() => void open(item.id)}>
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
function answerText(value: OrganizationGroupAnswer | undefined, image: boolean) {
  if (image) return `${Array.isArray(value) ? value.length : 0} 张`;
  return Array.isArray(value) ? value.join('、') : String(value ?? '—');
}
function LedgerPhoto({ api, file }: { api: GroupClient; file: OrganizationGroupFile }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    setUrl(null);
    if (api.download && /^image\/(png|jpeg|webp)$/.test(file.mime)) {
      void api.download(`/organization-group/files/${encodeURIComponent(file.id)}?preview=1`).then(
        (blob) => {
          if (!live) return;
          objectUrl = URL.createObjectURL(new Blob([blob], { type: file.mime }));
          setUrl(objectUrl);
        },
        () => {},
      );
    }
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, file.id, file.mime]);
  return url ? (
    <img src={url} alt="活动照片缩略图" loading="lazy" />
  ) : (
    <span className="og-photo-placeholder" aria-hidden="true">
      ▧
    </span>
  );
}
