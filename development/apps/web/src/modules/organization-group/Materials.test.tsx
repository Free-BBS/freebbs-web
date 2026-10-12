import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  OrganizationGroupWorkspace,
  OrganizationGroupYear,
  OrganizationGroupDeadline,
  OrganizationGroupResource,
} from '@freebbs-development/contracts';
import type { ApiClient, RequestOptions } from '../../core/api/client.js';
import { ApiError } from '../../core/api/client.js';
import { Materials } from './Materials.js';
const year: OrganizationGroupYear = {
  id: 'year',
  label: '2026—2027',
  revision: 1,
  startDate: null,
  endDate: null,
  archived: false,
  submissionOpen: true,
  editOpen: true,
  currentVersionId: 'v1',
  draft: null,
};
const workspace = {
  canManage: true,
  classes: [{ id: 'c', label: '电子班' }],
  members: [{ uid: 'student', studentId: '1001', classId: 'c', submitClassIds: ['c'] }],
  managerUids: ['manager'],
  maxResourceBytes: 52428800,
} as OrganizationGroupWorkspace;
const deadline: OrganizationGroupDeadline = {
  id: 'ddl',
  yearId: 'year',
  title: '提交班级材料',
  description: '材料说明',
  dueAt: '2026-10-11T04:05:00Z',
  scope: { kind: 'department' },
  status: 'active',
  revision: 3,
  createdBy: 'manager',
  updatedAt: '',
  displayStatus: 'upcoming',
};
const file = {
  id: 'file',
  originalName: '原资料.pdf',
  mime: 'application/pdf',
  size: 80,
  previewable: true,
  purpose: 'resource' as const,
  yearId: 'year',
  createdAt: '',
};
const resource: OrganizationGroupResource = {
  id: 'resource',
  yearId: 'year',
  title: '资料包',
  description: '原说明',
  scope: { kind: 'department' },
  fileId: 'file',
  file,
  deadlineId: null,
  revision: 4,
  createdBy: 'manager',
  updatedAt: '',
};
function setup(conflict = false) {
  const request = vi.fn(async (path: string, options?: RequestOptions) => {
    if (path === '/organization-group/uploads')
      return { ...file, id: 'new', originalName: '替换.pdf' };
    if (options?.method === 'PATCH') {
      if (conflict) throw new ApiError(409, 'revision_conflict', '资料已更新', null);
      return path.includes('deadlines') ? deadline : resource;
    }
    if (path.startsWith('/organization-group/deadlines?')) return { items: [deadline] };
    return { items: [resource] };
  });
  render(
    <Materials
      api={{ request: request as ApiClient['request'] }}
      workspace={workspace}
      year={year}
    />,
  );
  return request;
}
describe('deadline and resource management', () => {
  it.each(['deadline', 'resource'] as const)(
    'keeps an incrementally typed newline before a second UID in %s scope',
    async (kind) => {
      const request = setup();
      fireEvent.click(
        await screen.findByRole('button', {
          name: kind === 'deadline' ? '编辑事项' : '编辑资料 / 替换附件',
        }),
      );
      const editor = within(
        screen
          .getByRole('heading', { name: kind === 'deadline' ? '编辑截止事项' : '编辑资料与附件' })
          .closest('section')!,
      );
      fireEvent.change(editor.getByLabelText('可见范围'), { target: { value: 'users' } });
      const input = editor.getByLabelText(/可见用户 UID/) as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: 'student' } });
      fireEvent.change(input, { target: { value: input.value + '\n' } });
      expect(input).toHaveValue('student\n');
      for (const char of 'manager')
        fireEvent.change(input, { target: { value: input.value + char } });
      expect(input).toHaveValue('student\nmanager');
      fireEvent.click(
        editor.getByRole('button', { name: kind === 'deadline' ? '保存事项' : '保存资料' }),
      );
      const path =
        kind === 'deadline'
          ? '/organization-group/deadlines/ddl'
          : '/organization-group/resources/resource';
      await waitFor(() =>
        expect(request).toHaveBeenCalledWith(path, expect.objectContaining({ method: 'PATCH' })),
      );
      const options = request.mock.calls.find(
        ([calledPath, options]) => calledPath === path && options?.method === 'PATCH',
      )![1]!;
      expect(JSON.parse(String(options.body)).scope).toEqual({
        kind: 'users',
        ids: ['student', 'manager'],
      });
    },
  );
  it('edits a deadline with Shanghai timezone, visibility and current revision', async () => {
    const request = setup();
    fireEvent.click(await screen.findByRole('button', { name: '编辑事项' }));
    const editor = within(
      screen.getByRole('heading', { name: '编辑截止事项' }).closest('section')!,
    );
    expect(editor.getByLabelText('截止时间（北京时间）')).toHaveValue('2026-10-11T12:05');
    fireEvent.change(editor.getByLabelText('截止时间（北京时间）'), {
      target: { value: '2026-10-12T18:30' },
    });
    fireEvent.change(editor.getByLabelText('可见范围'), { target: { value: 'classes' } });
    fireEvent.click(editor.getByRole('checkbox', { name: '电子班' }));
    fireEvent.change(editor.getByLabelText('事项状态'), { target: { value: 'cancelled' } });
    fireEvent.click(editor.getByRole('button', { name: '保存事项' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/organization-group/deadlines/ddl',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const options = request.mock.calls.find(
      ([path, options]) =>
        path === '/organization-group/deadlines/ddl' && options?.method === 'PATCH',
    )![1]!;
    expect(JSON.parse(String(options.body))).toMatchObject({
      revision: 3,
      dueAt: '2026-10-12T18:30:00+08:00',
      scope: { kind: 'classes', ids: ['c'] },
      status: 'cancelled',
    });
    expect(JSON.parse(String(options.body))).not.toHaveProperty('yearId');
    expect(new Headers(options.headers).get('Content-Type')).toBe('application/json');
  });
  it('retains a replacement attachment and draft after revision conflict', async () => {
    const request = setup(true);
    fireEvent.click(await screen.findByRole('button', { name: '编辑资料 / 替换附件' }));
    const editor = within(
      screen.getByRole('heading', { name: '编辑资料与附件' }).closest('section')!,
    );
    fireEvent.change(editor.getByLabelText('资料标题'), { target: { value: '新版资料' } });
    fireEvent.change(editor.getByLabelText(/替换资料附件/), {
      target: { files: [new File(['pdf'], '替换.pdf', { type: 'application/pdf' })] },
    });
    await editor.findByText('替换.pdf');
    fireEvent.click(editor.getByRole('button', { name: '保存资料' }));
    await editor.findByText('资料已更新');
    expect(editor.getByLabelText('资料标题')).toHaveValue('新版资料');
    expect(editor.getByText('替换.pdf')).toBeInTheDocument();
    const options = request.mock.calls.find(
      ([path, options]) =>
        path === '/organization-group/resources/resource' && options?.method === 'PATCH',
    )![1]!;
    expect(JSON.parse(String(options.body))).toMatchObject({
      revision: 4,
      fileId: 'new',
      title: '新版资料',
      deadlineId: null,
    });
    fireEvent.click(editor.getByRole('button', { name: '读取资料最新修订' }));
    fireEvent.click(await editor.findByRole('button', { name: '确认采用最新修订' }));
    expect(editor.getByText('替换.pdf')).toBeInTheDocument();
  });
  it('accepts explicit manager UIDs in a resource visibility scope', async () => {
    const request = setup();
    fireEvent.click(await screen.findByRole('button', { name: '编辑资料 / 替换附件' }));
    const editor = within(
      screen.getByRole('heading', { name: '编辑资料与附件' }).closest('section')!,
    );
    fireEvent.change(editor.getByLabelText('可见范围'), { target: { value: 'users' } });
    fireEvent.change(editor.getByLabelText(/可见用户 UID/), { target: { value: 'manager' } });
    fireEvent.click(editor.getByRole('button', { name: '保存资料' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/organization-group/resources/resource',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
  });
});
