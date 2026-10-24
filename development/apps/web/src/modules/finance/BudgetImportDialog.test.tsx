import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  FinanceDepartment,
  FinanceImportCommitResult,
  FinanceImportPreview,
  FinanceTrackingPayload,
} from '@freebbs-development/contracts';

import type { ApiClient } from '../../core/api/client.js';
import { BudgetImportDialog } from './BudgetImportDialog.js';

const departments: FinanceDepartment[] = [
  { id: 'practice', name: '实践组', portId: 'youth_league' },
];
const workspace: FinanceTrackingPayload = {
  configured: true,
  canManageBudget: true,
  ownerUid: null,
  departments,
  submittableDepartmentIds: ['practice'],
  projects: [],
  claims: [],
  settings: null,
};
const commitResult: FinanceImportCommitResult = {
  workspace,
  summary: { created: 0, updated: 1, unchanged: 0 },
};
function preview(overrides: Partial<FinanceImportPreview> = {}): FinanceImportPreview {
  return {
    previewId: 'preview-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    fileName: '预算.xlsx',
    year: '2026-2027',
    canCommit: true,
    issues: [],
    unknownDepartments: [],
    entries: [
      {
        year: '2026-2027',
        departmentId: 'practice',
        departmentName: '实践组',
        portId: 'youth_league',
        code: '2-1-1',
        name: '暑期实践预算',
        reimbursementCents: 20000,
        directPaymentCents: 5000,
        notes: '',
        action: 'update',
        previous: {
          id: 'project-1',
          revision: 2,
          updatedAt: '2026-10-23T00:00:00Z',
          year: '2026-2027',
          departmentId: 'practice',
          code: '2-1-1',
          name: '暑期实践预算',
          reimbursementCents: 10000,
          directPaymentCents: 3000,
          notes: '',
        },
        sourceRows: [{ sheet: '团委预算', row: 3 }],
      },
    ],
    ...overrides,
  };
}
function setup() {
  const request = vi.fn().mockResolvedValue(preview());
  const download = vi.fn();
  const onImported = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <BudgetImportDialog
      client={{ request, download } as unknown as ApiClient}
      departments={departments}
      initialYear="2026-2027"
      onImported={onImported}
      onClose={onClose}
    />,
  );
  return { ...view, request, download, onImported, onClose };
}
async function chooseFile() {
  const file = new File(['xlsx-workbook'], '预算.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  await userEvent.upload(screen.getByLabelText('预算 Excel 文件'), file);
  return file;
}
async function submitImport() {
  // jsdom does not include user-event's synthetic FileList in native required validation.
  // Submit the form after uploading to exercise application validation and the import stages.
  await act(async () => {
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
  });
}

describe('BudgetImportDialog', () => {
  it('uploads only a multipart preview first and shows original and replacement amounts before any budget commit', async () => {
    const { request, onImported } = setup();
    const file = await chooseFile();
    expect((screen.getByLabelText('预算 Excel 文件') as HTMLInputElement).files).toHaveLength(1);
    await submitImport();
    await screen.findByRole('button', { name: '确认导入预算' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('/finance/tracking/imports/preview');
    const init = request.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('file')).toBe(file);
    expect(init.body.get('year')).toBe('2026-2027');
    expect(screen.getByText(/原 ¥100.00 →/)).toBeInTheDocument();
    expect(screen.getByText('¥200.00')).toBeInTheDocument();
    expect(screen.getByText('团委预算 第 3 行')).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });

  it('blocks committing a preview with errors even if a malformed response marks it committable', async () => {
    const { request } = setup();
    request.mockResolvedValueOnce(
      preview({
        canCommit: true,
        issues: [{ severity: 'error', sheet: '预算', row: 4, message: '金额与明细不一致' }],
      }),
    );
    await chooseFile();
    await submitImport();
    await screen.findByText(/金额与明细不一致/);
    expect(screen.queryByRole('button', { name: '确认导入预算' })).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('requires another preview after a department mapping changes and commits only the regenerated preview', async () => {
    const { request, onImported } = setup();
    request.mockResolvedValueOnce(
      preview({
        previewId: 'old-preview',
        canCommit: false,
        entries: [],
        issues: [{ severity: 'error', sheet: '预算', row: 3, message: '无法匹配实践部门' }],
        unknownDepartments: [
          { organization: '团委口', department: '实践部门', sheet: '预算', row: 3 },
        ],
      }),
    );
    await chooseFile();
    await submitImport();
    const mapping = await screen.findByLabelText('表内部门 1：团委口 / 实践部门');
    await userEvent.selectOptions(mapping, 'practice');
    expect(screen.getByText(/输入或部门映射已更改/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认导入预算' })).not.toBeInTheDocument();
    request.mockResolvedValueOnce(preview({ previewId: 'mapped-preview' }));
    await submitImport();
    await screen.findByRole('button', { name: '确认导入预算' });
    expect(JSON.parse(request.mock.calls[1][1].body.get('mappings'))).toEqual([
      { organization: '团委口', department: '实践部门', departmentId: 'practice' },
    ]);
    request.mockResolvedValueOnce(commitResult);
    await submitImport();
    expect(request.mock.calls[2][0]).toBe('/finance/tracking/imports/commit');
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ previewId: 'mapped-preview' });
    expect(onImported).toHaveBeenCalledWith(commitResult, '2026-2027');
  });

  it('invalidates a successful preview when the year changes instead of submitting the old preview', async () => {
    const { request } = setup();
    await chooseFile();
    await submitImport();
    await screen.findByRole('button', { name: '确认导入预算' });
    fireEvent.change(screen.getByLabelText('导入预算年度'), { target: { value: '2027-2028' } });
    expect(screen.queryByRole('button', { name: '确认导入预算' })).not.toBeInTheDocument();
    request.mockResolvedValueOnce(preview({ previewId: 'new-year-preview', year: '2027-2028' }));
    await submitImport();
    await screen.findByRole('button', { name: '确认导入预算' });
    expect(request.mock.calls[1][0]).toBe('/finance/tracking/imports/preview');
    expect(request.mock.calls[1][1].body.get('year')).toBe('2027-2028');
  });

  it('rejects unsupported extensions and oversized files before contacting the server', async () => {
    const { request } = setup();
    const input = screen.getByLabelText('预算 Excel 文件');
    fireEvent.change(input, { target: { files: [new File(['legacy'], '预算.xls')] } });
    await screen.findByText('仅支持 .xlsx 文件，请先将旧格式另存为 .xlsx');
    const oversized = new File(['xlsx'], '大预算.xlsx');
    Object.defineProperty(oversized, 'size', { value: 8 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [oversized] } });
    await screen.findByText('文件超过 8 MB，请精简后重新选择');
    expect(request).not.toHaveBeenCalled();
  });

  it('aborts a closed preview and ignores its late response', async () => {
    const { request, onClose } = setup();
    let resolvePreview!: (value: FinanceImportPreview) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    await chooseFile();
    await submitImport();
    const signal = request.mock.calls[0][1].signal;
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(true);
    await act(async () => resolvePreview(preview()));
    expect(screen.queryByRole('region', { name: '预算导入预览' })).not.toBeInTheDocument();
  });

  it('does not apply a completed commit after the dialog is unmounted by an identity change', async () => {
    const { request, onImported, unmount } = setup();
    await chooseFile();
    await submitImport();
    await screen.findByRole('button', { name: '确认导入预算' });
    let resolveCommit!: (value: FinanceImportCommitResult) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCommit = resolve;
        }),
    );
    await submitImport();
    const signal = request.mock.calls[1][1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolveCommit(commitResult));
    expect(onImported).not.toHaveBeenCalled();
  });

  it('requires a fresh preview after the preview expires', async () => {
    const { request } = setup();
    request.mockResolvedValueOnce(preview({ expiresAt: '2020-01-01T00:00:00Z' }));
    await chooseFile();
    await submitImport();
    await screen.findByRole('button', { name: '确认导入预算' });
    await submitImport();
    await screen.findByText('预览已过期，请重新生成预览后再确认');
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '确认导入预算' })).not.toBeInTheDocument();
  });
});
