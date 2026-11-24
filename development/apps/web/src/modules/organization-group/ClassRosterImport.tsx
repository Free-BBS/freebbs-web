import { useEffect, useRef, useState } from 'react';
import type {
  OrganizationGroupClass,
  OrganizationGroupRosterExcelPreview,
  OrganizationGroupRosterImportMode,
  OrganizationGroupRosterImportResult,
  OrganizationGroupRosterMemberInput,
} from '@freebbs-development/contracts';
import { ApiError } from '../../core/api/client.js';
import type { GroupClient } from './OrganizationGroupPage.js';
import { jsonOptions } from './api.js';
import { downloadBlob } from './Files.js';
import { errorMessage } from './model.js';
import './class-roster-import.css';

const base = '/organization-group/rosters/import';

function PersonList({
  title,
  members,
}: {
  title: string;
  members: OrganizationGroupRosterMemberInput[];
}) {
  if (!members.length) return null;
  return (
    <div className="og-roster-import-people">
      <h4>
        {title}（{members.length} 人）
      </h4>
      <ul>
        {members.map((member, index) => (
          <li key={`${member.id ?? member.studentId ?? 'new'}-${index}`}>
            {member.displayName}
            {member.studentId ? ` · ${member.studentId}` : ' · 未填学号'}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ClassRosterImport({
  api,
  classes,
}: {
  api: GroupClient;
  classes: OrganizationGroupClass[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<OrganizationGroupRosterImportMode>('append');
  const [preview, setPreview] = useState<OrganizationGroupRosterExcelPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [fileKey, setFileKey] = useState(0);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    generation.current++;
    setFile(null);
    setPreview(null);
    setConfirmed(false);
    setConflict(false);
    setBusy('');
    setError('');
    setMessage('');
    setFileKey((value) => value + 1);
    return () => {
      generation.current++;
      request.current?.abort();
      request.current = null;
    };
  }, [api]);

  function invalidate() {
    setPreview(null);
    setConfirmed(false);
    setConflict(false);
    setError('');
    setMessage('');
  }
  async function template() {
    if (busy) return;
    const version = ++generation.current;
    setBusy('template');
    setError('');
    try {
      await downloadBlob(
        api,
        `${base}/template`,
        '班级人员名单模板.xlsx',
        () => generation.current === version,
      );
    } catch (cause) {
      if (generation.current === version) setError(errorMessage(cause));
    } finally {
      if (generation.current === version) setBusy('');
    }
  }
  async function inspect() {
    if (!file || busy) return;
    if (!/\.xlsx$/i.test(file.name) || file.size > 8 * 1024 * 1024) {
      setError('请选择不超过 8 MiB 的 .xlsx 文件。');
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const version = ++generation.current;
    invalidate();
    setBusy('preview');
    const body = new FormData();
    body.append('file', file);
    body.append('mode', mode);
    try {
      const next = await api.request<OrganizationGroupRosterExcelPreview>(`${base}/preview`, {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      if (generation.current === version) setPreview(next);
    } catch (cause) {
      if (generation.current === version) setError(errorMessage(cause));
    } finally {
      if (generation.current === version) {
        setBusy('');
        request.current = null;
      }
    }
  }
  async function save() {
    if (!preview || !confirmed || conflict || !preview.batches.length || busy) return;
    const controller = new AbortController();
    request.current = controller;
    const version = ++generation.current;
    setBusy('save');
    setError('');
    try {
      const result = await api.request<OrganizationGroupRosterImportResult>(base, {
        ...jsonOptions('POST', { batches: preview.batches }),
        signal: controller.signal,
      });
      if (generation.current !== version) return;
      setPreview(null);
      setConfirmed(false);
      setFile(null);
      setFileKey((value) => value + 1);
      setMessage(`已保存 ${result.items.length} 个班级名单。原有活动记录中的姓名保持不变。`);
    } catch (cause) {
      if (generation.current === version) {
        setConfirmed(false);
        if (cause instanceof ApiError && cause.status === 409) {
          setConflict(true);
          setError('名单已被其他人修改，本次没有覆盖。请重新预览当前文件，核对新的变更后再确认。');
        } else setError(errorMessage(cause));
      }
    } finally {
      if (generation.current === version) {
        setBusy('');
        request.current = null;
      }
    }
  }
  return (
    <section className="og-panel og-roster-import" aria-label="班级名单 Excel 导入">
      <header>
        <h2>导入班级人员名单</h2>
        <p>
          把各班名单集中导入，团支书填写活动时即可从本班选择人员。上传后先核对，确认后才会保存。
        </p>
      </header>
      <div className="og-roster-import-tools">
        <button type="button" disabled={!!busy} onClick={() => void template()}>
          {busy === 'template' ? '正在生成模板…' : '下载 Excel 模板'}
        </button>
        <span>模板附已配置班级对照；学号选填，建议按文本填写以保留前导零。</span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void inspect();
        }}
      >
        <label>
          Excel 名单文件
          <input
            key={fileKey}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={!!busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              invalidate();
            }}
          />
        </label>
        <p className="og-muted">
          首行：班级、姓名、学号（选填）。班级填写已配置的名称或
          ID；读取“班级名单”工作表，单工作表文件也可。最多 8 MiB、4999 条数据，每班导入后不超过 2000
          人。
        </p>
        <fieldset disabled={!!busy}>
          <legend>导入方式</legend>
          <label className="og-roster-import-choice">
            <input
              type="radio"
              name="roster-import-mode"
              checked={mode === 'append'}
              onChange={() => {
                setMode('append');
                invalidate();
              }}
            />
            <span>
              <strong>增量添加</strong>：保留已有人员，只新增；同学号且同姓名的人员不重复添加。
            </span>
          </label>
          <label className="og-roster-import-choice">
            <input
              type="radio"
              name="roster-import-mode"
              checked={mode === 'replace'}
              onChange={() => {
                setMode('replace');
                invalidate();
              }}
            />
            <span>
              <strong>替换文件涉及的班级</strong>
              ：这些班级以文件为准，未列出的旧人员会移除；其他班级保持不变。
            </span>
          </label>
        </fieldset>
        <button className="og-primary" type="submit" disabled={!file || !!busy || !classes.length}>
          {busy === 'preview' ? '正在解析与核对…' : conflict ? '重新预览当前文件' : '上传并预览'}
        </button>
        {!classes.length && <p role="status">请先在管理设置中配置班级，再导入名单。</p>}
      </form>
      {error && (
        <p role="alert" className="og-notice">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {preview && (
        <section className="og-roster-import-preview" aria-label="名单导入预览">
          <h3>核对导入变更</h3>
          <p>
            已读取“{preview.sheetName}”的 {preview.rowCount} 条人员记录，涉及{' '}
            {preview.classes.length} 个班级。当前方式：
            <strong>{preview.mode === 'append' ? '增量添加' : '替换文件涉及的班级'}</strong>
            。尚未保存。
          </p>
          {preview.warnings.length > 0 && (
            <ul className="og-notice">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {preview.classes.map((item) => (
            <details key={item.classId} className="og-roster-import-class">
              <summary>
                <strong>{item.classLabel}</strong>
                <span>
                  {item.beforeCount} → {item.afterCount} 人；新增 {item.added.length}、改名{' '}
                  {item.updated.length}、移除 {item.removed.length}
                </span>
              </summary>
              <div>
                <p>保留未变 {item.unchangedCount} 人。确认时会再次核对班级名单版本。</p>
                <PersonList title="新增人员" members={item.added} />
                {item.updated.length > 0 && (
                  <div className="og-roster-import-people">
                    <h4>按学号匹配的改名（{item.updated.length} 人）</h4>
                    <ul>
                      {item.updated.map((change) => (
                        <li key={change.before.id}>
                          {change.before.displayName} → {change.after.displayName} ·{' '}
                          {change.after.studentId}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <PersonList title="将移除的人员" members={item.removed} />
              </div>
            </details>
          ))}
          {preview.batches.length ? (
            <>
              <label className="og-roster-import-choice og-roster-import-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={!!busy || conflict}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  {preview.mode === 'replace'
                    ? '我已核对各班新增、改名和移除人员，确认按文件替换这些班级名单。'
                    : '我已核对新增人员，确认增量添加；不按姓名合并同名人员。'}
                </span>
              </label>
              <button
                type="button"
                className="og-primary"
                disabled={!confirmed || !!busy || conflict}
                onClick={() => void save()}
              >
                {busy === 'save'
                  ? '正在保存…'
                  : `确认${preview.mode === 'replace' ? '替换' : '导入'} ${preview.batches.length} 个班级`}
              </button>
            </>
          ) : (
            <p role="status">没有需要保存的变更，现有名单保持不变。</p>
          )}
        </section>
      )}
      <details>
        <summary>查看已配置班级</summary>
        <ul className="og-roster-import-classes">
          {classes.map((item) => (
            <li key={item.id}>
              {item.label} · {item.id}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
