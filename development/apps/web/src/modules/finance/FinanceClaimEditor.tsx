import { useEffect, useMemo, useState } from 'react';
import {
  FINANCE_INVOICE_CATEGORIES,
  FINANCE_PORTS,
  financeClaimChecklist,
  financeClaimWarnings,
  type FinanceClaimInput,
  type FinanceClaimView,
  type FinanceDepartment,
  type FinanceInvoiceLine,
  type FinancePaymentKind,
  type FinanceTrackingPayload,
  type FinanceWorkflowGuide,
} from '@freebbs-development/contracts';
import { DialogForm } from '../../components/DialogForm.js';
import type { ApiClient } from '../../core/api/client.js';

const BASE = '/finance/tracking';
const money = (cents: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
const textAmount = (cents: number) => (cents ? (cents / 100).toFixed(2) : '');
function centsOf(text: string) {
  if (!text.trim()) return 0;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text.trim())) throw new Error('金额最多保留两位小数');
  const [yuan, fraction = ''] = text.trim().split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('金额超出可填写范围');
  return cents;
}
export function financeGuideFor(data: FinanceTrackingPayload, departmentId: string) {
  const department = data.departments.find((item) => item.id === departmentId);
  const portId =
    departmentId === 'student_union.sports_center' ? 'student_union' : department?.portId;
  return (
    (data.workflowGuides ?? data.settings?.workflowGuides ?? []).find(
      (guide) => guide.portId === portId,
    ) ??
    (portId
      ? { portId, counselors: [], reimbursementSteps: [], directPaymentSteps: [] }
      : undefined)
  );
}
export const financeWorkPortLeadTitle = (portId?: FinanceWorkflowGuide['portId']) =>
  ({
    student_union: '学生会主席',
    science_association: '科协主席',
    media_center: '媒体中心主任',
    sports: '体育中心负责人',
    bbs: 'BBS工作口负责人',
  })[portId as 'student_union' | 'science_association' | 'media_center' | 'sports' | 'bbs'] ??
  '工作口负责人';
export function financeClaimInputOf(
  claim: FinanceClaimView,
  checklist = claim.checklist,
): FinanceClaimInput {
  return {
    projectId: claim.projectId,
    kind: claim.kind,
    items: claim.items,
    amountCents: claim.amountCents,
    payeeName: claim.payeeName,
    payeeStudentId: claim.payeeStudentId,
    materials: claim.materials,
    externalReference: claim.externalReference,
    externalSubmittedAt: claim.externalSubmittedAt,
    notes: claim.notes,
    ...(claim.invoiceLines ? { invoiceLines: claim.invoiceLines } : {}),
    ...(checklist ? { checklist } : {}),
    ...(claim.directPayment ? { directPayment: claim.directPayment } : {}),
  };
}
export function financeClaimTitle(claim: FinanceClaimInput) {
  if (claim.kind === 'direct_payment')
    return (
      claim.directPayment?.workContent ||
      claim.items.map((item) => item.description).join('、') ||
      '代发草稿'
    );
  if (claim.invoiceLines?.length)
    return [
      ...new Set(
        claim.invoiceLines.map(
          (line) =>
            FINANCE_INVOICE_CATEGORIES.find((item) => item.id === line.category)?.name ?? '其他',
        ),
      ),
    ].join('、');
  return claim.items.map((item) => item.description).join('、') || '报销草稿';
}

export function PrivateFinanceFile({
  client,
  id,
  label,
  image = false,
  embedded = false,
}: {
  client: ApiClient;
  id: string;
  label: string;
  image?: boolean;
  embedded?: boolean;
}) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    let objectUrl = '';
    setUrl('');
    setFailed(false);
    void (async () => {
      try {
        const blob = await client.download(`${BASE}/files/${encodeURIComponent(id)}`);
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (current) setFailed(true);
      }
    })();
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, id]);
  if (failed) return <span className="ft-file-error">{label}暂时无法读取</span>;
  if (!url) return <span className="ft-explanation">正在读取{label}…</span>;
  return (
    <div className="ft-private-file">
      {image ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={label} />
        </a>
      ) : (
        <>
          <a href={url} target="_blank" rel="noopener noreferrer">
            {label} ↗
          </a>
          {embedded ? <iframe className="ft-guide-pdf" src={url} title={label} /> : null}
        </>
      )}
    </div>
  );
}

export function FinanceGuide({
  guide,
  kind,
  client,
  embedded = false,
}: {
  guide?: FinanceWorkflowGuide;
  kind: FinancePaymentKind;
  client: ApiClient;
  embedded?: boolean;
}) {
  const rows = [
    ...(kind === 'reimbursement'
      ? [{ label: '授权经费负责人', person: guide?.financeOfficer }]
      : []),
    ...(kind === 'reimbursement' && guide?.portId !== 'youth_league'
      ? [{ label: financeWorkPortLeadTitle(guide?.portId), person: guide?.workPortLead }]
      : []),
    ...(guide?.counselors.length
      ? guide.counselors.map((person) => ({ label: '辅导员', person }))
      : [{ label: '辅导员', person: undefined }]),
    { label: '老师', person: guide?.teacher },
  ];
  return (
    <section className="ft-guide" aria-label="办理指引">
      <h3>{kind === 'reimbursement' ? '学校报销办理指引' : '代发办理指引'}</h3>
      <dl className="ft-guide-people">
        {rows.map(({ label, person }, index) => (
          <div key={index}>
            <dt>{label}</dt>
            <dd>
              {person?.name || '待配置'}
              {person?.employeeNumber ? <span>工作证号 {person.employeeNumber}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {kind === 'direct_payment' ? (
        <p className="ft-explanation">代发直接提交辅导员审核，无需填写学校报销单。</p>
      ) : null}
      {guide?.instructionFileId && kind === 'reimbursement' ? (
        <PrivateFinanceFile
          client={client}
          id={guide.instructionFileId}
          label="报销办理说明 PDF"
          embedded={embedded}
        />
      ) : null}
      {!guide ? <p className="ft-explanation">办理人员与说明待补充，请联系负责辅导员。</p> : null}
    </section>
  );
}

interface InvoiceDraft {
  category: FinanceInvoiceLine['category'];
  amount: string;
  repeatCount: string;
  description: string;
}
export function FinanceClaimEditor({
  data,
  claim,
  kind,
  client,
  pending,
  error,
  onClose,
  onSave,
}: {
  data: FinanceTrackingPayload;
  claim?: FinanceClaimView;
  kind: FinancePaymentKind;
  client: ApiClient;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: FinanceClaimInput, prepareSubmit?: boolean) => Promise<void>;
}) {
  const options = useMemo(
    () =>
      data.projects.filter(
        (project) =>
          data.submittableDepartmentIds.includes(project.departmentId) &&
          (kind === 'reimbursement'
            ? project.reimbursementCents > 0
            : project.directPaymentCents > 0),
      ),
    [data, kind],
  );
  const selectedProject = claim
    ? options.find(
        (project) =>
          project.id === claim.projectId || project.memberProjectIds?.includes(claim.projectId),
      )
    : options[0];
  const departments = data.departments.filter((department) =>
    data.submittableDepartmentIds.includes(department.id),
  );
  const [departmentId, setDepartmentId] = useState(selectedProject?.departmentId ?? '');
  const [organization, setOrganization] = useState(
    departments.find((item) => item.id === selectedProject?.departmentId)?.portId ?? '',
  );
  const [projectId, setProjectId] = useState(selectedProject?.id ?? '');
  const [payeeName, setPayeeName] = useState(claim?.payeeName ?? '');
  const [payeeStudentId, setPayeeStudentId] = useState(claim?.payeeStudentId ?? '');
  const [notes, setNotes] = useState(claim?.notes ?? '');
  const [amount, setAmount] = useState(claim ? textAmount(claim.amountCents) : '');
  const [hourlyRate, setHourlyRate] = useState(
    textAmount(claim?.directPayment?.hourlyRateCents ?? 0),
  );
  const [workContent, setWorkContent] = useState(claim?.directPayment?.workContent ?? '');
  const [proofFileIds, setProofFileIds] = useState(claim?.directPayment?.proofFileIds ?? []);
  const [checklist, setChecklist] = useState(claim?.checklist ?? []);
  const [invoices, setInvoices] = useState<InvoiceDraft[]>(
    claim?.invoiceLines?.map((line) => ({
      category: line.category,
      amount: textAmount(line.amountCents),
      repeatCount: String(line.repeatCount),
      description: line.description ?? '',
    })) ?? [{ category: 'activity_materials', amount: '', repeatCount: '1', description: '' }],
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const guide = financeGuideFor(data, departmentId);
  const project = options.find((item) => item.id === projectId);
  const [externalReference, setExternalReference] = useState(claim?.externalReference ?? '');
  const [externalSubmittedAt, setExternalSubmittedAt] = useState(
    claim?.externalSubmittedAt?.slice(0, 10) ?? '',
  );
  const buildInput = (): FinanceClaimInput => {
    const invoiceLines = invoices.map((line) => {
      const repeatCount = Number(line.repeatCount || '1');
      if (!Number.isSafeInteger(repeatCount) || repeatCount < 1 || repeatCount > 1000)
        throw new Error('重复张数须为 1–1000 的整数');
      return {
        category: line.category,
        amountCents: centsOf(line.amount),
        repeatCount,
        ...(line.description ? { description: line.description } : {}),
      };
    });
    const total =
      kind === 'reimbursement'
        ? invoiceLines.reduce((sum, line) => sum + line.amountCents * line.repeatCount, 0)
        : centsOf(amount);
    if (!Number.isSafeInteger(total)) throw new Error('报销总额超出可填写范围');
    return {
      projectId,
      kind,
      items: [],
      amountCents: total,
      payeeName,
      payeeStudentId,
      materials: [],
      externalReference,
      externalSubmittedAt,
      notes,
      checklist,
      ...(kind === 'reimbursement'
        ? { invoiceLines }
        : { directPayment: { hourlyRateCents: centsOf(hourlyRate), workContent, proofFileIds } }),
    };
  };
  let input: FinanceClaimInput;
  try {
    input = buildInput();
  } catch {
    input = {
      projectId,
      kind,
      items: [],
      amountCents: 0,
      payeeName,
      payeeStudentId,
      materials: [],
      externalReference,
      externalSubmittedAt,
      notes,
      invoiceLines: invoices.map((line) => ({
        category: line.category,
        amountCents: 0,
        repeatCount: 1,
      })),
    };
  }
  const requirements = financeClaimChecklist(input, guide);
  const warnings = financeClaimWarnings(input);
  const balance = project
    ? kind === 'reimbursement'
      ? project.reimbursement
      : project.directPayment
    : undefined;
  const budgetAvailable =
    (balance?.remainingCents ?? 0) +
    (claim &&
    ['department_review', 'initial_approved', 'school_review'].includes(claim.status) &&
    selectedProject?.id === projectId
      ? claim.amountCents
      : 0);
  const changeInvoices = (update: (current: InvoiceDraft[]) => InvoiceDraft[]) => {
    setInvoices(update);
    setChecklist([]);
  };
  const updateInvoice = (index: number, patch: Partial<InvoiceDraft>) =>
    changeInvoices((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    );
  async function save(prepareSubmit = false) {
    try {
      if (!projectId) throw new Error('请选择预算项目');
      const input = buildInput();
      if (
        prepareSubmit &&
        (!input.payeeName.trim() ||
          !input.payeeStudentId.trim() ||
          input.amountCents <= 0 ||
          (kind === 'reimbursement' && input.invoiceLines?.some((line) => line.amountCents <= 0)) ||
          (kind === 'direct_payment' &&
            (!input.directPayment?.workContent.trim() ||
              !input.directPayment.proofFileIds.length ||
              input.directPayment.hourlyRateCents <= 0)))
      ) {
        throw new Error(
          kind === 'reimbursement'
            ? '请补全发票金额、收款人姓名及学号'
            : '请补全代发金额、时薪、工作内容、收款人及工作证明',
        );
      }
      setLocalError(null);
      if (prepareSubmit) await onSave(input, true);
      else await onSave(input);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : '保存失败');
    }
  }
  return (
    <DialogForm
      open
      title={
        claim
          ? `编辑${kind === 'reimbursement' ? '报销' : '代发'}草稿`
          : `新增${kind === 'reimbursement' ? '报销' : '代发'}`
      }
      submitLabel="保存草稿"
      pending={pending || uploading}
      error={localError ?? error}
      onClose={onClose}
      onSubmit={() => save()}
      footerActions={
        <button
          type="button"
          className="primary-button"
          disabled={pending || uploading}
          onClick={() => void save(true)}
        >
          核对材料并提交
        </button>
      }
    >
      <div className="ft-form ft-form-grid">
        <label>
          所属组织
          <select
            required
            value={organization}
            onChange={(event) => {
              setOrganization(event.target.value as FinanceDepartment['portId']);
              setDepartmentId('');
              setProjectId('');
              setChecklist([]);
            }}
          >
            <option value="" disabled>
              请选择组织
            </option>
            {FINANCE_PORTS.filter((port) =>
              departments.some((item) => item.portId === port.id),
            ).map((port) => (
              <option key={port.id} value={port.id}>
                {port.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          所属部门
          <select
            required
            value={departmentId}
            onChange={(event) => {
              setDepartmentId(event.target.value);
              setProjectId('');
              setChecklist([]);
            }}
          >
            <option value="" disabled>
              请选择部门
            </option>
            {departments
              .filter((item) => item.portId === organization)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label className="ft-wide">
          预算项目
          <select
            required
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setChecklist([]);
            }}
          >
            <option value="" disabled>
              请选择项目
            </option>
            {options
              .filter((item) => item.departmentId === departmentId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.year} · {item.code} {item.name}
                </option>
              ))}
          </select>
          {departmentId && !options.some((item) => item.departmentId === departmentId) ? (
            <span className="ft-explanation">
              该部门暂无可{kind === 'reimbursement' ? '报销' : '代发'}的项目。
            </span>
          ) : null}
        </label>
        {kind === 'reimbursement' ? (
          <fieldset className="ft-wide ft-invoice-list">
            <legend>发票信息表</legend>
            {invoices.map((line, index) => (
              <div className="ft-invoice-row" key={index}>
                <label>
                  购买类别 {index + 1}
                  <select
                    value={line.category}
                    onChange={(event) =>
                      updateInvoice(index, {
                        category: event.target.value as InvoiceDraft['category'],
                      })
                    }
                  >
                    {FINANCE_INVOICE_CATEGORIES.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  单张金额（元） {index + 1}
                  <input
                    inputMode="decimal"
                    placeholder="整张发票总额"
                    value={line.amount}
                    onChange={(event) => updateInvoice(index, { amount: event.target.value })}
                  />
                </label>
                <label>
                  重复张数 {index + 1}
                  <input
                    inputMode="numeric"
                    value={line.repeatCount}
                    onChange={(event) => updateInvoice(index, { repeatCount: event.target.value })}
                  />
                </label>
                <div className="ft-actions">
                  <button
                    type="button"
                    aria-label={`复制发票 ${index + 1}`}
                    disabled={invoices.length >= 100}
                    onClick={() =>
                      changeInvoices((current) => [
                        ...current.slice(0, index + 1),
                        { ...line },
                        ...current.slice(index + 1),
                      ])
                    }
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    aria-label={`删除发票 ${index + 1}`}
                    disabled={invoices.length === 1}
                    onClick={() =>
                      changeInvoices((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              disabled={invoices.length >= 100}
              onClick={() =>
                changeInvoices((current) => [
                  ...current,
                  { category: 'activity_materials', amount: '', repeatCount: '1', description: '' },
                ])
              }
            >
              ＋ 添加发票
            </button>
            <p className="ft-invoice-total" aria-live="polite">
              报销合计 <strong>{money(input.amountCents)}</strong>
            </p>
          </fieldset>
        ) : (
          <>
            <label>
              代发金额（元）
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setChecklist([]);
                }}
              />
            </label>
            <label>
              时薪（元/小时）
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={hourlyRate}
                onChange={(event) => {
                  setHourlyRate(event.target.value);
                  setChecklist([]);
                }}
              />
            </label>
            <label className="ft-wide">
              工作内容
              <textarea
                rows={3}
                maxLength={4000}
                value={workContent}
                onChange={(event) => {
                  setWorkContent(event.target.value);
                  setChecklist([]);
                }}
              />
            </label>
            <label className="ft-wide">
              工作证明图片（最多 5 张，每张 5 MB）
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                disabled={uploading || proofFileIds.length >= 5}
                onChange={async (event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length + proofFileIds.length > 5) {
                    setLocalError('工作证明最多 5 张');
                    return;
                  }
                  setUploading(true);
                  setChecklist([]);
                  setLocalError(null);
                  try {
                    for (const file of files) {
                      if (file.size > 5 * 1024 * 1024)
                        throw new Error('每张工作证明图片不能超过 5 MB');
                      const form = new FormData();
                      form.append('file', file);
                      const result = await client.request<{ id: string }>(
                        `${BASE}/files/work-proof`,
                        { method: 'POST', body: form },
                      );
                      setProofFileIds((current) => [...current, result.id]);
                    }
                  } catch (cause) {
                    setLocalError(cause instanceof Error ? cause.message : '上传失败');
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>
            <div className="ft-proof-grid ft-wide">
              {proofFileIds.map((id, index) => (
                <div key={id}>
                  <PrivateFinanceFile
                    client={client}
                    id={id}
                    label={`工作证明 ${index + 1}`}
                    image
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setProofFileIds((current) => current.filter((item) => item !== id));
                      setChecklist([]);
                    }}
                  >
                    移除工作证明 {index + 1}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {balance ? (
          <p
            className={`ft-inline-balance ft-wide ${input.amountCents > budgetAvailable ? 'ft-warning' : ''}`}
            role={input.amountCents > budgetAvailable ? 'alert' : undefined}
          >
            本项目{kind === 'reimbursement' ? '报销' : '代发'}没花金额 {money(budgetAvailable)}
            {input.amountCents > budgetAvailable
              ? `；本笔超出 ${money(input.amountCents - budgetAvailable)}，可带预警提交辅导员审核`
              : ''}
          </p>
        ) : null}
        {warnings.map((warning) => (
          <p className="ft-warning ft-wide" role="alert" key={warning}>
            ⚠ {warning}
          </p>
        ))}
        <label>
          收款人姓名
          <input
            autoComplete="off"
            maxLength={100}
            value={payeeName}
            onChange={(event) => {
              setPayeeName(event.target.value);
              setChecklist([]);
            }}
          />
        </label>
        <label>
          收款人学号
          <input
            autoComplete="off"
            maxLength={80}
            value={payeeStudentId}
            onChange={(event) => {
              setPayeeStudentId(event.target.value);
              setChecklist([]);
            }}
          />
        </label>
        <div className="ft-wide">
          <FinanceGuide guide={guide} kind={kind} client={client} />
        </div>
        <fieldset className="ft-checklist ft-wide">
          <legend>材料与办理确认</legend>
          {requirements.map((item) => (
            <label className="ft-checkbox" key={item.key}>
              <input
                type="checkbox"
                checked={checklist.includes(item.key)}
                onChange={(event) =>
                  setChecklist((current) =>
                    event.target.checked
                      ? [...new Set([...current, item.key])]
                      : current.filter((key) => key !== item.key),
                  )
                }
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
        <details className="ft-wide ft-optional-fields">
          <summary>已有校财务单号或补充说明</summary>
          <label>
            校财务单号 / 代发邮件说明
            <input
              maxLength={300}
              value={externalReference}
              onChange={(event) => setExternalReference(event.target.value)}
            />
          </label>
          <label>
            外部提交日期
            <input
              type="date"
              value={externalSubmittedAt}
              onChange={(event) => setExternalSubmittedAt(event.target.value)}
            />
          </label>
          <label>
            补充说明
            <textarea
              rows={3}
              maxLength={4000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </details>
      </div>
    </DialogForm>
  );
}
