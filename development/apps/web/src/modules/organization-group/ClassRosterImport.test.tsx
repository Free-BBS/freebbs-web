import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationGroupRosterExcelPreview } from '@freebbs-development/contracts';
import { ApiError, type ApiClient } from '../../core/api/client.js';
import { ClassRosterImport } from './ClassRosterImport.js';
import { downloadBlob } from './Files.js';

vi.mock('./Files.js', () => ({ downloadBlob: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => vi.clearAllMocks());
const classes = [{ id: 'a', label: '无55' }];
const preview: OrganizationGroupRosterExcelPreview = {
  mode: 'append',
  sheetName: '班级名单',
  rowCount: 2,
  warnings: ['同名人员会分别保留，不按姓名合并。'],
  classes: [
    {
      classId: 'a',
      classLabel: '无55',
      revision: 3,
      beforeCount: 1,
      afterCount: 3,
      unchangedCount: 1,
      added: [
        { displayName: '同名同学', studentId: '001' },
        { displayName: '同名同学', studentId: '002' },
      ],
      updated: [],
      removed: [],
    },
  ],
  batches: [
    {
      classId: 'a',
      revision: 3,
      members: [
        { id: 'old', displayName: '原同学' },
        { displayName: '同名同学', studentId: '001' },
        { displayName: '同名同学', studentId: '002' },
      ],
    },
  ],
};
function setup(request = vi.fn().mockResolvedValue(preview)) {
  const api = { request: request as ApiClient['request'] };
  const view = render(<ClassRosterImport api={api} classes={classes} />);
  return { request, api, view };
}
function selectFile(file = new File(['fixture'], '名单.xlsx')) {
  fireEvent.change(screen.getByLabelText('Excel 名单文件'), { target: { files: [file] } });
}
async function inspect() {
  selectFile();
  fireEvent.click(screen.getByRole('button', { name: '上传并预览' }));
  await screen.findByRole('region', { name: '名单导入预览' });
}

describe('class roster Excel import UI', () => {
  it('uploads a real multipart preview then requires explicit confirmation before atomic save', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce({ items: [{ classId: 'a' }] });
    setup(request);
    expect(request).not.toHaveBeenCalled();
    await inspect();
    const sent = request.mock.calls[0]![1];
    expect(sent.method).toBe('POST');
    expect(sent.body).toBeInstanceOf(FormData);
    expect((sent.body as FormData).get('mode')).toBe('append');
    expect((sent.body as FormData).get('file')).toBeInstanceOf(File);
    expect(request.mock.calls[0]![0]).toBe('/organization-group/rosters/import/preview');
    expect(screen.getByText('同名同学 · 001')).toBeInTheDocument();
    expect(screen.getByText('同名同学 · 002')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认导入 1 个班级' })).toBeDisabled();
    expect(request).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '确认导入 1 个班级' }));
    await screen.findByText('已保存 1 个班级名单。原有活动记录中的姓名保持不变。');
    expect(request.mock.calls[1]![0]).toBe('/organization-group/rosters/import');
    expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({ batches: preview.batches });
    expect(screen.queryByRole('region', { name: '名单导入预览' })).not.toBeInTheDocument();
  });

  it('changing mode or file invalidates the previous preview and its confirmation', async () => {
    const { request } = setup();
    await inspect();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('radio', { name: /替换文件涉及的班级/ }));
    expect(screen.queryByRole('region', { name: '名单导入预览' })).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '上传并预览' }));
    await screen.findByRole('region', { name: '名单导入预览' });
    expect((request.mock.calls[1]![1].body as FormData).get('mode')).toBe('replace');
    selectFile(new File(['changed'], '新名单.xlsx'));
    expect(screen.queryByRole('region', { name: '名单导入预览' })).not.toBeInTheDocument();
  });

  it('lists replacements and removals with a separate explicit replacement confirmation', async () => {
    setup(
      vi.fn().mockResolvedValue({
        ...preview,
        mode: 'replace',
        classes: [
          {
            ...preview.classes[0],
            removed: [{ id: 'removed', displayName: '将移除同学' }],
            updated: [
              {
                before: { id: 'rename', displayName: '旧姓名', studentId: '003' },
                after: { id: 'rename', displayName: '新姓名', studentId: '003' },
              },
            ],
          },
        ],
      }),
    );
    fireEvent.click(screen.getByRole('radio', { name: /替换文件涉及的班级/ }));
    await inspect();
    expect(screen.getByText('将移除同学 · 未填学号')).toBeInTheDocument();
    expect(screen.getByText('旧姓名 → 新姓名 · 003')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /确认按文件替换/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '确认替换 1 个班级' })).toBeDisabled();
  });

  it('keeps preview after revision conflict and requires a deliberate new preview and confirmation', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(preview)
      .mockRejectedValueOnce(new ApiError(409, 'revision_conflict', '冲突', null))
      .mockResolvedValueOnce({ ...preview, batches: [{ ...preview.batches[0], revision: 4 }] });
    setup(request);
    await inspect();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '确认导入 1 个班级' }));
    await screen.findByText(/名单已被其他人修改/);
    expect(screen.getByRole('region', { name: '名单导入预览' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认导入 1 个班级' })).toBeDisabled();
    expect(request).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '重新预览当前文件' }));
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeDisabled());
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('aborts and ignores an old identity preview response after replacing the API client', async () => {
    let complete!: (data: OrganizationGroupRosterExcelPreview) => void;
    const request = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { view } = setup(request);
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: '上传并预览' }));
    const signal = request.mock.calls[0]![1].signal as AbortSignal;
    const nextApi = { request: vi.fn() as ApiClient['request'] };
    view.rerender(<ClassRosterImport api={nextApi} classes={classes} />);
    expect(signal.aborted).toBe(true);
    await act(async () => complete(preview));
    expect(screen.queryByRole('region', { name: '名单导入预览' })).not.toBeInTheDocument();
  });

  it('rejects oversized/non-XLSX files locally and never submits unchanged preview batches', async () => {
    const { request } = setup(vi.fn().mockResolvedValue({ ...preview, batches: [] }));
    selectFile(new File(['text'], '名单.txt'));
    fireEvent.click(screen.getByRole('button', { name: '上传并预览' }));
    await screen.findByText('请选择不超过 8 MiB 的 .xlsx 文件。');
    expect(request).not.toHaveBeenCalled();
    const large = new File(['x'], '名单.xlsx');
    Object.defineProperty(large, 'size', { value: 8 * 1024 * 1024 + 1 });
    selectFile(large);
    fireEvent.click(screen.getByRole('button', { name: '上传并预览' }));
    expect(request).not.toHaveBeenCalled();
    await inspect();
    expect(screen.getByText('没有需要保存的变更，现有名单保持不变。')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('downloads the authenticated current template on demand', async () => {
    const { api } = setup();
    fireEvent.click(screen.getByRole('button', { name: '下载 Excel 模板' }));
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(
        api,
        '/organization-group/rosters/import/template',
        '班级人员名单模板.xlsx',
        expect.any(Function),
      ),
    );
  });
});
