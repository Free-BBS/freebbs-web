import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  DEVELOPMENT_IDENTITY_SECTIONS,
  DEPARTMENT_DIRECTORY,
  departmentsForRoles,
  type CollaborationSpace,
  type CollaborationKind,
  type CollaborationColumn,
  type CollaborationSlot,
  type CollaborationEntry,
} from '@freebbs-development/contracts';
import { useAuth } from '../../core/auth/AuthProvider.js';
import '../../styles/collaboration.css';
import { EntryMaterials, SpaceDownloads } from './MaterialsControls.js';
import { BookingCalendar } from './BookingCalendar.js';

const kinds: Array<{ id: CollaborationKind; title: string; text: string; glyph: string }> = [
  { id: 'availability', title: '相约时间', text: '收集空闲时间，找到共同的一小时。', glyph: '◷' },
  { id: 'booking', title: '预约日历', text: '推送、视频与空间预约，自动检查冲突。', glyph: '▦' },
  {
    id: 'shared_table',
    title: '共享统计表',
    text: '自定义字段，让部门一起维护同一份记录。',
    glyph: '▤',
  },
  { id: 'practice', title: '志愿双选', text: '收集排序志愿，按名额生成初步安排。', glyph: '⇄' },
  { id: 'attendance', title: '活动打卡', text: '提交训练与参与记录，由组织确认。', glyph: '✓' },
  { id: 'review', title: '材料审核', text: '分步收集、审核，留下清晰的处理记录。', glyph: '◇' },
  { id: 'materials', title: '材料收集', text: '按统一要求提交文字、资料与每日简报。', glyph: '▱' },
];
const kindName = (id: CollaborationKind) => kinds.find((kind) => kind.id === id)!.title;
const roleLabel = (key: string) =>
  DEVELOPMENT_IDENTITY_SECTIONS.flatMap((section) => section.groups)
    .flatMap((group) => group.options)
    .find((option) => option.roleKey === key)?.label ?? '审核人员';
const localDate = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
function iso(value: string) {
  return value ? new Date(value).toISOString() : '';
}

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
  const [filter, setFilter] = useState('all');
  const requestGeneration = useRef(0);
  async function reload() {
    const generation = ++requestGeneration.current;
    setError('');
    setLoading(true);
    try {
      if (spaceId) {
        const result = await api.request<CollaborationSpace>(
          `/collaboration/${encodeURIComponent(spaceId)}`,
        );
        if (generation === requestGeneration.current) setSpace(result);
      } else {
        const result = await api.request<{ items: CollaborationSpace[]; canCreate: boolean }>(
          '/collaboration',
        );
        if (generation === requestGeneration.current) {
          setItems(result.items);
          setCanCreate(result.canCreate);
        }
      }
    } catch (cause) {
      if (generation === requestGeneration.current)
        setError(cause instanceof Error ? cause.message : '加载失败');
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setCanCreate(false);
    setBusy(false);
    setError('');
    setCreating(false);
    setSpace(undefined);
    void reload();
    return () => {
      requestGeneration.current++;
    };
  }, [api, spaceId]);
  async function mutate(path: string, body: unknown, method = 'POST') {
    const generation = requestGeneration.current;
    setBusy(true);
    setError('');
    try {
      const next = await api.request<CollaborationSpace>(path, {
        method,
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
      if (generation !== requestGeneration.current) return false;
      if (spaceId) setSpace(next);
      else navigate(`/collections/tools/${next.id}`);
      return true;
    } catch (cause) {
      if (generation === requestGeneration.current)
        setError(cause instanceof Error ? cause.message : '保存失败');
      return false;
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }
  const visible = items.filter(
    (item) =>
      (filter === 'all' || item.kind === filter) &&
      (!search.get('department') || item.departmentId === search.get('department')) &&
      (!search.get('team') || item.teamId === search.get('team')),
  );
  return (
    <main className="collaboration-page">
      <header className="collaboration-heading">
        <div>
          <Link to={spaceId ? '/collections/tools' : '/collections'}>
            ← {spaceId ? '协作工具' : '萬事屋'}
          </Link>
          <p className="collaboration-eyebrow">一起把事情做好</p>
          <h1>{space?.title ?? '协作工具'}</h1>
          <p>{space?.description ?? '时间、资料与共同的记录，都在这里相遇。'}</p>
        </div>
        {!spaceId && canCreate && (
          <button
            className="collaboration-primary"
            type="button"
            onClick={() => setCreating(!creating)}
          >
            ＋ 创建协作空间
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
      {loading ? (
        <p role="status">正在整理…</p>
      ) : spaceId && space ? (
        <>
          <div className="collaboration-toolbar">
            <span className="collaboration-tag">{kindName(space.kind)}</span>
            <span>
              {space.status === 'draft' ? '草稿' : space.status === 'closed' ? '已结束' : '开放中'}
            </span>
            <span>版本 {space.revision}</span>
            {space.canManage && (
              <>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    void mutate(
                      `/collaboration/${space.id}`,
                      {
                        revision: space.revision,
                        status: space.status === 'published' ? 'closed' : 'published',
                      },
                      'PATCH',
                    )
                  }
                >
                  {space.status === 'published' ? '结束收集' : '开放收集'}
                </button>
                <button disabled={busy} type="button" onClick={() => setCreating(!creating)}>
                  编辑设置
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
              </>
            )}
          </div>
          {creating && (
            <SpaceEditor
              existing={space}
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
              busy={busy}
            />
          )}
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
          {space.status === 'published' && (
            <EntryEditor
              key={`${space.id}:${space.revision}`}
              space={space}
              busy={busy}
              onSubmit={(value) =>
                mutate(`/collaboration/${space.id}/entries`, { ...value, revision: space.revision })
              }
            />
          )}
          {space.canManage && <SpaceDownloads space={space} />}
          {space.canManage &&
            space.kind === 'materials' &&
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
                          (entry) => entry.uid === uid && entry.values.report_date === reportDate,
                        ),
                    )
                    .join('、') ||
                    ((space.expectedReporterUids ?? []).length
                      ? '全员已报告'
                      : '请在设置中填写应报告用户编号')}
                </p>
              </section>
            )}
          <section className="collaboration-records">
            <header>
              <h2>{space.canManage ? '全部记录' : '我的记录'}</h2>
              <span>{space.entries.length} 条</span>
            </header>
            {space.entries.length === 0 ? (
              <p className="collaboration-empty">还没有记录，新的故事从第一次提交开始。</p>
            ) : space.kind === 'shared_table' ? (
              <div className="collaboration-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>提交者</th>
                      {space.columns.map((column) => (
                        <th key={column.id}>{column.label}</th>
                      ))}
                      <th>更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {space.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.displayName}</td>
                        {space.columns.map((column) => (
                          <td key={column.id}>{String(entry.values[column.id] ?? '—')}</td>
                        ))}
                        <td>
                          {localDate(entry.updatedAt)}{' '}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                `/collaboration/${space.id}/entries/${entry.id}`,
                                { revision: space.revision },
                                'DELETE',
                              )
                            }
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="collaboration-entry-grid">
                {space.entries.map((entry) => (
                  <article key={entry.id}>
                    <header>
                      <strong>{entry.displayName}</strong>
                      <time>{localDate(entry.updatedAt)}</time>
                    </header>
                    {entry.resource && (
                      <p>
                        {entry.resource} · {localDate(entry.startsAt)} — {localDate(entry.endsAt)}
                      </p>
                    )}
                    {entry.choices.length > 0 && (
                      <p>
                        {entry.choices
                          .map((id) => space.slots.find((slot) => slot.id === id)?.title ?? id)
                          .join(space.kind === 'practice' ? ' → ' : '、')}
                      </p>
                    )}
                    {entry.text && <p className="collaboration-entry-text">{entry.text}</p>}
                    {space.kind === 'materials' && (
                      <dl>
                        {space.columns.map((column) => (
                          <div key={column.id}>
                            <dt>{column.label}</dt>
                            <dd>{String(entry.values[column.id] ?? '—')}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {space.kind === 'practice' && (
                      <p>
                        安排：
                        {space.slots.find((slot) => slot.id === entry.assignedSlot)?.title ??
                          '待安排'}{' '}
                        ·{' '}
                        {entry.assignmentStatus === 'accepted'
                          ? '本人已接受'
                          : entry.assignmentStatus === 'declined'
                            ? '本人已拒绝'
                            : '待本人确认'}
                      </p>
                    )}
                    {space.kind === 'practice' && space.canManage && (
                      <select
                        aria-label={`调整${entry.displayName}支队`}
                        value={entry.assignedSlot ?? ''}
                        disabled={busy}
                        onChange={(event) =>
                          void mutate(`/collaboration/${space.id}/entries/${entry.id}/assignment`, {
                            revision: space.revision,
                            slotId: event.target.value || null,
                          })
                        }
                      >
                        <option value="">待安排</option>
                        {space.slots.map((slot) => (
                          <option key={slot.id} value={slot.id}>
                            {slot.title}
                          </option>
                        ))}
                      </select>
                    )}
                    {space.kind === 'practice' &&
                      entry.uid === auth.user?.uid &&
                      entry.assignedSlot &&
                      entry.assignmentStatus !== 'accepted' && (
                        <div>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                `/collaboration/${space.id}/entries/${entry.id}/assignment`,
                                { revision: space.revision, decision: 'accepted' },
                              )
                            }
                          >
                            接受安排
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                `/collaboration/${space.id}/entries/${entry.id}/assignment`,
                                { revision: space.revision, decision: 'declined' },
                              )
                            }
                          >
                            拒绝安排
                          </button>
                        </div>
                      )}
                    {['review', 'attendance'].includes(space.kind) && (
                      <p className="collaboration-tag">
                        {entry.reviewStatus === 'approved'
                          ? '已确认'
                          : entry.reviewStatus === 'rejected'
                            ? '需补充'
                            : `待处理${space.stages[entry.stage] ? ` · ${space.stages[entry.stage]?.title}` : ''}`}
                      </p>
                    )}
                    <EntryMaterials space={space} entry={entry} onUpdate={reload} />
                    {entry.decisions.map((decision, index) => (
                      <p key={index}>
                        {decision.decision === 'approved' ? '通过' : '退回'} ·{' '}
                        {decision.note || '无补充说明'} · {localDate(decision.at)}
                      </p>
                    ))}
                    {entry.canReview &&
                      entry.reviewStatus === 'pending' &&
                      ['review', 'attendance'].includes(space.kind) && (
                        <ReviewControls
                          busy={busy}
                          onReview={(decision, note) =>
                            mutate(`/collaboration/${space.id}/entries/${entry.id}/review`, {
                              revision: space.revision,
                              decision,
                              note,
                            })
                          }
                        />
                      )}
                  </article>
                ))}
              </div>
            )}
          </section>
          {space.canManage && (
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
          )}
        </>
      ) : !spaceId ? (
        <>
          {creating && (
            <SpaceEditor
              busy={busy}
              onCancel={() => setCreating(false)}
              onSave={(value) => mutate('/collaboration', value).then(() => undefined)}
            />
          )}
          <nav className="collaboration-filters" aria-label="工具类型">
            <button aria-pressed={filter === 'all'} type="button" onClick={() => setFilter('all')}>
              全部
            </button>
            {kinds.map((kind) => (
              <button
                key={kind.id}
                aria-pressed={filter === kind.id}
                type="button"
                onClick={() => setFilter(kind.id)}
              >
                {kind.title}
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
                <span>
                  {kindName(item.kind)} ·{' '}
                  {item.status === 'draft'
                    ? '草稿'
                    : item.status === 'closed'
                      ? '已结束'
                      : '开放中'}
                </span>
                <h2>{item.title}</h2>
                <p>{item.description || '点击查看详细内容与参与入口。'}</p>
                <footer>
                  {localDate(item.updatedAt)} <b>打开 ↗</b>
                </footer>
              </Link>
            ))}
          </div>
          {visible.length === 0 && (
            <p className="collaboration-empty">
              暂时没有这类协作空间。
              {canCreate ? '可以从上方创建，选择适合的工具。' : '开放后的协作空间会出现在这里。'}
            </p>
          )}
        </>
      ) : null}
    </main>
  );
}
function ReviewControls({
  busy,
  onReview,
}: {
  busy: boolean;
  onReview: (decision: 'approved' | 'rejected', note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="collaboration-review">
      <input
        aria-label="处理说明"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="补充说明（可选）"
      />
      <button disabled={busy} type="button" onClick={() => void onReview('approved', note)}>
        确认通过
      </button>
      <button disabled={busy} type="button" onClick={() => void onReview('rejected', note)}>
        退回补充
      </button>
    </div>
  );
}
function SpaceEditor({
  existing,
  busy,
  onSave,
  onCancel,
}: {
  existing?: CollaborationSpace;
  busy: boolean;
  onSave: (value: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const auth = useAuth();
  const [search] = useSearchParams();
  const departments = auth.user?.roles.includes('platform.super_admin')
    ? DEPARTMENT_DIRECTORY
    : departmentsForRoles(auth.user?.roles ?? []);
  const [kind, setKind] = useState<CollaborationKind>(
    existing?.kind ?? (search.get('team') ? 'attendance' : 'availability'),
  );
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [departmentId, setDepartment] = useState(
    existing?.departmentId ??
      departments.find((item) => item.id === search.get('department'))?.id ??
      departments[0]?.id ??
      '',
  );
  const [audience, setAudience] = useState(existing?.audience ?? 'all');
  const [columns, setColumns] = useState<CollaborationColumn[]>(existing?.columns ?? []);
  const [slots, setSlots] = useState<CollaborationSlot[]>(existing?.slots ?? []);
  const [stages, setStages] = useState(existing?.stages ?? []);
  const [localError, setLocalError] = useState('');
  const [expectedReporters, setExpectedReporters] = useState(
    existing?.expectedReporterUids?.join(',') ?? '',
  );
  const locked = Boolean(existing?.entries.length);
  const dept = DEPARTMENT_DIRECTORY.find((item) => item.id === departmentId);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLocalError('');
    try {
      await onSave({
        kind,
        title,
        description,
        departmentId: search.get('team') ? null : departmentId || null,
        teamId: existing?.teamId ?? search.get('team') ?? null,
        audience: kind === 'shared_table' ? 'department' : audience,
        status: existing?.status ?? 'draft',
        expectedReporterUids: expectedReporters
          .split(/[,，\n]/)
          .map((uid) => uid.trim())
          .filter(Boolean),
        ...(!existing || JSON.stringify(columns) !== JSON.stringify(existing.columns)
          ? { columns }
          : {}),
        ...(!existing || JSON.stringify(slots) !== JSON.stringify(existing.slots) ? { slots } : {}),
        ...(!existing || JSON.stringify(stages) !== JSON.stringify(existing.stages)
          ? { stages }
          : {}),
      });
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : '请检查输入');
    }
  }
  return (
    <form className="collaboration-editor" onSubmit={(e) => void save(e)}>
      <header>
        <h2>{existing ? '编辑协作空间' : '选择你的工具'}</h2>
        <button type="button" onClick={onCancel}>
          收起
        </button>
      </header>
      <div className="collaboration-kind-picker">
        {kinds.map((item) => (
          <button
            type="button"
            disabled={locked}
            key={item.id}
            aria-pressed={kind === item.id}
            onClick={() => setKind(item.id)}
          >
            <span aria-hidden="true">{item.glyph}</span>
            <strong>{item.title}</strong>
            <small>{item.text}</small>
          </button>
        ))}
      </div>
      {!existing && (
        <div className="collaboration-toolbar">
          <button
            type="button"
            onClick={() => {
              setKind('materials');
              setTitle('实践每日安全报告');
              setDescription('每天按报告日期提交，说明所在地、人员安全与紧急联络情况。');
              setColumns([
                { id: 'report_date', label: '报告日期', kind: 'date', required: true },
                { id: 'team', label: '支队', kind: 'text', required: true },
                {
                  id: 'safety',
                  label: '安全状态',
                  kind: 'choice',
                  options: ['全员安全', '需要协调帮助'],
                  required: true,
                },
              ]);
            }}
          >
            使用每日安全报告模板
          </button>
          <button
            type="button"
            onClick={() => {
              setKind('practice');
              setTitle('TMS 实践支队双选');
              setDescription('按点击顺序填写志愿；组织安排后请本人确认。');
            }}
          >
            使用 TMS 双选模板
          </button>
        </div>
      )}
      <div className="collaboration-form-grid">
        <label>
          名称
          <input
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：秋季例会时间收集"
          />
        </label>
        <label>
          所属部门
          <select value={departmentId} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">个人发起</option>
            {departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.organizationName} · {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          谁可以参与
          <select
            value={kind === 'shared_table' ? 'department' : audience}
            disabled={kind === 'shared_table'}
            onChange={(e) => setAudience(e.target.value as 'all' | 'department')}
          >
            <option value="all">发展端同学</option>
            <option value="department">仅本部门</option>
          </select>
        </label>
        <label className="wide">
          说明
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
          />
        </label>
      </div>
      {['availability', 'practice'].includes(kind) && (
        <fieldset disabled={locked}>
          <legend>{kind === 'practice' ? '支队与可选时段' : '候选时间段'}</legend>
          {slots.map((slot, index) => (
            <div className="collaboration-slot-editor" key={slot.id}>
              <input
                aria-label={`选项${index + 1}名称`}
                required
                placeholder={kind === 'practice' ? '支队名称' : '时间段名称'}
                value={slot.title}
                onChange={(e) =>
                  setSlots(
                    slots.map((s) => (s.id === slot.id ? { ...s, title: e.target.value } : s)),
                  )
                }
              />
              <input
                aria-label={`选项${index + 1}开始`}
                required
                type="datetime-local"
                defaultValue={
                  slot.startsAt
                    ? new Date(
                        Date.parse(slot.startsAt) -
                          new Date(slot.startsAt).getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ''
                }
                onChange={(e) =>
                  setSlots(
                    slots.map((s) =>
                      s.id === slot.id ? { ...s, startsAt: iso(e.target.value) } : s,
                    ),
                  )
                }
              />
              <input
                aria-label={`选项${index + 1}结束`}
                required
                type="datetime-local"
                defaultValue={
                  slot.endsAt
                    ? new Date(
                        Date.parse(slot.endsAt) - new Date(slot.endsAt).getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ''
                }
                onChange={(e) =>
                  setSlots(
                    slots.map((s) =>
                      s.id === slot.id ? { ...s, endsAt: iso(e.target.value) } : s,
                    ),
                  )
                }
              />
              <input
                aria-label={`选项${index + 1}名额`}
                type="number"
                min={1}
                max={10000}
                value={slot.capacity}
                onChange={(e) =>
                  setSlots(
                    slots.map((s) =>
                      s.id === slot.id ? { ...s, capacity: Number(e.target.value) } : s,
                    ),
                  )
                }
              />
              <button type="button" onClick={() => setSlots(slots.filter((s) => s.id !== slot.id))}>
                移除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setSlots([
                ...slots,
                { id: crypto.randomUUID(), title: '', startsAt: '', endsAt: '', capacity: 20 },
              ])
            }
          >
            ＋ 添加选项
          </button>
        </fieldset>
      )}
      {kind === 'materials' && (
        <label>
          应报告用户编号（逗号分隔）
          <textarea
            value={expectedReporters}
            onChange={(event) => setExpectedReporters(event.target.value)}
          />
        </label>
      )}
      {['shared_table', 'materials'].includes(kind) && (
        <fieldset disabled={locked}>
          <legend>表格字段</legend>
          {columns.map((column) => (
            <div className="collaboration-column-editor" key={column.id}>
              <input
                required
                aria-label="字段名称"
                placeholder="字段名称"
                value={column.label}
                onChange={(e) =>
                  setColumns(
                    columns.map((c) => (c.id === column.id ? { ...c, label: e.target.value } : c)),
                  )
                }
              />
              <select
                value={column.kind}
                onChange={(e) =>
                  setColumns(
                    columns.map((c) =>
                      c.id === column.id
                        ? { ...c, kind: e.target.value as CollaborationColumn['kind'] }
                        : c,
                    ),
                  )
                }
              >
                <option value="text">文字</option>
                <option value="number">数字</option>
                <option value="date">日期</option>
                <option value="choice">选择</option>
              </select>
              <input
                aria-label="允许编辑的角色"
                placeholder="可编辑角色编号，逗号分隔；留空为全员"
                value={column.editRoleKeys?.join(',') ?? ''}
                onChange={(e) =>
                  setColumns(
                    columns.map((c) =>
                      c.id === column.id
                        ? {
                            ...c,
                            editRoleKeys: e.target.value
                              .split(',')
                              .map((v) => v.trim())
                              .filter(Boolean),
                          }
                        : c,
                    ),
                  )
                }
              />
              {column.kind === 'choice' && (
                <input
                  aria-label="字段选项"
                  placeholder="选项用逗号分隔"
                  value={column.options?.join(',') ?? ''}
                  onChange={(e) =>
                    setColumns(
                      columns.map((c) =>
                        c.id === column.id
                          ? {
                              ...c,
                              options: e.target.value
                                .split(/[,，]/)
                                .map((v) => v.trim())
                                .filter(Boolean),
                            }
                          : c,
                      ),
                    )
                  }
                />
              )}
              <label>
                <input
                  type="checkbox"
                  checked={column.required}
                  onChange={(e) =>
                    setColumns(
                      columns.map((c) =>
                        c.id === column.id ? { ...c, required: e.target.checked } : c,
                      ),
                    )
                  }
                />
                必填
              </label>
              <button
                type="button"
                onClick={() => setColumns(columns.filter((c) => c.id !== column.id))}
              >
                移除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setColumns([
                ...columns,
                { id: crypto.randomUUID(), label: '', kind: 'text', required: false },
              ])
            }
          >
            ＋ 添加字段
          </button>
        </fieldset>
      )}
      {kind === 'review' && (
        <fieldset disabled={locked}>
          <legend>审核顺序</legend>
          {stages.map((stage, index) => (
            <div className="collaboration-column-editor" key={index}>
              <input
                required
                value={stage.title}
                placeholder="步骤名称"
                onChange={(e) =>
                  setStages(
                    stages.map((s, i) => (i === index ? { ...s, title: e.target.value } : s)),
                  )
                }
              />
              <select
                multiple
                aria-label={`步骤${index + 1}审核角色`}
                value={stage.roleKeys}
                onChange={(e) =>
                  setStages(
                    stages.map((s, i) =>
                      i === index
                        ? { ...s, roleKeys: [...e.target.selectedOptions].map((o) => o.value) }
                        : s,
                    ),
                  )
                }
              >
                {[
                  ...(dept?.roleKeys ?? []),
                  ...DEVELOPMENT_IDENTITY_SECTIONS.flatMap((section) => section.groups)
                    .flatMap((group) => group.options)
                    .map((option) => option.roleKey)
                    .filter((role) => role.startsWith('counselor.')),
                ].map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setStages(stages.filter((_, i) => i !== index))}>
                移除
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={!dept}
            onClick={() =>
              setStages([
                ...stages,
                { title: '审核材料', roleKeys: [...(dept?.roleKeys.slice(0, 1) ?? [])] },
              ])
            }
          >
            ＋ 添加审核步骤
          </button>
        </fieldset>
      )}
      {locked && <p>已有提交记录，字段结构保持不变；名称、说明与开放状态可以继续修改。</p>}
      {localError && <p role="alert">{localError}</p>}
      <button type="submit" className="collaboration-primary" disabled={busy}>
        {busy ? '保存中…' : '保存协作空间'}
      </button>
      <small>新空间默认保存为草稿，确认后再开放收集。</small>
    </form>
  );
}
function EntryEditor({
  space,
  busy,
  onSubmit,
}: {
  space: CollaborationSpace;
  busy: boolean;
  onSubmit: (value: Record<string, unknown>) => Promise<boolean>;
}) {
  const { user } = useAuth();
  const [choices, setChoices] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [resource, setResource] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<CollaborationEntry>();
  return (
    <form
      className="collaboration-entry-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          entryId: editing?.id,
          values,
          choices,
          resource,
          startsAt: iso(start),
          endsAt: iso(end),
          text,
        });
      }}
    >
      <header>
        <h2>
          {space.kind === 'shared_table'
            ? '添加或编辑记录'
            : space.kind === 'attendance'
              ? '提交参与记录'
              : space.kind === 'practice'
                ? '我的报名志愿'
                : '参与这个空间'}
        </h2>
        {(space.kind === 'shared_table' ||
          (space.kind === 'review' &&
            space.entries.some(
              (entry) => entry.uid === user?.uid && entry.reviewStatus === 'rejected',
            ))) && (
          <select
            aria-label={space.kind === 'review' ? '修订退回材料' : '编辑现有行'}
            value={editing?.id ?? ''}
            onChange={(e) => {
              const entry = space.entries.find((item) => item.id === e.target.value);
              setEditing(entry);
              setText(entry?.text ?? '');
              setValues((entry?.values as Record<string, string | number>) ?? {});
            }}
          >
            <option value="">{space.kind === 'review' ? '新提交材料' : '新增一行'}</option>
            {space.entries
              .filter(
                (entry) =>
                  space.kind !== 'review' ||
                  (entry.uid === user?.uid && entry.reviewStatus === 'rejected'),
              )
              .map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.displayName} · {localDate(entry.updatedAt)}
                </option>
              ))}
          </select>
        )}
      </header>
      {['availability', 'practice'].includes(space.kind) && (
        <div className="collaboration-choice-list">
          {space.slots.map((slot) => (
            <button
              type="button"
              key={slot.id}
              aria-pressed={choices.includes(slot.id)}
              onClick={() =>
                setChoices(
                  choices.includes(slot.id)
                    ? choices.filter((id) => id !== slot.id)
                    : [...choices, slot.id],
                )
              }
            >
              {space.kind === 'practice' && choices.includes(slot.id)
                ? `${choices.indexOf(slot.id) + 1}. `
                : ''}
              {slot.title}
            </button>
          ))}
          {space.kind === 'practice' && (
            <small>按点击顺序排列志愿，再次点击可移除；初步安排生成后由组织确认。</small>
          )}
        </div>
      )}
      {['shared_table', 'materials'].includes(space.kind) && (
        <div className="collaboration-form-grid">
          {space.columns.map((column) => (
            <label key={column.id}>
              {column.label}
              {column.required ? ' *' : ''}
              {column.kind === 'choice' ? (
                <select
                  disabled={
                    space.ownerUid !== user?.uid &&
                    !user?.roles.includes('platform.super_admin') &&
                    Boolean(
                      column.editRoleKeys?.length &&
                      !column.editRoleKeys.some((role) =>
                        user?.roles.some((candidate) => candidate === role),
                      ),
                    )
                  }
                  required={column.required}
                  value={values[column.id] ?? ''}
                  onChange={(e) => setValues({ ...values, [column.id]: e.target.value })}
                >
                  <option value="">请选择</option>
                  {column.options?.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  disabled={
                    space.ownerUid !== user?.uid &&
                    !user?.roles.includes('platform.super_admin') &&
                    Boolean(
                      column.editRoleKeys?.length &&
                      !column.editRoleKeys.some((role) =>
                        user?.roles.some((candidate) => candidate === role),
                      ),
                    )
                  }
                  required={column.required}
                  type={
                    column.kind === 'number' ? 'number' : column.kind === 'date' ? 'date' : 'text'
                  }
                  value={values[column.id] ?? ''}
                  maxLength={4000}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [column.id]:
                        column.kind === 'number' && e.target.value !== ''
                          ? Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              )}
            </label>
          ))}
        </div>
      )}
      {space.kind === 'booking' && (
        <div className="collaboration-form-grid">
          <label>
            预约资源
            <input
              required
              value={resource}
              onChange={(e) => setResource(e.target.value)}
              placeholder="如：公众号头条／摄影棚"
            />
          </label>
          <label>
            开始时间
            <input
              type="datetime-local"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            结束时间
            <input
              type="datetime-local"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
      )}
      {['booking', 'attendance', 'review', 'materials'].includes(space.kind) && (
        <label>
          内容与说明
          <textarea
            required={space.kind !== 'booking'}
            rows={4}
            maxLength={6000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              space.kind === 'materials'
                ? '每日简报、材料说明或公开文章链接…'
                : space.kind === 'review'
                  ? '粘贴秀米／推送链接，补充需要审核的内容…'
                  : '补充本次参与或预约的说明…'
            }
          />
        </label>
      )}
      <button type="submit" className="collaboration-primary" disabled={busy}>
        {busy ? '提交中…' : '提交记录'}
      </button>
      <small>提交后仍可查看自己的记录。预约重叠会提示，请调整时间后重试。</small>
    </form>
  );
}
