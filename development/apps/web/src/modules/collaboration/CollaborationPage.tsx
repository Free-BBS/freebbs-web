import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  DEPARTMENT_DIRECTORY,
  type CollaborationSpace,
  type CollaborationKind,
} from '@freebbs-development/contracts';
import { useAuth } from '../../core/auth/AuthProvider.js';
import '../../styles/collaboration.css';
import { SpaceDownloads } from './MaterialsControls.js';
import { BookingCalendar } from './BookingCalendar.js';

import {
  kinds,
  toolGroups,
  kindName,
  localDate,
  statusName,
  ToolIcon,
} from './collaborationTools.js';
import { SpaceEditor } from './SpaceEditor.js';
import { EntryEditor } from './EntryEditor.js';
import { CollaborationRecords } from './CollaborationRecords.js';

export function CollaborationPage() {
  const auth = useAuth();
  const api = auth.client;
  const { spaceId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<CollaborationSpace[]>([]);
  const [space, setSpace] = useState<CollaborationSpace>();
  const [canCreate, setCanCreate] = useState(false);
  const [reportDate, setReportDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState('overview');
  const [initialKind, setInitialKind] = useState<CollaborationKind>();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [confirmClose, setConfirmClose] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [filter, setFilter] = useState('all');
  const identityGeneration = useRef(0);
  const loadGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  async function reload(propagate = false) {
    const identity = identityGeneration.current;
    const load = ++loadGeneration.current;
    const isCurrent = () =>
      identity === identityGeneration.current && load === loadGeneration.current;
    setError('');
    setLoading(true);
    try {
      if (spaceId) {
        const result = await api.request<CollaborationSpace>(
          `/collaboration/${encodeURIComponent(spaceId)}`,
        );
        if (isCurrent()) {
          // A refresh may finish after a save; never replace a newer committed revision.
          setSpace((current) =>
            current?.id === result.id && current.revision > result.revision ? current : result,
          );
        }
      } else {
        const result = await api.request<{ items: CollaborationSpace[]; canCreate: boolean }>(
          '/collaboration',
        );
        if (isCurrent()) {
          setItems(result.items);
          setCanCreate(result.canCreate);
        }
      }
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : '加载失败');
      if (propagate) throw cause;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setCanCreate(false);
    setBusy(false);
    setError('');
    setCreating(false);
    setSpace(undefined);
    setTab('overview');
    setConfirmClose(false);
    setFeedback('');
    void reload();
    return () => {
      identityGeneration.current++;
    };
  }, [api, spaceId]);
  async function mutate(path: string, body: unknown, method = 'POST') {
    const identity = identityGeneration.current;
    const mutation = ++mutationGeneration.current;
    const isCurrent = () =>
      identity === identityGeneration.current && mutation === mutationGeneration.current;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const next = await api.request<CollaborationSpace>(path, {
        method,
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!isCurrent()) return false;
      if (spaceId)
        setSpace((current) =>
          current?.id === next.id && current.revision > next.revision ? current : next,
        );
      else navigate(`/collections/tools/${next.id}`);
      setFeedback('更改已保存');
      return true;
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : '保存失败');
      return false;
    } finally {
      // Same-space reads must not invalidate ownership of the mutation's busy state.
      if (isCurrent()) setBusy(false);
    }
  }
  const visible = items
    .filter(
      (item) =>
        (filter === 'all' || item.kind === filter) &&
        (status === 'all' || item.status === status) &&
        (!search.get('department') || item.departmentId === search.get('department')) &&
        (!search.get('team') || item.teamId === search.get('team')) &&
        (departmentFilter === 'all' || item.departmentId === departmentFilter) &&
        (teamFilter === 'all' || item.teamId === teamFilter) &&
        `${item.title} ${item.description ?? ''}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) ||
        a.title.localeCompare(b.title, 'zh-CN'),
    );
  const scopedItems = items.filter(
    (item) =>
      (!search.get('department') || item.departmentId === search.get('department')) &&
      (!search.get('team') || item.teamId === search.get('team')),
  );
  const tabs = [
    { id: 'overview', label: '概览' },
    { id: 'participate', label: '参与填写' },
    { id: 'records', label: '记录' },
    ...(space?.canManage ? [{ id: 'settings', label: '管理设置' }] : []),
  ];
  return (
    <main className="collaboration-page">
      <header className="collaboration-heading">
        <div>
          <Link to={spaceId ? '/collections/tools' : '/collections'}>
            {spaceId ? '返回协作工具' : '返回萬事屋'}
          </Link>
          <p className="collaboration-eyebrow">一起把事情做好</p>
          <h1>{space?.title ?? '协作工具'}</h1>
          <p>{space?.description || '时间、资料与共同的记录，都在这里相遇。'}</p>
        </div>
        {!spaceId && canCreate && (
          <button
            className="collaboration-primary"
            type="button"
            onClick={() => {
              setInitialKind(undefined);
              setCreating(!creating);
            }}
          >
            创建协作空间
          </button>
        )}
      </header>
      {error && (
        <div className="collaboration-alert" role="alert">
          {error}
          <button type="button" onClick={() => void reload()}>
            重新加载
          </button>
        </div>
      )}
      {loading && space && (
        <p role="status" className="collaboration-feedback">
          正在更新记录…
        </p>
      )}
      {feedback && (
        <p className="collaboration-feedback" role="status">
          {feedback}
        </p>
      )}
      {loading && !space && items.length === 0 ? (
        <p className="collaboration-empty" role="status">
          正在整理可见的协作空间…
        </p>
      ) : spaceId && space ? (
        <>
          <div className="collaboration-toolbar collaboration-space-meta">
            <span className="collaboration-tag">
              <ToolIcon kind={space.kind} />
              {kindName(space.kind)}
            </span>
            <span className={`collaboration-status collaboration-status-${space.status}`}>
              {statusName(space.status)}
            </span>
            <small>版本 {space.revision}</small>
          </div>
          <nav className="collaboration-tabs" role="tablist" aria-label="协作空间内容">
            {tabs.map((item) => (
              <button
                type="button"
                role="tab"
                id={`collaboration-tab-${item.id}`}
                aria-controls={`collaboration-panel-${item.id}`}
                aria-selected={tab === item.id}
                tabIndex={tab === item.id ? 0 : -1}
                key={item.id}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const current = tabs.findIndex((value) => value.id === tab);
                    const index =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
                            tabs.length;
                    setTab(tabs[index]!.id);
                    document.getElementById(`collaboration-tab-${tabs[index]!.id}`)?.focus();
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <section
            className="collaboration-tab-panel"
            role="tabpanel"
            id="collaboration-panel-overview"
            aria-labelledby="collaboration-tab-overview"
            hidden={tab !== 'overview'}
          >
            <div className="collaboration-overview">
              <div>
                <h2>如何参与</h2>
                <p>{kinds.find((item) => item.id === space.kind)?.text}</p>
                <p>
                  {space.status === 'draft'
                    ? '空间尚未开放，管理者确认设置后可开放收集。'
                    : space.status === 'closed'
                      ? '收集已结束，可在记录中查看已提交内容。'
                      : '在参与填写中提交内容，在记录中查看结果与处理进度。'}
                </p>
                <button
                  type="button"
                  onClick={() => setTab(space.status === 'published' ? 'participate' : 'records')}
                >
                  {space.status === 'published' ? '开始填写' : '查看记录'}
                </button>
              </div>
              <dl className="collaboration-stats">
                <div>
                  <dt>{space.canManage ? '可管理记录' : '当前可见记录'}</dt>
                  <dd>{space.entries.length}</dd>
                </div>
                {space.kind === 'booking' ? (
                  <div>
                    <dt>公开占用时段</dt>
                    <dd>{space.bookingOccupancy?.length ?? 0}</dd>
                  </div>
                ) : (
                  <div>
                    <dt>
                      {space.kind === 'shared_table' || space.kind === 'materials'
                        ? '填写字段'
                        : '可选时段'}
                    </dt>
                    <dd>
                      {space.kind === 'shared_table' || space.kind === 'materials'
                        ? space.columns.length
                        : space.slots.length}
                    </dd>
                  </div>
                )}
                {space.kind === 'review' && (
                  <div>
                    <dt>审核阶段</dt>
                    <dd>{space.stages.length}</dd>
                  </div>
                )}
              </dl>
            </div>
            <p className="collaboration-scope-note">记录统计仅包含当前身份可见的内容。</p>
            {space.slots.length > 0 && (
              <section className="collaboration-slot-grid" aria-label="时间与名额">
                {space.slots.map((slot) => (
                  <article key={slot.id}>
                    <strong>{slot.title}</strong>
                    <p>
                      {localDate(slot.startsAt)} — {localDate(slot.endsAt)}
                    </p>
                    <span>
                      {space.kind === 'availability'
                        ? `${space.aggregates?.[slot.id] ?? 0} 人可参与`
                        : `名额 ${slot.capacity}`}
                    </span>
                  </article>
                ))}
              </section>
            )}
            {space.kind === 'booking' && (
              <BookingCalendar key={space.id} occupancy={space.bookingOccupancy ?? []} />
            )}
          </section>
          <section
            className="collaboration-tab-panel"
            role="tabpanel"
            id="collaboration-panel-participate"
            aria-labelledby="collaboration-tab-participate"
            hidden={tab !== 'participate'}
          >
            {space.status === 'published' ? (
              <EntryEditor
                key={space.id}
                space={space}
                busy={busy}
                onSubmit={(value) =>
                  mutate(`/collaboration/${space.id}/entries`, {
                    ...value,
                    revision: space.revision,
                  })
                }
              />
            ) : (
              <p className="collaboration-empty">
                {space.status === 'closed'
                  ? '收集已结束，可在记录中查看已提交内容。'
                  : '空间尚未开放，暂时无法填写。'}
              </p>
            )}
          </section>
          <section
            className="collaboration-tab-panel"
            role="tabpanel"
            id="collaboration-panel-records"
            aria-labelledby="collaboration-tab-records"
            hidden={tab !== 'records'}
          >
            <CollaborationRecords
              key={space.id}
              space={space}
              busy={busy}
              mutate={mutate}
              reload={() => reload(true)}
            />
          </section>
          {space.canManage && (
            <section
              className="collaboration-tab-panel"
              role="tabpanel"
              id="collaboration-panel-settings"
              aria-labelledby="collaboration-tab-settings"
              hidden={tab !== 'settings'}
            >
              <div className="collaboration-management-actions">
                <div>
                  <h2>收集状态</h2>
                  <p>
                    {space.status === 'published'
                      ? '开放期间成员可以填写，结束后保留记录。'
                      : '确认设置后开放，成员即可提交记录。'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    space.status === 'published'
                      ? setConfirmClose(true)
                      : void mutate(
                          `/collaboration/${space.id}`,
                          { revision: space.revision, status: 'published' },
                          'PATCH',
                        )
                  }
                >
                  {space.status === 'published' ? '结束收集' : '开放收集'}
                </button>
                {space.kind === 'practice' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(`/collaboration/${space.id}/assign`, { revision: space.revision })
                    }
                  >
                    按志愿生成安排
                  </button>
                )}
              </div>
              {confirmClose && space.status === 'published' && (
                <section
                  className="collaboration-confirm"
                  role="alertdialog"
                  aria-labelledby="close-space-title"
                >
                  <h2 id="close-space-title">结束本次收集？</h2>
                  <p>成员将无法继续提交，已有记录会保留。可再次开放收集。</p>
                  <button type="button" disabled={busy} onClick={() => setConfirmClose(false)}>
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        `/collaboration/${space.id}`,
                        { revision: space.revision, status: 'closed' },
                        'PATCH',
                      ).then((success) => {
                        if (success) setConfirmClose(false);
                      })
                    }
                  >
                    确认结束收集
                  </button>
                </section>
              )}
              <button type="button" onClick={() => setCreating(!creating)} aria-expanded={creating}>
                编辑设置
              </button>
              <div hidden={!creating}>
                <SpaceEditor
                  key={space.id}
                  existing={space}
                  busy={busy}
                  onCancel={() => setCreating(false)}
                  onSave={async (value) => {
                    if (
                      await mutate(
                        `/collaboration/${space.id}`,
                        { ...value, revision: space.revision },
                        'PATCH',
                      )
                    )
                      setCreating(false);
                  }}
                />
              </div>
              <SpaceDownloads space={space} />
              {space.kind === 'materials' &&
                space.columns.some((column) => column.id === 'report_date') && (
                  <section className="collaboration-editor">
                    <h2>每日报告检查</h2>
                    <label>
                      报告日期
                      <input
                        type="date"
                        value={reportDate}
                        onChange={(event) => setReportDate(event.target.value)}
                      />
                    </label>
                    <p>
                      已报告{' '}
                      {
                        new Set(
                          space.entries
                            .filter((entry) => entry.values.report_date === reportDate)
                            .map((entry) => entry.uid),
                        ).size
                      }{' '}
                      人
                    </p>
                    <p>
                      未报告：
                      {(space.expectedReporterUids ?? [])
                        .filter(
                          (uid) =>
                            !space.entries.some(
                              (entry) =>
                                entry.uid === uid && entry.values.report_date === reportDate,
                            ),
                        )
                        .join('、') ||
                        ((space.expectedReporterUids ?? []).length
                          ? '全员已报告'
                          : '请在设置中填写应报告用户编号')}
                    </p>
                  </section>
                )}
              <details className="collaboration-history">
                <summary>更改记录</summary>
                {space.history
                  .slice()
                  .reverse()
                  .slice(0, 30)
                  .map((row, index) => (
                    <p key={index}>
                      {localDate(row.at)} · {row.uid} · {row.action}
                    </p>
                  ))}
              </details>
            </section>
          )}
        </>
      ) : !spaceId ? (
        <>
          {creating && canCreate && (
            <SpaceEditor
              key={initialKind ?? 'choose'}
              initialKind={initialKind}
              busy={busy}
              onCancel={() => setCreating(false)}
              onSave={async (value) => {
                await mutate('/collaboration', value);
              }}
            />
          )}
          <div className="collaboration-discovery-groups">
            {toolGroups.map((group) => (
              <section className="collaboration-tool-group" key={group.title}>
                <header>
                  <h2>{group.title}</h2>
                  <p>{group.text}</p>
                </header>
                <div>
                  {kinds
                    .filter((item) => group.kinds.includes(item.id))
                    .map((item) => (
                      <article key={item.id}>
                        <ToolIcon kind={item.id} />
                        <div>
                          <h3>{item.title}</h3>
                          <p>{item.text}</p>
                        </div>
                        {canCreate && (
                          <button
                            type="button"
                            aria-label={`创建${item.title}`}
                            onClick={() => {
                              setInitialKind(item.id);
                              setCreating(true);
                              window.scrollTo?.({ top: 0, behavior: 'smooth' });
                            }}
                          >
                            创建
                          </button>
                        )}
                      </article>
                    ))}
                </div>
              </section>
            ))}
          </div>
          <section className="collaboration-space-list" aria-label="我的可见协作空间">
            <header>
              <h2>协作空间</h2>
              <span>{visible.length} 个可见空间</span>
            </header>
            <div className="collaboration-list-filters">
              <label>
                搜索协作空间
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="名称或说明"
                />
              </label>
              <label>
                空间状态
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="all">全部状态</option>
                  <option value="published">开放中</option>
                  <option value="draft">草稿</option>
                  <option value="closed">已结束</option>
                </select>
              </label>
              <label>
                所属部门筛选
                <select
                  value={departmentFilter}
                  onChange={(event) => setDepartmentFilter(event.target.value)}
                >
                  <option value="all">全部部门</option>
                  {Array.from(
                    new Set(
                      scopedItems
                        .map((item) => item.departmentId)
                        .filter((id): id is string => Boolean(id)),
                    ),
                  ).map((id) => (
                    <option key={id} value={id}>
                      {DEPARTMENT_DIRECTORY.find((item) => item.id === id)?.name ?? id}
                    </option>
                  ))}
                </select>
              </label>
              {scopedItems.some((item) => item.teamId) && (
                <label>
                  支队筛选
                  <select
                    value={teamFilter}
                    onChange={(event) => setTeamFilter(event.target.value)}
                  >
                    <option value="all">全部支队</option>
                    {Array.from(
                      new Set(
                        scopedItems
                          .map((item) => item.teamId)
                          .filter((id): id is string => Boolean(id)),
                      ),
                    ).map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <nav className="collaboration-filters" aria-label="工具类型">
              <button
                type="button"
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                全部
              </button>
              {kinds.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.title}
                </button>
              ))}
            </nav>
            <div className="collaboration-card-grid">
              {visible.map((item) => (
                <Link
                  key={item.id}
                  to={`/collections/tools/${item.id}`}
                  className="collaboration-card"
                >
                  <div className="collaboration-card-meta">
                    <span>{kindName(item.kind)}</span>
                    <span className={`collaboration-status collaboration-status-${item.status}`}>
                      {statusName(item.status)}
                    </span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.description || '查看详细内容与参与入口。'}</p>
                  <footer>
                    <time>{localDate(item.updatedAt)}</time>
                    <b>打开空间</b>
                  </footer>
                </Link>
              ))}
            </div>
            {visible.length === 0 && !error && (
              <p className="collaboration-empty">
                {items.length
                  ? '没有匹配的可见空间，请调整搜索或筛选。'
                  : canCreate
                    ? '还没有可见空间，选择适合的工具创建草稿。'
                    : '当前没有可见空间，开放后的协作空间会出现在这里。'}
              </p>
            )}
          </section>
        </>
      ) : (
        !error && <p className="collaboration-empty">无法打开当前协作空间。</p>
      )}
    </main>
  );
}
