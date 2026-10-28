import { useRef, useState } from 'react';
import type {
  OrganizationGroupEntry,
  OrganizationGroupFile,
  OrganizationGroupVersion,
  OrganizationGroupWorkspace,
  OrganizationGroupYear,
  OrganizationGroupAnswer,
  OrganizationGroupField,
} from '@freebbs-development/contracts';
import { ApiError } from '../../core/api/client.js';
import { jsonOptions } from './api.js';
import type { GroupClient } from './OrganizationGroupPage.js';
import { FileTile, uploadFile } from './Files.js';
import {
  coreLabels,
  emptyDraft,
  errorMessage,
  pointCount,
  validateEntry,
  type EntryDraft,
} from './model.js';

export function EntryForm({
  api,
  workspace,
  year,
  version: initialVersion,
  entry,
  onSaved,
  onCancel,
}: {
  api: GroupClient;
  workspace: OrganizationGroupWorkspace;
  year: OrganizationGroupYear;
  version: OrganizationGroupVersion;
  entry?: OrganizationGroupEntry;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [version, setVersion] = useState(initialVersion);
  const [nextVersion, setNextVersion] = useState<OrganizationGroupVersion | null>(null);
  const [templateConflict, setTemplateConflict] = useState(false);
  const attemptedBody = useRef<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(() =>
    entry
      ? {
          classId: entry.classId,
          participantCount: String(entry.participantCount),
          activityTypeId: entry.activityTypeId,
          activityTypeIds: entry.activityTypeIds ?? [entry.activityTypeId],
          participantNames: entry.participantNames ?? '',
          activityDate: entry.activityDate ?? '',
          summary: entry.summary,
          difficulties: entry.difficulties ?? '',
          photos: entry.photos,
          extraAnswers: entry.extraAnswers,
        }
      : emptyDraft(workspace.allowedSubmitClassIds[0]),
  );
  const [extraFiles, setExtraFiles] = useState<OrganizationGroupFile[]>(entry?.extraPhotos ?? []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<OrganizationGroupEntry | null>(null);
  const [revision, setRevision] = useState(entry?.revision);
  const token = useRef(crypto.randomUUID());
  const saving = useRef(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const modern = version.template === 'class_activity_v2';
  const maxPhotos = modern ? 5 : workspace.maxPhotos;
  const maxPhotoBytes = modern ? 5 * 1048576 : workspace.maxPhotoBytes;
  const estimatedNames = (draft.participantNames ?? '')
    .trim()
    .split(/[\s、,，;；]+/u)
    .filter(Boolean).length;
  const namesNeedReview =
    estimatedNames > 0 &&
    Number(draft.participantCount) > 0 &&
    estimatedNames !== Number(draft.participantCount);
  function change<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function answer(id: string, value: OrganizationGroupAnswer) {
    setDraft((current) => ({ ...current, extraAnswers: { ...current.extraAnswers, [id]: value } }));
  }
  const label = (key: keyof typeof coreLabels) =>
    version.corePresentation?.[key]?.label ??
    (modern && key === 'activityDate'
      ? '活动时间'
      : modern && key === 'summary'
        ? '活动内容'
        : modern && key === 'difficulties'
          ? '备注'
          : coreLabels[key]);
  const help = (key: keyof typeof coreLabels) => version.corePresentation?.[key]?.help;
  async function upload(files: FileList | null, field?: OrganizationGroupField) {
    if (!files?.length || uploading) return;
    setMessage('');
    setUploading(true);
    try {
      if (!field && draft.photos.length + files.length > maxPhotos)
        throw new Error(`活动照片最多 ${maxPhotos} 张。`);
      for (const file of Array.from(files)) {
        if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > maxPhotoBytes)
          throw new Error(
            `请选择 PNG、JPEG 或 WebP 图片，单张不超过 ${Math.round(maxPhotoBytes / 1048576)} MiB。`,
          );
        const uploaded = await uploadFile(api, file, year.id, 'activity_photo', entry?.id);
        if (field) {
          setExtraFiles((current) => [...current, uploaded]);
          setDraft((current) => ({
            ...current,
            extraAnswers: {
              ...current.extraAnswers,
              [field.id]: [
                ...(Array.isArray(current.extraAnswers[field.id])
                  ? (current.extraAnswers[field.id] as string[])
                  : []),
                uploaded.id,
              ],
            },
          }));
        } else setDraft((current) => ({ ...current, photos: [...current.photos, uploaded] }));
      }
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setUploading(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  }
  async function submit() {
    if (saving.current || uploading || conflict) return;
    const invalid = validateEntry(draft, version, workspace);
    if (invalid) {
      setMessage(invalid);
      return;
    }
    saving.current = true;
    setBusy(true);
    setMessage('');
    const values = {
      classId: draft.classId,
      participantCount: Number(draft.participantCount),
      activityTypeId: modern ? (draft.activityTypeIds?.[0] ?? '') : draft.activityTypeId,
      ...(modern
        ? {
            activityTypeIds: draft.activityTypeIds ?? [],
            participantNames: draft.participantNames ?? '',
          }
        : {}),
      activityDate: draft.activityDate || null,
      summary: draft.summary,
      difficulties: draft.difficulties,
      photoIds: draft.photos.map((file) => file.id),
      extraAnswers: draft.extraAnswers,
    };
    try {
      const body = entry
        ? { revision, ...values }
        : { yearId: year.id, expectedVersionId: version.id, ...values };
      const fingerprint = JSON.stringify(body);
      if (!entry && attemptedBody.current !== null && attemptedBody.current !== fingerprint)
        token.current = crypto.randomUUID();
      attemptedBody.current = fingerprint;
      await api.request<OrganizationGroupEntry>(
        entry
          ? `/organization-group/entries/${encodeURIComponent(entry.id)}`
          : '/organization-group/entries',
        jsonOptions(
          entry ? 'PATCH' : 'POST',
          body,
          entry ? {} : { 'Idempotency-Key': token.current },
        ),
      );
      if (entry) {
        setMessage('活动修改已保存。');
        onSaved();
      } else {
        setDraft(emptyDraft(workspace.allowedSubmitClassIds[0]));
        setExtraFiles([]);
        token.current = crypto.randomUUID();
        attemptedBody.current = null;
        setTemplateConflict(false);
        setMessage('活动已提交，可以继续填报下一次活动。');
        onSaved();
      }
    } catch (cause) {
      setMessage(errorMessage(cause));
      if (cause instanceof ApiError && cause.status === 409) {
        if (entry) setConflict(true);
        else setTemplateConflict(true);
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function loadTemplate() {
    try {
      const latestWorkspace = await api.request<OrganizationGroupWorkspace>(
        '/organization-group/workspace',
      );
      const currentYear = latestWorkspace.years.find((item) => item.id === year.id);
      const newest = latestWorkspace.versions.find(
        (item) => item.id === currentYear?.currentVersionId,
      );
      if (!newest) throw new Error('当前学年尚未发布问卷。');
      setNextVersion(newest);
    } catch (cause) {
      setMessage(errorMessage(cause));
    }
  }
  async function loadLatest() {
    try {
      setLatest(
        await api.request<OrganizationGroupEntry>(
          `/organization-group/entries/${encodeURIComponent(entry!.id)}`,
        ),
      );
    } catch (cause) {
      setMessage(errorMessage(cause));
    }
  }
  const classes = workspace.classes.filter((item) =>
    entry
      ? item.id === entry.classId || workspace.allowedSubmitClassIds.includes(item.id)
      : workspace.allowedSubmitClassIds.includes(item.id),
  );
  const unavailable =
    !entry &&
    (!workspace.classes.length ||
      !workspace.allowedSubmitClassIds.length ||
      year.archived ||
      !year.submissionOpen ||
      !year.currentVersionId);
  return (
    <section className="og-panel">
      <div className="og-panel-heading">
        <div>
          <h2>{entry ? '修改活动记录' : '记录一次共同的活动'}</h2>
          <p>
            {entry
              ? `使用原问卷 v${version.number}，保留原记录归属。`
              : modern
                ? '记录活动内容、参与人员和活动标签，照片可以稍后补充。'
                : '完成活动后填写概要、人数和现场照片。'}
          </p>
        </div>
        <span className="og-badge">问卷 v{version.number}</span>
      </div>
      {unavailable ? (
        <p role="status" className="og-notice">
          {workspace.submissionBlockedReason ??
            (year.archived ? '该学年已归档，活动只读。' : '本学年暂未开放新活动填报。')}
        </p>
      ) : null}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset
          disabled={busy || unavailable}
          className={`og-fields${modern ? ' og-form-modern' : ''}`}
        >
          <label>
            {label('classId')}
            <select
              aria-label={label('classId')}
              value={draft.classId}
              onChange={(event) => change('classId', event.target.value)}
            >
              <option value="">选择班级</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            {help('classId') ? <small>{help('classId')}</small> : null}
          </label>
          <label>
            {label('participantCount')}
            <input
              aria-label={label('participantCount')}
              type="text"
              inputMode="numeric"
              value={draft.participantCount}
              onChange={(event) => change('participantCount', event.target.value)}
            />
            <small>{help('participantCount') ?? '填写正整数；累计统计为参与人次。'}</small>
          </label>
          {modern ? (
            <label>
              {label('activityDate')}
              <input
                aria-label={label('activityDate')}
                type="date"
                required
                min={year.startDate ?? undefined}
                max={year.endDate ?? undefined}
                value={draft.activityDate}
                onChange={(event) => change('activityDate', event.target.value)}
              />
              {help('activityDate') ? <small>{help('activityDate')}</small> : null}
            </label>
          ) : null}
          {modern ? (
            <fieldset className="og-multiple og-span">
              <legend>{label('activityTypeIds')}</legend>
              <div className="og-tag-options">
                {version.activityTypes.map((type) => (
                  <label className="og-tag-choice" key={type.id}>
                    <input
                      type="checkbox"
                      checked={draft.activityTypeIds?.includes(type.id) ?? false}
                      onChange={(event) =>
                        change(
                          'activityTypeIds',
                          event.target.checked
                            ? [...(draft.activityTypeIds ?? []), type.id]
                            : (draft.activityTypeIds ?? []).filter((id) => id !== type.id),
                        )
                      }
                    />
                    <span>{type.label}</span>
                  </label>
                ))}
              </div>
              <small>{help('activityTypeIds') ?? '可选择多个标签。'}</small>
            </fieldset>
          ) : (
            <label>
              {label('activityTypeId')}
              <select
                aria-label={label('activityTypeId')}
                value={draft.activityTypeId}
                onChange={(event) => change('activityTypeId', event.target.value)}
              >
                <option value="">选择类型</option>
                {version.activityTypes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              {help('activityTypeId') ? <small>{help('activityTypeId')}</small> : null}
            </label>
          )}
          {!modern ? (
            <label>
              {label('activityDate')}
              <input
                aria-label={label('activityDate')}
                type="date"
                min={year.startDate ?? undefined}
                max={year.endDate ?? undefined}
                value={draft.activityDate}
                onChange={(event) => change('activityDate', event.target.value)}
              />
              <small>{help('activityDate') ?? '可选，填写活动实际发生日期。'}</small>
            </label>
          ) : null}
          <label className="og-span">
            {label('summary')}
            <textarea
              aria-label={label('summary')}
              rows={4}
              value={draft.summary}
              onChange={(event) => change('summary', event.target.value)}
            />
            <span
              className={`og-counter ${pointCount(draft.summary) > 200 ? 'og-error-text' : ''}`}
            >
              {pointCount(draft.summary)} / 200
            </span>
            {help('summary') ? <small>{help('summary')}</small> : null}
          </label>
          <div className="og-span og-upload">
            <label>
              {label('photos')}
              <input
                ref={photoInput}
                aria-label={label('photos')}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                disabled={uploading}
                onChange={(event) => void upload(event.target.files)}
              />
            </label>
            <small>
              {help('photos') ??
                `${modern ? '选填，' : '至少 1 张，'}最多 ${maxPhotos} 张；单张 ${Math.round(maxPhotoBytes / 1048576)} MiB。`}
            </small>
            {uploading ? <p role="status">正在上传图片，请稍候…</p> : null}
            <div className="og-file-grid">
              {draft.photos.map((file) => (
                <FileTile
                  key={file.id}
                  file={file}
                  api={api}
                  onRemove={() =>
                    change(
                      'photos',
                      draft.photos.filter((item) => item.id !== file.id),
                    )
                  }
                />
              ))}
            </div>
          </div>
          <label className="og-span">
            {label('difficulties')}
            <textarea
              aria-label={label('difficulties')}
              rows={3}
              value={draft.difficulties}
              onChange={(event) => change('difficulties', event.target.value)}
            />
            <small>
              {help('difficulties') ??
                (modern
                  ? '选填，补充需要说明的情况。'
                  : '选填，记录需要协助的困难；最多 2000 字。')}
            </small>
          </label>
          {modern ? (
            <label className="og-span">
              {label('participantNames')}
              <textarea
                aria-label={label('participantNames')}
                rows={3}
                required
                value={draft.participantNames ?? ''}
                onChange={(event) => change('participantNames', event.target.value)}
              />
              <small>
                {help('participantNames') ??
                  '直接填写姓名，可用顿号、逗号或换行分隔。请核对名单与上方参与人数。'}
              </small>
              {namesNeedReview ? (
                <small role="status" className="og-name-hint">
                  按分隔符估算为 {estimatedNames} 位，上方填写 {draft.participantCount}{' '}
                  人；请核对，提示不影响提交。
                </small>
              ) : null}
            </label>
          ) : null}
          {version.fields.map((field) => (
            <div
              key={field.id}
              className={field.kind === 'long_text' || field.kind === 'image' ? 'og-span' : ''}
            >
              <ExtraField
                field={field}
                value={draft.extraAnswers[field.id]}
                onChange={(value) => answer(field.id, value)}
                onUpload={(files) => void upload(files, field)}
                uploading={uploading}
              />
              {field.kind === 'image' ? (
                <div className="og-file-grid">
                  {extraFiles
                    .filter(
                      (file) =>
                        Array.isArray(draft.extraAnswers[field.id]) &&
                        (draft.extraAnswers[field.id] as string[]).includes(file.id),
                    )
                    .map((file) => (
                      <FileTile
                        key={file.id}
                        file={file}
                        api={api}
                        onRemove={() =>
                          answer(
                            field.id,
                            (draft.extraAnswers[field.id] as string[]).filter(
                              (id) => id !== file.id,
                            ),
                          )
                        }
                      />
                    ))}
                </div>
              ) : null}
            </div>
          ))}
        </fieldset>
        {message ? (
          <p role={conflict ? 'alert' : 'status'} className="og-notice">
            {message}
          </p>
        ) : null}
        {conflict ? (
          <div className="og-conflict">
            <p>你的文字和已上传照片已保留。先读取最新记录，再确认是否用当前草稿保存。</p>
            <button type="button" onClick={() => void loadLatest()}>
              读取最新记录并核对
            </button>
            {latest ? (
              <>
                <p>
                  最新概要：{latest.summary}（修订 {latest.revision}）
                </p>
                {latest.canEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRevision(latest.revision);
                      setConflict(false);
                      setMessage('已核对最新修订，可保存当前草稿。');
                    }}
                  >
                    保留我的草稿并采用最新修订
                  </button>
                ) : (
                  <p>{latest.editBlockedReason ?? '该记录暂不可编辑。'}</p>
                )}
              </>
            ) : null}
          </div>
        ) : null}
        {templateConflict ? (
          <div className="og-conflict">
            <p>当前草稿与已上传照片已保留。若问卷已更新，可读取最新版本后核对新增题目。</p>
            <button type="button" onClick={() => void loadTemplate()}>
              读取最新问卷
            </button>
            {nextVersion ? (
              <>
                <p>
                  最新问卷 v{nextVersion.number}
                  ；保留已有文字和照片，移除新版本不再使用的活动标签和附加问题。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setVersion(nextVersion);
                    setDraft((current) => {
                      const selected = modern
                        ? (current.activityTypeIds ?? [])
                        : current.activityTypeId
                          ? [current.activityTypeId]
                          : [];
                      const retained = selected.filter((id) =>
                        nextVersion.activityTypes.some((type) => type.id === id),
                      );
                      return {
                        ...current,
                        activityTypeId: retained[0] ?? '',
                        activityTypeIds: retained,
                        extraAnswers: Object.fromEntries(
                          Object.entries(current.extraAnswers).filter(([id]) =>
                            nextVersion.fields.some((field) => field.id === id),
                          ),
                        ),
                      };
                    });
                    setNextVersion(null);
                    setTemplateConflict(false);
                    setMessage('已使用最新问卷，请核对后重新提交。');
                  }}
                >
                  保留草稿并使用最新问卷
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        <div className="og-actions">
          <button
            className="og-primary"
            type="submit"
            disabled={busy || uploading || unavailable || conflict}
          >
            {busy ? '保存中…' : entry ? '保存修改' : '提交活动'}
          </button>
          {onCancel ? (
            <button type="button" disabled={busy} onClick={onCancel}>
              返回详情
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
function ExtraField({
  field,
  value,
  onChange,
  onUpload,
  uploading,
}: {
  field: OrganizationGroupField;
  value: OrganizationGroupAnswer | undefined;
  onChange: (value: OrganizationGroupAnswer) => void;
  onUpload: (files: FileList | null) => void;
  uploading: boolean;
}) {
  const name = field.label;
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const input =
    field.kind === 'long_text' ? (
      <textarea
        aria-label={name}
        value={text}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
      />
    ) : field.kind === 'choice' ? (
      <select aria-label={name} value={text} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择</option>
        {field.options?.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    ) : field.kind === 'multi_choice' ? (
      <div className="og-checks">
        {field.options?.map((option) => (
          <label key={option}>
            <input
              type="checkbox"
              checked={Array.isArray(value) && value.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...(Array.isArray(value) ? value : []), option]
                    : (Array.isArray(value) ? value : []).filter((item) => item !== option),
                )
              }
            />
            {option}
          </label>
        ))}
      </div>
    ) : field.kind === 'image' ? (
      <input
        aria-label={name}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        disabled={uploading}
        onChange={(event) => onUpload(event.target.files)}
      />
    ) : (
      <input
        aria-label={name}
        type={field.kind === 'date' ? 'date' : 'text'}
        inputMode={field.kind === 'integer' ? 'numeric' : undefined}
        value={text}
        onChange={(event) =>
          onChange(
            field.kind === 'integer' && event.target.value !== ''
              ? Number(event.target.value)
              : event.target.value,
          )
        }
      />
    );
  return field.kind === 'multi_choice' ? (
    <fieldset className="og-multiple">
      <legend>
        {name}
        {field.required ? ' *' : ''}
      </legend>
      {input}
      {field.help ? <small>{field.help}</small> : null}
    </fieldset>
  ) : (
    <label>
      {name}
      {field.required ? ' *' : ''}
      {input}
      {field.help ? <small>{field.help}</small> : null}
    </label>
  );
}
