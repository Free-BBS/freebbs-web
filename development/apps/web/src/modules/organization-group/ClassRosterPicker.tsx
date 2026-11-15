import { useEffect, useRef, useState } from 'react';
import type {
  OrganizationGroupClassRoster,
  OrganizationGroupRosterMember,
  OrganizationGroupRosterMemberInput,
} from '@freebbs-development/contracts';
import { ApiError } from '../../core/api/client.js';
import { jsonOptions } from './api.js';
import { errorMessage } from './model.js';
import type { GroupClient } from './OrganizationGroupPage.js';
import './class-roster-picker.css';

interface Props {
  api: GroupClient;
  classId: string;
  classLabel: string;
  participantNames: string;
  onApply: (names: string[]) => void;
}
type EditableMember = OrganizationGroupRosterMemberInput & { rowKey: string };

function checkedMembers(members: OrganizationGroupRosterMember[], names: string) {
  const entered = names
    .trim()
    .split(/[\s、,，;；]+/u)
    .filter(Boolean);
  // A plain name cannot identify one of several namesakes. Require an explicit choice.
  return new Set(
    members
      .filter((member) => {
        const matching = members.filter((other) => other.displayName === member.displayName);
        return (
          entered.includes(member.displayName) &&
          (matching.length === 1 ||
            entered.filter((name) => name === member.displayName).length === matching.length)
        );
      })
      .map((member) => member.id),
  );
}

/** Class changes discard only the picker session; the activity remains in EntryForm. */
export function ClassRosterPicker(props: Props) {
  return <RosterSession key={props.classId} {...props} />;
}

function RosterSession({ api, classId, classLabel, participantNames, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<OrganizationGroupClassRoster | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [members, setMembers] = useState<EditableMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const path = `/organization-group/rosters/${encodeURIComponent(classId)}`;
  useEffect(() => {
    setOpen(false);
    setRoster(null);
    setBusy(false);
    return () => {
      generation.current++;
      request.current?.abort();
      request.current = null;
    };
  }, [api]);
  function close() {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setOpen(false);
    setBusy(false);
  }
  async function load() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const revision = ++generation.current;
    setOpen(true);
    setBusy(true);
    setError('');
    try {
      const next = await api.request<OrganizationGroupClassRoster>(path, {
        signal: controller.signal,
      });
      if (revision !== generation.current) return;
      if (next.classId !== classId) throw new Error('班级名单不匹配，请重试。');
      setRoster(next);
      setMembers(next.members.map((member) => ({ ...member, rowKey: member.id })));
      setSelected(checkedMembers(next.members, participantNames));
      setEditing(false);
      setConflict(false);
      setConfirmReload(false);
    } catch (cause) {
      if (revision === generation.current) setError(errorMessage(cause));
    } finally {
      if (revision === generation.current) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  async function save() {
    if (!roster?.canEdit || request.current || conflict) return;
    if (members.some((member) => !member.displayName.trim())) {
      setError('请填写每位同学的姓名，或移除空白行。');
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const revision = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const next = await api.request<OrganizationGroupClassRoster>(path, {
        ...jsonOptions('PUT', {
          revision: roster.revision,
          members: members.map(({ id, displayName, studentId }) => ({
            ...(id ? { id } : {}),
            displayName: displayName.trim(),
            ...(studentId !== undefined ? { studentId: studentId.trim() } : {}),
          })),
        }),
        signal: controller.signal,
      });
      if (revision !== generation.current) return;
      if (next.classId !== classId) throw new Error('班级名单不匹配，请重试。');
      setRoster(next);
      setMembers(next.members.map((member) => ({ ...member, rowKey: member.id })));
      setSelected(
        (current) =>
          new Set(
            next.members.filter((member) => current.has(member.id)).map((member) => member.id),
          ),
      );
      setEditing(false);
    } catch (cause) {
      if (revision === generation.current) {
        const outdated = cause instanceof ApiError && cause.status === 409;
        setConflict(outdated);
        setError(
          outdated
            ? '班级名单已被更新，本次修改已保留。请核对后读取最新名单。'
            : errorMessage(cause),
        );
      }
    } finally {
      if (revision === generation.current) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  function editMember(index: number, values: Partial<EditableMember>) {
    setMembers((current) =>
      current.map((member, position) => (position === index ? { ...member, ...values } : member)),
    );
  }
  return (
    <div className="og-roster-picker">
      <button type="button" disabled={!classId || open} onClick={() => void load()}>
        从班级名单选择
      </button>
      {open ? (
        <section
          className="og-roster-panel"
          aria-label={`${classLabel}班级名单`}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target instanceof HTMLInputElement)
              event.preventDefault();
          }}
        >
          <header>
            <h3>班级名单 · {classLabel}</h3>
            <button type="button" onClick={close}>
              取消
            </button>
          </header>
          {busy ? <p role="status">正在处理名单…</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          {!roster && !busy ? (
            <button type="button" onClick={() => void load()}>
              重试读取
            </button>
          ) : null}
          {roster && !editing ? (
            <>
              <div className="og-roster-tools">
                <span>
                  已选 {selected.size} / {roster.members.length} 人
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setSelected(new Set(roster.members.map((member) => member.id)))}
                >
                  全选
                </button>
                <button type="button" disabled={busy} onClick={() => setSelected(new Set())}>
                  全不选
                </button>
                {roster.canEdit ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(true);
                      setError('');
                    }}
                  >
                    维护本班名单
                  </button>
                ) : null}
              </div>
              {roster.members.length === 0 ? <p>班级名单尚未维护，仍可直接填写参与人员。</p> : null}
              <div className="og-roster-choices">
                {roster.members.map((member) => (
                  <label className="og-roster-choice" key={member.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={selected.has(member.id)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(member.id);
                          else next.delete(member.id);
                          return next;
                        });
                      }}
                    />
                    <span>
                      {member.displayName}
                      {member.studentId ? <small>{member.studentId}</small> : null}
                    </span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="og-primary"
                disabled={busy || selected.size === 0}
                onClick={() => {
                  onApply(
                    roster.members
                      .filter((member) => selected.has(member.id))
                      .map((member) => member.displayName),
                  );
                  close();
                }}
              >
                填写已选姓名与人数
              </button>
            </>
          ) : null}
          {roster && editing ? (
            <>
              <p className="og-roster-hint">维护名单不会改动已填写或已提交的活动。</p>
              <ol className="og-roster-editor">
                {members.map((member, index) => (
                  <li key={member.rowKey}>
                    <label>
                      姓名
                      <input
                        aria-label={`第${index + 1}位姓名`}
                        value={member.displayName}
                        disabled={busy}
                        onChange={(event) => editMember(index, { displayName: event.target.value })}
                      />
                    </label>
                    <label>
                      学号（选填）
                      <input
                        aria-label={`第${index + 1}位学号`}
                        value={member.studentId ?? ''}
                        disabled={busy}
                        onChange={(event) => editMember(index, { studentId: event.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`移除第${index + 1}位`}
                      onClick={() =>
                        setMembers((current) =>
                          current.filter((row) => row.rowKey !== member.rowKey),
                        )
                      }
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ol>
              <div className="og-roster-tools">
                <button
                  type="button"
                  disabled={busy || conflict}
                  onClick={() =>
                    setMembers((current) => [
                      ...current,
                      { rowKey: crypto.randomUUID(), displayName: '' },
                    ])
                  }
                >
                  添加同学
                </button>
                <button
                  type="button"
                  className="og-primary"
                  disabled={busy || conflict}
                  onClick={() => void save()}
                >
                  保存班级名单
                </button>
              </div>
              {conflict ? (
                <div className="og-roster-conflict">
                  {confirmReload ? (
                    <>
                      <p>读取后将放弃本次名单修改，活动填写内容会保留。</p>
                      <button type="button" disabled={busy} onClick={() => void load()}>
                        确认放弃修改并读取
                      </button>
                      <button type="button" disabled={busy} onClick={() => setConfirmReload(false)}>
                        继续保留修改
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmReload(true)}>
                      读取最新名单
                    </button>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
