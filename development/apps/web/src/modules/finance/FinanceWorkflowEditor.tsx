import { useState } from 'react';
import {
  FINANCE_PORTS,
  type FinanceProcessPerson,
  type FinanceTrackingPayload,
  type FinanceWorkflowGuide,
} from '@freebbs-development/contracts';
import { DialogForm } from '../../components/DialogForm.js';
import type { ApiClient } from '../../core/api/client.js';
import { PrivateFinanceFile, financeWorkPortLeadTitle } from './FinanceClaimEditor.js';

const emptyPerson = (): FinanceProcessPerson => ({ name: '', employeeNumber: '' });
const emptyGuide = (portId: FinanceWorkflowGuide['portId']): FinanceWorkflowGuide => ({
  portId,
  counselors: [],
  reimbursementSteps: [],
  directPaymentSteps: [],
});
export function FinanceWorkflowEditor({
  data,
  client,
  pending,
  error,
  onClose,
  onSave,
}: {
  data: FinanceTrackingPayload;
  client: ApiClient;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (guides: FinanceWorkflowGuide[]) => Promise<void>;
}) {
  const [guides, setGuides] = useState(data.settings?.workflowGuides ?? data.workflowGuides ?? []);
  const [portId, setPortId] = useState<FinanceWorkflowGuide['portId']>('youth_league');
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [stepTexts, setStepTexts] = useState<Record<string, string>>({});
  const guide = guides.find((item) => item.portId === portId) ?? emptyGuide(portId);
  const patch = (value: Partial<FinanceWorkflowGuide>) =>
    setGuides((current) => {
      const existing = current.find((item) => item.portId === portId) ?? emptyGuide(portId);
      return [...current.filter((item) => item.portId !== portId), { ...existing, ...value }];
    });
  function personFields(
    label: string,
    value: FinanceProcessPerson | undefined,
    change: (person: FinanceProcessPerson) => void,
  ) {
    const person = value ?? emptyPerson();
    return (
      <fieldset className="ft-wide ft-person-fields">
        <legend>{label}</legend>
        <label>
          {label}姓名
          <input
            value={person.name}
            maxLength={100}
            onChange={(event) => change({ ...person, name: event.target.value })}
          />
        </label>
        <label>
          {label}工作证号
          <input
            value={person.employeeNumber}
            maxLength={80}
            onChange={(event) => change({ ...person, employeeNumber: event.target.value })}
          />
        </label>
      </fieldset>
    );
  }
  return (
    <DialogForm
      open
      title="财务办理配置"
      description="按工作口维护办理人员、工作证号及提交前的准备事项。"
      submitLabel="保存办理配置"
      pending={pending || uploading}
      error={localError ?? error}
      onClose={onClose}
      onSubmit={async () => {
        const next = guides.map((item) => {
          const clean = (person?: FinanceProcessPerson) =>
            person?.name.trim() || person?.employeeNumber.trim()
              ? { name: person.name.trim(), employeeNumber: person.employeeNumber.trim() }
              : undefined;
          const steps = (kind: 'reimbursementSteps' | 'directPaymentSteps') =>
            (stepTexts[`${item.portId}.${kind}`] ?? item[kind].join('\n'))
              .split('\n')
              .map((text) => text.trim())
              .filter(Boolean);
          return {
            ...item,
            financeOfficer: clean(item.financeOfficer),
            workPortLead: item.portId === 'youth_league' ? undefined : clean(item.workPortLead),
            teacher: clean(item.teacher),
            counselors: item.counselors
              .map((person) => clean(person))
              .filter((person): person is FinanceProcessPerson => Boolean(person)),
            reimbursementSteps: steps('reimbursementSteps'),
            directPaymentSteps: steps('directPaymentSteps'),
          };
        });
        await onSave(next);
      }}
    >
      <div className="ft-form ft-form-grid">
        <label className="ft-wide">
          工作口
          <select
            value={portId}
            onChange={(event) => setPortId(event.target.value as FinanceWorkflowGuide['portId'])}
          >
            {FINANCE_PORTS.map((port) => (
              <option key={port.id} value={port.id}>
                {port.name}
              </option>
            ))}
          </select>
        </label>
        {personFields('经费负责人', guide.financeOfficer, (person) =>
          patch({ financeOfficer: person }),
        )}
        {portId !== 'youth_league' ? (
          personFields(financeWorkPortLeadTitle(portId), guide.workPortLead, (person) =>
            patch({ workPortLead: person }),
          )
        ) : (
          <p className="ft-wide ft-explanation">团委不设置工作口负责人审批。</p>
        )}
        {(guide.counselors.length ? guide.counselors : [emptyPerson()]).map((person, index) => (
          <div className="ft-wide" key={index}>
            {personFields(`辅导员 ${index + 1}`, person, (value) => {
              const counselors = guide.counselors.length ? [...guide.counselors] : [emptyPerson()];
              counselors[index] = value;
              patch({ counselors });
            })}
            {guide.counselors.length > 1 ? (
              <button
                type="button"
                onClick={() =>
                  patch({
                    counselors: guide.counselors.filter((_, position) => position !== index),
                  })
                }
              >
                移除辅导员 {index + 1}
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          className="ft-wide"
          onClick={() =>
            patch({
              counselors: [
                ...(guide.counselors.length ? guide.counselors : [emptyPerson()]),
                emptyPerson(),
              ],
            })
          }
        >
          ＋ 添加辅导员
        </button>
        {personFields('老师', guide.teacher, (person) => patch({ teacher: person }))}
        <label className="ft-wide">
          报销准备步骤（每行一项）
          <textarea
            rows={4}
            value={stepTexts[`${portId}.reimbursementSteps`] ?? guide.reimbursementSteps.join('\n')}
            onChange={(event) => {
              setStepTexts((current) => ({
                ...current,
                [`${portId}.reimbursementSteps`]: event.target.value,
              }));
              patch({});
            }}
          />
        </label>
        <label className="ft-wide">
          代发准备步骤（每行一项）
          <textarea
            rows={3}
            value={stepTexts[`${portId}.directPaymentSteps`] ?? guide.directPaymentSteps.join('\n')}
            onChange={(event) => {
              setStepTexts((current) => ({
                ...current,
                [`${portId}.directPaymentSteps`]: event.target.value,
              }));
              patch({});
            }}
          />
        </label>
        <label className="ft-wide">
          报销办理说明 PDF（10 MB 以内）
          <input
            type="file"
            accept="application/pdf"
            disabled={uploading}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (file.size > 10 * 1024 * 1024) {
                setLocalError('说明 PDF 不能超过 10 MB');
                return;
              }
              const uploadPort = portId;
              setUploading(true);
              setLocalError(null);
              try {
                const form = new FormData();
                form.append('file', file);
                const metadata = await client.request<{ id: string }>(
                  '/finance/tracking/files/instruction',
                  { method: 'POST', body: form },
                );
                setGuides((current) => {
                  const existing =
                    current.find((item) => item.portId === uploadPort) ?? emptyGuide(uploadPort);
                  return [
                    ...current.filter((item) => item.portId !== uploadPort),
                    { ...existing, instructionFileId: metadata.id },
                  ];
                });
              } catch (cause) {
                setLocalError(cause instanceof Error ? cause.message : '上传失败');
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
        {guide.instructionFileId ? (
          <div className="ft-wide">
            <PrivateFinanceFile
              client={client}
              id={guide.instructionFileId}
              label="当前办理说明 PDF"
            />
            <button type="button" onClick={() => patch({ instructionFileId: undefined })}>
              移除说明 PDF
            </button>
          </div>
        ) : null}
      </div>
    </DialogForm>
  );
}
