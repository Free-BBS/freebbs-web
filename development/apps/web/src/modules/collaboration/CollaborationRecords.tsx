import { useState } from 'react';
import { type CollaborationSpace } from '@freebbs-development/contracts';
import { useAuth } from '../../core/auth/AuthProvider.js';
import { EntryMaterials } from './MaterialsControls.js';
import { localDate, roleLabel } from './collaborationTools.js';
export function CollaborationRecords({
  space,
  busy,
  mutate,
  reload,
}: {
  space: CollaborationSpace;
  busy: boolean;
  mutate: (path: string, body: unknown, method?: string) => Promise<boolean>;
  reload: () => Promise<void>;
}) {
  const auth = useAuth();
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState('');
  const filtered = space.entries.filter((entry) =>
    [entry.displayName, entry.text, entry.resource, ...Object.values(entry.values ?? {})]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <section className="collaboration-records">
        <header>
          <h2>{space.canManage ? '全部记录' : '可见记录'}</h2>
          <span>{space.entries.length} 条</span>
        </header>
        <label className="collaboration-record-search">
          搜索记录
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="提交者、内容或字段值"
          />
        </label>
        {filtered.length === 0 ? (
          <p className="collaboration-empty">
            {query ? '没有匹配的记录，请调整搜索内容。' : '还没有可见记录，提交后可在这里查看。'}
          </p>
        ) : space.kind === 'shared_table' ? (
          <div className="collaboration-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">提交者</th>
                  {space.columns.map((column) => (
                    <th scope="col" key={column.id}>
                      {column.label}
                    </th>
                  ))}
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.displayName}</td>
                    {space.columns.map((column) => (
                      <td
                        className={column.kind === 'number' ? 'collaboration-number' : undefined}
                        key={column.id}
                      >
                        {String(entry.values[column.id] ?? '—')}
                      </td>
                    ))}
                    <td>
                      {localDate(entry.updatedAt)}{' '}
                      {(space.canManage || entry.uid === auth.user?.uid) &&
                        space.status === 'published' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setDeleting(entry.id)}
                          >
                            删除
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="collaboration-entry-grid">
            {filtered.map((entry) => (
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
                {space.kind === 'practice' && space.status === 'published' && space.canManage && (
                  <select
                    aria-label={`调整${entry.displayName}支队`}
                    value={entry.assignedSlot ?? ''}
                    disabled={busy || space.status !== 'published'}
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
                  space.status === 'published' &&
                  entry.uid === auth.user?.uid &&
                  entry.assignedSlot &&
                  entry.assignmentStatus !== 'accepted' && (
                    <div>
                      <button
                        disabled={busy || space.status !== 'published'}
                        onClick={() =>
                          void mutate(`/collaboration/${space.id}/entries/${entry.id}/assignment`, {
                            revision: space.revision,
                            decision: 'accepted',
                          })
                        }
                      >
                        接受安排
                      </button>
                      <button
                        disabled={busy || space.status !== 'published'}
                        onClick={() =>
                          void mutate(`/collaboration/${space.id}/entries/${entry.id}/assignment`, {
                            revision: space.revision,
                            decision: 'declined',
                          })
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
                {space.kind === 'review' && (
                  <ol className="collaboration-stage-list" aria-label="审核阶段">
                    {space.stages.map((stage, index) => (
                      <li
                        key={index}
                        aria-current={
                          entry.reviewStatus === 'pending' && entry.stage === index
                            ? 'step'
                            : undefined
                        }
                      >
                        <strong>{stage.title}</strong>
                        <small>
                          {stage.roleKeys.map(roleLabel).join('、')} ·{' '}
                          {entry.reviewStatus === 'approved' || index < entry.stage
                            ? '已通过'
                            : index === entry.stage
                              ? entry.reviewStatus === 'rejected'
                                ? '需补充'
                                : '处理中'
                              : '待进行'}
                        </small>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="collaboration-decision-list">
                  {entry.decisions.map((decision, index) => (
                    <p key={index}>
                      {space.stages[decision.stage]?.title ?? '处理'} ·{' '}
                      {decision.decision === 'approved' ? '通过' : '退回'} ·{' '}
                      {decision.note || '无补充说明'} · {localDate(decision.at)}
                    </p>
                  ))}
                </div>
                {space.status === 'published' &&
                  entry.canReview &&
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

      {deleting && space.status === 'published' && (
        <section
          className="collaboration-confirm"
          role="alertdialog"
          aria-labelledby="delete-record-title"
        >
          <h2 id="delete-record-title">删除这条记录？</h2>
          <p>删除后无法恢复，请确认已选择正确记录。</p>
          <button type="button" disabled={busy} onClick={() => setDeleting('')}>
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void mutate(
                `/collaboration/${space.id}/entries/${deleting}`,
                { revision: space.revision },
                'DELETE',
              ).then((success) => {
                if (success) setDeleting('');
              })
            }
          >
            确认删除
          </button>
        </section>
      )}
    </>
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
