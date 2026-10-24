import { useEffect, useRef, useState } from 'react';
import {
  FINANCE_PORTS,
  type FinanceDepartment,
  type FinanceImportCommitResult,
  type FinanceImportMapping,
  type FinanceImportPreview,
} from '@freebbs-development/contracts';

import { DialogForm } from '../../components/DialogForm.js';
import type { ApiClient } from '../../core/api/client.js';
import '../../styles/finance-import.css';

const BASE = '/finance/tracking/imports';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const actionLabels = { create: '新增', update: '更新', unchanged: '无变更' } as const;
const money = (cents: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(cents / 100);
const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : '导入失败，请稍后重试';

export interface BudgetImportDialogProps {
  client: ApiClient;
  departments: readonly FinanceDepartment[];
  initialYear: string;
  initialOrganizationId?: string;
  onClose: () => void;
  onImported: (result: FinanceImportCommitResult, year: string) => void;
}

export function BudgetImportDialog({
  client,
  departments,
  initialYear,
  initialOrganizationId = '',
  onClose,
  onImported,
}: BudgetImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [year, setYear] = useState(
    initialYear || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
  );
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [mappings, setMappings] = useState<FinanceImportMapping[]>([]);
  const [preview, setPreview] = useState<FinanceImportPreview | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'commit' | 'template' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
      controller.current?.abort();
    },
    [],
  );

  const hasErrors = preview?.issues.some((issue) => issue.severity === 'error') ?? false;
  const ready = Boolean(preview?.canCommit && preview.entries.length && !hasErrors && !dirty);
  const departmentsInScope = departments.filter(
    (department) => !organizationId || department.portId === organizationId,
  );
  const unknownDepartments = [
    ...new Map(
      (preview?.unknownDepartments ?? []).map((item) => [
        JSON.stringify([item.organization, item.department]),
        item,
      ]),
    ).values(),
  ];
  const counts = preview?.entries.reduce(
    (sum, item) => ({ ...sum, [item.action]: sum[item.action] + 1 }),
    { create: 0, update: 0, unchanged: 0 },
  );

  function invalidate() {
    setDirty(true);
    setError(null);
  }
  function close() {
    if (busy === 'commit') return;
    requestGeneration.current += 1;
    controller.current?.abort();
    onClose();
  }
  async function operation(
    kind: NonNullable<typeof busy>,
    perform: (signal: AbortSignal) => Promise<void>,
  ) {
    const current = ++requestGeneration.current;
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setBusy(kind);
    setError(null);
    try {
      await perform(abort.signal);
    } catch (cause) {
      if (current === requestGeneration.current) setError(messageOf(cause));
    } finally {
      if (current === requestGeneration.current) setBusy(null);
    }
  }
  async function downloadTemplate() {
    await operation('template', async (signal) => {
      const current = requestGeneration.current;
      const blob = await client.download(`${BASE}/template`, { signal });
      if (current !== requestGeneration.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '财务预算导入模板.xlsx';
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  }
  async function submit() {
    if (!file) {
      setError('请选择需要导入的 .xlsx 文件');
      return;
    }
    if (!year.trim()) {
      setError('请填写预算年度');
      return;
    }
    if (ready && preview) {
      if (Date.parse(preview.expiresAt) <= Date.now()) {
        invalidate();
        setError('预览已过期，请重新生成预览后再确认');
        return;
      }
      await operation('commit', async (signal) => {
        const current = requestGeneration.current;
        const result = await client.request<FinanceImportCommitResult>(`${BASE}/commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ previewId: preview.previewId }),
          signal,
        });
        if (current === requestGeneration.current) onImported(result, preview.year);
      });
      return;
    }
    await operation('preview', async (signal) => {
      const current = requestGeneration.current;
      const body = new FormData();
      body.append('file', file);
      body.append('year', year.trim());
      if (organizationId) body.append('organizationId', organizationId);
      if (mappings.length) body.append('mappings', JSON.stringify(mappings));
      const result = await client.request<FinanceImportPreview>(`${BASE}/preview`, {
        method: 'POST',
        body,
        signal,
      });
      if (current === requestGeneration.current) {
        setPreview(result);
        setDirty(false);
      }
    });
  }

  return (
    <DialogForm
      open
      title="导入 Excel 预算"
      description="先检查预览，确认后按项目保存预算额度。原有报销与代发记录继续保留。"
      submitLabel={ready ? '确认导入预算' : preview ? '重新生成预览' : '生成预览'}
      pending={busy !== null}
      error={error}
      onClose={close}
      onSubmit={submit}
    >
      <div className="fi-import">
        <div className="fi-template">
          <div>
            <strong>从现有预算表开始</strong>
            <p>支持 .xlsx，文件不超过 8 MB。也可以下载标准模板整理后导入。</p>
          </div>
          <button type="button" disabled={busy !== null} onClick={() => void downloadTemplate()}>
            下载标准模板
          </button>
        </div>
        <div className="fi-inputs">
          <label>
            预算 Excel 文件
            <input
              required
              disabled={busy !== null}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                invalidate();
                setMappings([]);
                setPreview(null);
                setFile(null);
                if (selected && !/\.xlsx$/i.test(selected.name)) {
                  setError('仅支持 .xlsx 文件，请先将旧格式另存为 .xlsx');
                  return;
                }
                if (selected && selected.size > MAX_FILE_BYTES) {
                  setError('文件超过 8 MB，请精简后重新选择');
                  return;
                }
                setFile(selected);
              }}
            />
          </label>
          <label>
            导入预算年度
            <input
              required
              disabled={busy !== null}
              maxLength={30}
              value={year}
              onChange={(event) => {
                setYear(event.target.value);
                invalidate();
              }}
            />
          </label>
          <label>
            导入组织范围
            <select
              disabled={busy !== null}
              value={organizationId}
              onChange={(event) => {
                setOrganizationId(event.target.value);
                setMappings([]);
                invalidate();
              }}
            >
              <option value="">全部组织</option>
              {FINANCE_PORTS.filter((port) =>
                departments.some((department) => department.portId === port.id),
              ).map((port) => (
                <option key={port.id} value={port.id}>
                  {port.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="fi-note">
          同一年度、部门和项目编号匹配已有项目；多个预算明细归入同一项目。生成预览时不会修改预算。
        </p>
        {preview ? (
          <section className="fi-preview" aria-label="预算导入预览">
            <header>
              <h3>导入预览</h3>
              <span>
                {preview.fileName} · {preview.year}
              </span>
            </header>
            {dirty ? (
              <p className="fi-stale" role="status">
                输入或部门映射已更改，请重新生成预览，确认本次结果后再导入。
              </p>
            ) : null}
            <div className="fi-counts">
              <div>
                <span>新增项目</span>
                <strong>{counts?.create}</strong>
              </div>
              <div>
                <span>更新项目</span>
                <strong>{counts?.update}</strong>
              </div>
              <div>
                <span>无变更</span>
                <strong>{counts?.unchanged}</strong>
              </div>
            </div>
            {preview.issues.length ? (
              <section className="fi-issues" aria-label="导入检查结果">
                <h4>需要关注的内容</h4>
                <ul>
                  {preview.issues.map((issue, index) => (
                    <li key={index} data-severity={issue.severity}>
                      <strong>{issue.severity === 'error' ? '需修正' : '提示'}</strong>
                      <span>
                        {issue.sheet ? `${issue.sheet} · ` : ''}
                        {issue.row > 0 ? `第 ${issue.row} 行 · ` : ''}
                        {issue.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {unknownDepartments.length ? (
              <section className="fi-mappings" aria-label="部门名称对应">
                <h4>确认部门名称对应</h4>
                <p>为表格中的名称选择系统现有部门，再重新生成预览。</p>
                {unknownDepartments.map((source, index) => {
                  const selected =
                    mappings.find(
                      (mapping) =>
                        mapping.organization === source.organization &&
                        mapping.department === source.department,
                    )?.departmentId ?? '';
                  return (
                    <label key={JSON.stringify([source.organization, source.department])}>
                      表内部门 {index + 1}：{source.organization} / {source.department}
                      <select
                        disabled={busy !== null}
                        value={selected}
                        onChange={(event) => {
                          const departmentId = event.target.value;
                          setMappings((current) => [
                            ...current.filter(
                              (mapping) =>
                                mapping.organization !== source.organization ||
                                mapping.department !== source.department,
                            ),
                            ...(departmentId
                              ? [
                                  {
                                    organization: source.organization,
                                    department: source.department,
                                    departmentId,
                                  },
                                ]
                              : []),
                          ]);
                          invalidate();
                        }}
                      >
                        <option value="">请选择系统部门</option>
                        {departmentsInScope.map((department) => (
                          <option key={department.id} value={department.id}>
                            {FINANCE_PORTS.find((port) => port.id === department.portId)?.name} ·{' '}
                            {department.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </section>
            ) : null}
            {preview.entries.length ? (
              <div className="fi-entries">
                {preview.entries.map((entry, index) => (
                  <article
                    className="fi-entry"
                    key={`${entry.departmentId}-${entry.code}-${index}`}
                  >
                    <header>
                      <span>
                        {FINANCE_PORTS.find((port) => port.id === entry.portId)?.name} ·{' '}
                        {entry.departmentName}
                      </span>
                      <strong className="fi-action" data-action={entry.action}>
                        {actionLabels[entry.action]}
                      </strong>
                    </header>
                    <h4>
                      {entry.code} {entry.name}
                    </h4>
                    <dl>
                      <div>
                        <dt>报销额度</dt>
                        <dd>
                          {entry.previous ? (
                            <small>原 {money(entry.previous.reimbursementCents)} → </small>
                          ) : null}
                          <strong>{money(entry.reimbursementCents)}</strong>
                        </dd>
                      </div>
                      <div>
                        <dt>代发额度</dt>
                        <dd>
                          {entry.previous ? (
                            <small>原 {money(entry.previous.directPaymentCents)} → </small>
                          ) : null}
                          <strong>{money(entry.directPaymentCents)}</strong>
                        </dd>
                      </div>
                    </dl>
                    <p>
                      {entry.sourceRows.map((row) => `${row.sheet} 第 ${row.row} 行`).join('、')}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="fi-note">尚未识别到可导入项目，请检查表格和上方提示。</p>
            )}
            {hasErrors || !preview.canCommit ? (
              <p className="fi-blocked">当前结果不能导入。请修正表格或部门对应关系，再生成预览。</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </DialogForm>
  );
}
