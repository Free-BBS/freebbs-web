import { useState } from 'react';
import type {
  OrganizationGroupCoreField,
  OrganizationGroupField,
  OrganizationGroupVersionInput,
  OrganizationGroupWorkspace,
  OrganizationGroupYear,
  OrganizationGroupViewScope,
} from '@freebbs-development/contracts';
import type { GroupClient } from './OrganizationGroupPage.js';
import { coreLabels, errorMessage, parseClasses, parseRoster } from './model.js';
import { ApiError } from '../../core/api/client.js';
import { jsonOptions } from './api.js';

export function Settings({
  api,
  workspace,
  year,
  onReload,
}: {
  api: GroupClient;
  workspace: OrganizationGroupWorkspace;
  year: OrganizationGroupYear;
  onReload: () => Promise<void>;
}) {
  const [classes, setClasses] = useState(
    workspace.classes.map((item) => `${item.id},${item.label}`).join('\n'),
  );
  const [roster, setRoster] = useState(
    workspace.members
      .map(
        (item) => `${item.uid},${item.studentId},${item.classId},${item.submitClassIds.join('|')}`,
      )
      .join('\n'),
  );
  const [managers, setManagers] = useState(workspace.managerUids.join('\n'));
  const [scope, setScope] = useState(workspace.viewScope.kind);
  const [scopeUsers, setScopeUsers] = useState(
    'ids' in workspace.viewScope ? workspace.viewScope.ids.join('\n') : '',
  );
  const [hide, setHide] = useState(workspace.hideDifficulties);
  const [exportAllowed, setExportAllowed] = useState(workspace.ordinaryExport);
  const [limits, setLimits] = useState({
    maxPhotos: workspace.maxPhotos,
    maxPhotoMiB: workspace.maxPhotoBytes / 1048576,
    maxResourceMiB: workspace.maxResourceBytes / 1048576,
  });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const parsedClasses = parseClasses(classes);
      const members = parseRoster(roster, parsedClasses);
      const viewScope: OrganizationGroupViewScope =
        scope === 'users'
          ? { kind: 'users', ids: scopeUsers.split(/[\s,，]+/).filter(Boolean) }
          : { kind: scope };
      const body = {
        revision: workspace.revision,
        classes: parsedClasses,
        members,
        viewScope,
        hideDifficulties: hide,
        ordinaryExport: exportAllowed,
        maxPhotos: limits.maxPhotos,
        maxPhotoBytes: Math.round(limits.maxPhotoMiB * 1048576),
        maxResourceBytes: Math.round(limits.maxResourceMiB * 1048576),
        ...(workspace.canGrantManagers
          ? { managerUids: managers.split(/[\s,，]+/).filter(Boolean) }
          : {}),
      };
      await api.request('/organization-group/settings', jsonOptions('PATCH', body));
      setConflict(false);
      setMessage(`设置已保存：${parsedClasses.length} 个班级，${members.length} 位成员。`);
      await onReload();
    } catch (cause) {
      setMessage(errorMessage(cause));
      setConflict(cause instanceof ApiError && cause.status === 409);
    } finally {
      setBusy(false);
    }
  }
  async function importRoster(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseRoster(text, parseClasses(classes));
      setRoster(text);
      setMessage(`已校验 ${parsed.length} 位成员。点击保存设置后生效。`);
    } catch (cause) {
      setMessage(errorMessage(cause));
    }
  }
  function previewRoster() {
    try {
      const parsed = parseRoster(roster, parseClasses(classes));
      setMessage(`名册校验通过：${parsed.length} 位成员，UID 与学号均无重复。`);
    } catch (cause) {
      setMessage(errorMessage(cause));
    }
  }
  return (
    <div className="og-settings">
      <section className="og-panel">
        <div className="og-panel-heading">
          <div>
            <h2>班级与成员</h2>
            <p>使用正式目录。每位成员通过 UID 和学号同时匹配身份。</p>
          </div>
          <span className="og-badge">设置修订 {workspace.revision}</span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="og-fields">
            <label>
              班级目录
              <textarea
                aria-label="班级目录"
                rows={5}
                value={classes}
                placeholder="班级编号,班级名称（每行一个）"
                onChange={(event) => setClasses(event.target.value)}
              />
              <small>每行填写 编号,名称；已被历史活动引用的班级须保留。</small>
            </label>
            <label>
              成员名册
              <textarea
                aria-label="成员名册"
                rows={5}
                value={roster}
                placeholder="UID,学号,所属班级编号,可填报班级编号"
                onChange={(event) => setRoster(event.target.value)}
              />
              <small>每行四列，多个可填报班级用 | 分隔；班级编号需来自左侧目录。</small>
            </label>
            <div className="og-span og-actions">
              <label className="og-import">
                导入 CSV
                <input
                  aria-label="导入成员 CSV"
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  onChange={(event) => void importRoster(event.target.files?.[0])}
                />
              </label>
              <button type="button" onClick={previewRoster}>
                校验名册
              </button>
            </div>
            {workspace.canGrantManagers ? (
              <label className="og-span">
                管理员 UID
                <textarea
                  aria-label="管理员 UID"
                  rows={3}
                  value={managers}
                  onChange={(event) => setManagers(event.target.value)}
                />
                <small>仅开发负责人或超级管理员可授予管理权限。每行一个 UID。</small>
              </label>
            ) : null}
            <label>
              台账可查看范围
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as typeof scope)}
              >
                <option value="own">仅查看自己的记录</option>
                <option value="same_class">同班记录</option>
                <option value="all">所有有模块访问权的成员</option>
                <option value="users">指定用户可查看台账</option>
              </select>
            </label>
            {scope === 'users' ? (
              <label>
                指定可查看台账的用户 UID
                <textarea
                  value={scopeUsers}
                  onChange={(event) => setScopeUsers(event.target.value)}
                  rows={3}
                />
                <small>每行一个目录成员 UID。</small>
              </label>
            ) : null}
            <div className="og-checks">
              <label>
                <input
                  type="checkbox"
                  checked={hide}
                  onChange={(event) => setHide(event.target.checked)}
                />
                隐藏共享台账中的困难反馈
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={exportAllowed}
                  onChange={(event) => setExportAllowed(event.target.checked)}
                />
                允许普通成员导出可见记录
              </label>
            </div>
            <div className="og-fields og-span">
              <label>
                照片数量上限
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={limits.maxPhotos}
                  onChange={(event) =>
                    setLimits((current) => ({ ...current, maxPhotos: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                单张照片上限（MiB）
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={limits.maxPhotoMiB}
                  onChange={(event) =>
                    setLimits((current) => ({
                      ...current,
                      maxPhotoMiB: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                资料附件上限（MiB）
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={limits.maxResourceMiB}
                  onChange={(event) =>
                    setLimits((current) => ({
                      ...current,
                      maxResourceMiB: Number(event.target.value),
                    }))
                  }
                />
              </label>
            </div>
          </fieldset>
          {message ? (
            <p role="status" className="og-notice">
              {message}
            </p>
          ) : null}
          {conflict ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onReload()
                  .then(() => {
                    setConflict(false);
                    setMessage('最新设置修订已读取，请核对当前草稿后再保存。');
                  })
                  .catch((cause) => setMessage(errorMessage(cause)))
              }
            >
              读取最新设置修订
            </button>
          ) : null}
          <div className="og-actions">
            <button className="og-primary" disabled={busy || conflict}>
              {busy ? '保存中…' : '保存设置'}
            </button>
          </div>
        </form>
      </section>
      <YearSettings
        key={`year:${year.id}`}
        api={api}
        workspace={workspace}
        year={year}
        onReload={onReload}
      />
      <QuestionDesigner
        key={`questionnaire:${year.id}`}
        api={api}
        workspace={workspace}
        year={year}
        onReload={onReload}
      />
    </div>
  );
}
function YearSettings({
  api,
  workspace,
  year,
  onReload,
}: {
  api: GroupClient;
  workspace: OrganizationGroupWorkspace;
  year: OrganizationGroupYear;
  onReload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    label: year.label,
    startDate: year.startDate ?? '',
    endDate: year.endDate ?? '',
    archived: year.archived,
    submissionOpen: year.submissionOpen,
    editOpen: year.editOpen,
  });
  const [next, setNext] = useState({ label: '', startDate: '', endDate: '', copy: true });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(create = false) {
    setBusy(true);
    setMessage('');
    try {
      if (create && !next.label.trim()) throw new Error('请输入新学年名称。');
      await api.request(
        create
          ? '/organization-group/years'
          : `/organization-group/years/${encodeURIComponent(year.id)}`,
        jsonOptions(
          create ? 'POST' : 'PATCH',
          create
            ? {
                revision: workspace.revision,
                label: next.label,
                ...(next.startDate ? { startDate: next.startDate } : {}),
                ...(next.endDate ? { endDate: next.endDate } : {}),
                ...(next.copy ? { copyFromYearId: year.id } : {}),
              }
            : {
                revision: year.revision,
                ...draft,
                startDate: draft.startDate || null,
                endDate: draft.endDate || null,
              },
        ),
      );
      await onReload();
      setMessage(create ? '新学年已创建，旧学年记录保留。' : '学年设置已保存。');
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="og-panel">
      <h2>学年与开放状态</h2>
      <p className="og-muted">新活动与已有活动的修改分别开放。归档后普通成员只读。</p>
      <fieldset disabled={busy} className="og-fields">
        <label>
          当前学年名称
          <input
            value={draft.label}
            onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
          />
        </label>
        <label>
          开始日期
          <input
            type="date"
            value={draft.startDate}
            onChange={(event) =>
              setDraft((current) => ({ ...current, startDate: event.target.value }))
            }
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={draft.endDate}
            onChange={(event) =>
              setDraft((current) => ({ ...current, endDate: event.target.value }))
            }
          />
        </label>
        <div className="og-checks">
          <label>
            <input
              type="checkbox"
              checked={draft.submissionOpen}
              onChange={(event) =>
                setDraft((current) => ({ ...current, submissionOpen: event.target.checked }))
              }
            />
            开放新活动填报
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.editOpen}
              onChange={(event) =>
                setDraft((current) => ({ ...current, editOpen: event.target.checked }))
              }
            />
            开放原作者修改
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.archived}
              onChange={(event) =>
                setDraft((current) => ({ ...current, archived: event.target.checked }))
              }
            />
            归档当前学年
          </label>
        </div>
      </fieldset>
      <div className="og-actions">
        <button className="og-primary" type="button" disabled={busy} onClick={() => void save()}>
          保存学年状态
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void api
              .request(
                '/organization-group/settings',
                jsonOptions('PATCH', { revision: workspace.revision, activeYearId: year.id }),
              )
              .then(onReload)
              .catch((cause) => setMessage(errorMessage(cause)))
          }
        >
          设为当前活动学年
        </button>
      </div>
      <details className="og-fold">
        <summary>创建新学年</summary>
        <div className="og-fields">
          <label>
            新学年名称
            <input
              value={next.label}
              placeholder="例如 2027—2028"
              onChange={(event) =>
                setNext((current) => ({ ...current, label: event.target.value }))
              }
            />
          </label>
          <label>
            新学年开始日期
            <input
              type="date"
              value={next.startDate}
              onChange={(event) =>
                setNext((current) => ({ ...current, startDate: event.target.value }))
              }
            />
          </label>
          <label>
            新学年结束日期
            <input
              type="date"
              value={next.endDate}
              onChange={(event) =>
                setNext((current) => ({ ...current, endDate: event.target.value }))
              }
            />
          </label>
          <label className="og-inline">
            <input
              type="checkbox"
              checked={next.copy}
              onChange={(event) =>
                setNext((current) => ({ ...current, copy: event.target.checked }))
              }
            />
            复制当前学年问卷
          </label>
        </div>
        <button type="button" disabled={busy} onClick={() => void save(true)}>
          创建学年并设为当前
        </button>
      </details>
      {message ? (
        <p role="status" className="og-notice">
          {message}
        </p>
      ) : null}
      {message ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void onReload()
              .then(() => setMessage('已读取最新学年修订，当前草稿保留，请核对后再保存。'))
              .catch((cause) => setMessage(errorMessage(cause)))
          }
        >
          读取最新学年修订并保留草稿
        </button>
      ) : null}
    </section>
  );
}
const fieldKinds: Record<OrganizationGroupField['kind'], string> = {
  text: '短文本',
  long_text: '长文本',
  integer: '整数',
  date: '日期',
  choice: '单选',
  multi_choice: '多选',
  image: '图片',
};
function QuestionDesigner({
  api,
  workspace,
  year,
  onReload,
}: {
  api: GroupClient;
  workspace: OrganizationGroupWorkspace;
  year: OrganizationGroupYear;
  onReload: () => Promise<void>;
}) {
  const current = workspace.versions.find((item) => item.id === year.currentVersionId);
  const initial = year.draft ?? current ?? { activityTypes: [], fields: [], corePresentation: {} };
  const [draft, setDraft] = useState<OrganizationGroupVersionInput>({
    activityTypes: initial.activityTypes,
    fields: initial.fields,
    corePresentation: initial.corePresentation ?? {},
  });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  function changeField(index: number, patch: Partial<OrganizationGroupField>) {
    setDraft((value) => ({
      ...value,
      fields: value.fields.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    }));
  }
  async function save(publish: boolean) {
    setBusy(true);
    setMessage('');
    try {
      if (
        !draft.activityTypes.length ||
        draft.activityTypes.some((item) => !item.id.trim() || !item.label.trim())
      )
        throw new Error('请设置至少一种活动类型，并填写类型编号和名称。');
      if (
        draft.fields.some(
          (item) =>
            !item.id.trim() ||
            !item.label.trim() ||
            ((item.kind === 'choice' || item.kind === 'multi_choice') && !item.options?.length),
        )
      )
        throw new Error('请补全附加问题编号、标题和选项。');
      await api.request(
        `/organization-group/years/${encodeURIComponent(year.id)}/${publish ? 'versions' : 'draft'}`,
        jsonOptions(publish ? 'POST' : 'PUT', { revision: year.revision, ...draft }),
      );
      await onReload();
      setMessage(publish ? '新问卷版本已发布；历史活动仍使用原问卷。' : '问卷草稿已保存。');
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="og-panel">
      <div className="og-panel-heading">
        <div>
          <h2>填报问卷</h2>
          <p>核心字段规则固定；题目名称、帮助文字和附加问题可调整。</p>
        </div>
        <span className="og-badge">{current ? `当前 v${current.number}` : '尚未发布'}</span>
      </div>
      <fieldset disabled={busy} className="og-designer">
        <h3>活动类型</h3>
        {draft.activityTypes.length ? (
          draft.activityTypes.map((type, index) => (
            <div className="og-designer-row" key={index}>
              <label>
                类型编号
                <input
                  value={type.id}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      activityTypes: value.activityTypes.map((item, position) =>
                        position === index ? { ...item, id: event.target.value } : item,
                      ),
                    }))
                  }
                />
              </label>
              <label>
                类型名称
                <input
                  value={type.label}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      activityTypes: value.activityTypes.map((item, position) =>
                        position === index ? { ...item, label: event.target.value } : item,
                      ),
                    }))
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setDraft((value) => ({
                    ...value,
                    activityTypes: value.activityTypes.filter((_, position) => position !== index),
                  }))
                }
              >
                移除类型
              </button>
            </div>
          ))
        ) : (
          <p className="og-muted">请添加正式使用的活动类型。</p>
        )}
        <button
          type="button"
          onClick={() =>
            setDraft((value) => ({
              ...value,
              activityTypes: [
                ...value.activityTypes,
                { id: `type_${crypto.randomUUID()}`, label: '' },
              ],
            }))
          }
        >
          添加活动类型
        </button>
        <details className="og-fold">
          <summary>核心题目名称与帮助</summary>
          <div className="og-fields">
            {Object.entries(coreLabels).map(([id, defaultLabel]) => {
              const key = id as OrganizationGroupCoreField;
              return (
                <div className="og-core" key={id}>
                  <label>
                    {defaultLabel}题目名称
                    <input
                      value={draft.corePresentation?.[key]?.label ?? defaultLabel}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          corePresentation: {
                            ...value.corePresentation,
                            [key]: { ...value.corePresentation?.[key], label: event.target.value },
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    {defaultLabel}帮助文字
                    <input
                      value={draft.corePresentation?.[key]?.help ?? ''}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          corePresentation: {
                            ...value.corePresentation,
                            [key]: {
                              label: value.corePresentation?.[key]?.label ?? defaultLabel,
                              help: event.target.value,
                            },
                          },
                        }))
                      }
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </details>
        <h3>附加问题</h3>
        {draft.fields.map((field, index) => (
          <section className="og-question" key={index}>
            <div className="og-fields">
              <label>
                问题编号
                <input
                  value={field.id}
                  onChange={(event) => changeField(index, { id: event.target.value })}
                />
                <small>发布后保持编号与题型一致。</small>
              </label>
              <label>
                问题标题
                <input
                  value={field.label}
                  onChange={(event) => changeField(index, { label: event.target.value })}
                />
              </label>
              <label>
                题型
                <select
                  value={field.kind}
                  onChange={(event) =>
                    changeField(index, {
                      kind: event.target.value as OrganizationGroupField['kind'],
                      options:
                        event.target.value === 'choice' || event.target.value === 'multi_choice'
                          ? (field.options ?? [])
                          : undefined,
                    })
                  }
                >
                  {Object.entries(fieldKinds).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                帮助文字
                <input
                  value={field.help ?? ''}
                  onChange={(event) => changeField(index, { help: event.target.value })}
                />
              </label>
              {field.kind === 'choice' || field.kind === 'multi_choice' ? (
                <label className="og-span">
                  选项（每行一个）
                  <textarea
                    value={field.options?.join('\n') ?? ''}
                    rows={3}
                    onChange={(event) =>
                      changeField(index, { options: event.target.value.split('\n') })
                    }
                  />
                </label>
              ) : null}
              {field.kind === 'integer' ? (
                <>
                  <label>
                    最小值
                    <input
                      type="number"
                      value={field.min ?? ''}
                      onChange={(event) =>
                        changeField(index, {
                          min: event.target.value === '' ? undefined : Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    最大值
                    <input
                      type="number"
                      value={field.max ?? ''}
                      onChange={(event) =>
                        changeField(index, {
                          max: event.target.value === '' ? undefined : Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </>
              ) : field.kind === 'text' || field.kind === 'long_text' ? (
                <label>
                  字数上限
                  <input
                    type="number"
                    min={1}
                    value={field.maxLength ?? ''}
                    onChange={(event) =>
                      changeField(index, {
                        maxLength:
                          event.target.value === '' ? undefined : Number(event.target.value),
                      })
                    }
                  />
                </label>
              ) : null}
              <label className="og-inline">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(event) => changeField(index, { required: event.target.checked })}
                />
                必填
              </label>
            </div>
            <button
              type="button"
              onClick={() =>
                setDraft((value) => ({
                  ...value,
                  fields: value.fields.filter((_, position) => position !== index),
                }))
              }
            >
              移除问题
            </button>
          </section>
        ))}
        <button
          type="button"
          onClick={() =>
            setDraft((value) => ({
              ...value,
              fields: [
                ...value.fields,
                { id: `field_${crypto.randomUUID()}`, label: '', kind: 'text', required: false },
              ],
            }))
          }
        >
          添加附加问题
        </button>
      </fieldset>
      {message ? (
        <p role="status" className="og-notice">
          {message}
        </p>
      ) : null}
      {message ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void onReload()
              .then(() => setMessage('已读取最新问卷修订，当前草稿保留，请核对后再保存。'))
              .catch((cause) => setMessage(errorMessage(cause)))
          }
        >
          读取最新问卷修订并保留草稿
        </button>
      ) : null}
      <div className="og-actions">
        <button type="button" disabled={busy} onClick={() => void save(false)}>
          保存问卷草稿
        </button>
        <button
          type="button"
          disabled={busy || year.archived}
          className="og-primary"
          onClick={() => void save(true)}
        >
          发布新问卷版本
        </button>
      </div>
    </section>
  );
}
