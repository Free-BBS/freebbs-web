import { useState } from 'react';
import { type CollaborationSpace, type CollaborationEntry } from '@freebbs-development/contracts';
import { useAuth } from '../../core/auth/AuthProvider.js';
import { iso, localDate } from './collaborationTools.js';
export function EntryEditor({
  space,
  busy,
  onSubmit,
}: {
  space: CollaborationSpace;
  busy: boolean;
  onSubmit: (value: Record<string, unknown>) => Promise<boolean>;
}) {
  const { user } = useAuth();
  const previous = ['availability', 'practice'].includes(space.kind)
    ? space.entries.find((entry) => entry.uid === user?.uid)
    : undefined;
  const participationLocked = space.kind === 'practice' && Boolean(previous?.assignedSlot);
  const editableEntries = space.entries.filter((entry) =>
    space.kind === 'review'
      ? entry.uid === user?.uid && entry.reviewStatus === 'rejected'
      : (space.canManage || entry.uid === user?.uid) &&
        (space.kind !== 'attendance' || entry.reviewStatus !== 'approved'),
  );
  const [saved, setSaved] = useState(false);
  const [choices, setChoices] = useState<string[]>(previous?.choices ?? []);
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [resource, setResource] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<CollaborationEntry | undefined>(previous);
  return (
    <form
      className="collaboration-entry-editor"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void onSubmit({
          entryId: editing?.id,
          values,
          choices,
          resource,
          startsAt: iso(start),
          endsAt: iso(end),
          text,
        }).then((success) => setSaved(success));
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
        {['shared_table', 'review', 'materials', 'booking', 'attendance'].includes(space.kind) &&
          (space.kind === 'shared_table' || editableEntries.length > 0) && (
            <select
              aria-label={
                space.kind === 'review'
                  ? '修订退回材料'
                  : space.kind === 'shared_table'
                    ? '编辑现有行'
                    : '编辑现有记录'
              }
              value={editing?.id ?? ''}
              onChange={(event) => {
                const entry = editableEntries.find((item) => item.id === event.target.value);
                setEditing(entry);
                setSaved(false);
                setText(entry?.text ?? '');
                setValues((entry?.values as Record<string, string | number>) ?? {});
                setChoices(entry?.choices ?? []);
                setResource(entry?.resource ?? '');
                const dateInput = (value?: string) =>
                  value
                    ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000)
                        .toISOString()
                        .slice(0, 16)
                    : '';
                setStart(dateInput(entry?.startsAt));
                setEnd(dateInput(entry?.endsAt));
              }}
            >
              <option value="">
                {space.kind === 'review'
                  ? '新提交材料'
                  : space.kind === 'shared_table'
                    ? '新增一行'
                    : '新增记录'}
              </option>
              {editableEntries.map((entry) => (
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
              disabled={participationLocked}
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
              <small>
                {column.kind === 'number'
                  ? '填写数字'
                  : column.kind === 'date'
                    ? '选择日期'
                    : column.kind === 'choice'
                      ? '从已有选项中选择'
                      : '填写文字'}
                {column.editRoleKeys?.length ? ' · 按字段角色权限编辑' : ''}
              </small>
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
      {participationLocked && (
        <p className="collaboration-help">已生成安排，请在记录中确认；志愿调整请联系组织。</p>
      )}
      {saved && <p role="status">记录已保存，可在记录标签中查看。</p>}
      <small>提交后仍可查看自己的记录。预约重叠会提示，请调整时间后重试。</small>
    </form>
  );
}
