import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OrganizationsPage } from './OrganizationsPage.js';
import { ApiError, type ApiClient } from '../../core/api/client.js';

const saved = {
  departmentId: 'student_union.sports_center',
  html: '<!doctype html><html><head><style>body{color:red}</style></head><body><h1>Uploaded only</h1><script>window.example=1</script></body></html>',
  originalFilename: 'original.html',
  revision: 2,
  canEdit: true,
  updatedAt: null,
  editor: null,
};
function setup(
  options: { canEdit?: boolean; conflict?: boolean; error?: boolean; empty?: boolean } = {},
) {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/activities'))
      return {
        departmentId: saved.departmentId,
        active: [],
        past: [
          {
            id: 'old',
            source: 'native_collection',
            title: '昔日活动',
            description: '历史说明',
            detailsPath:
              '/collections/registrations?focus=native_collection%3Aold&includePast=true',
            status: 'closed',
          },
        ],
      };
    if (init?.method === 'PUT') {
      if (options.conflict) throw new ApiError(409, 'revision_conflict', 'stale', null);
      if (options.error) throw new ApiError(400, 'invalid_file', '文件格式无效', null);
      return { ...saved, revision: 3 };
    }
    return { ...saved, canEdit: options.canEdit ?? true, html: options.empty ? null : saved.html };
  });
  const view = render(
    <MemoryRouter>
      <OrganizationsPage
        organizationKey="student_union"
        departmentKey="sports_center"
        client={{ request: request as ApiClient['request'] }}
      />
    </MemoryRouter>,
  );
  return { request, ...view };
}
async function choose() {
  const input = await screen.findByLabelText('选择 HTML 文件');
  const file = new File(['<html><body>Replacement</body></html>'], '新主页.html', {
    type: 'text/html',
  });
  Object.defineProperty(file, 'text', {
    value: async () => '<html><body>Replacement</body></html>',
  });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}
describe('department homepage', () => {
  it('isolates the full document and places exact active/past activities beneath it', async () => {
    setup({ canEdit: false });
    const frame = await screen.findByTitle('体育中心主页');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame.getAttribute('srcdoc')).toContain(saved.html);
    expect(frame.getAttribute('srcdoc')!.indexOf('Content-Security-Policy')).toBeLessThan(
      frame.getAttribute('srcdoc')!.indexOf('Uploaded only'),
    );
    expect(screen.queryByText('Uploaded only')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('选择 HTML 文件')).not.toBeInTheDocument();
    expect(screen.getByText('暂无活跃活动')).toBeInTheDocument();
    expect(
      frame.compareDocumentPosition(screen.getByRole('region', { name: '相关活动' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '以往活动' }));
    expect(screen.getByRole('link', { name: /昔日活动/ })).toHaveAttribute(
      'href',
      '/collections/registrations?focus=native_collection%3Aold&includePast=true',
    );
  });
  it('previews before making a multipart replacement with the current revision', async () => {
    const { request } = setup();
    const file = await choose();
    await screen.findByTitle('体育中心主页预览');
    expect(request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '确认替换主页' }));
    await screen.findByText('主页已经更新。');
    const body = request.mock.calls.find(([, init]) => init?.method === 'PUT')![1]!
      .body as FormData;
    expect(body.get('file')).toBe(file);
    expect(body.get('revision')).toBe('2');
  });
  it('retains the selected upload after a conflict until a deliberate reload', async () => {
    const { request } = setup({ conflict: true });
    await choose();
    await screen.findByTitle('体育中心主页预览');
    fireEvent.click(screen.getByRole('button', { name: '确认替换主页' }));
    await screen.findByText(/主页已被其他成员更新/);
    expect(screen.getByTitle('体育中心主页预览')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认替换主页' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新加载当前主页' }));
    await waitFor(() =>
      expect(request.mock.calls.filter(([, init]) => !init).length).toBeGreaterThan(2),
    );
    expect(screen.getByTitle('体育中心主页预览')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认替换主页' })).toBeEnabled();
  });
  it('shows save errors and preserves the preview', async () => {
    setup({ error: true });
    await choose();
    await screen.findByTitle('体育中心主页预览');
    fireEvent.click(screen.getByRole('button', { name: '确认替换主页' }));
    await screen.findByText('文件格式无效');
    expect(screen.getByTitle('体育中心主页预览')).toBeInTheDocument();
  });
  it('shows a default introduction for an empty page', async () => {
    setup({ empty: true, canEdit: false });
    await screen.findByText('部门主页正在准备中。');
    expect(screen.queryByTitle('体育中心主页')).not.toBeInTheDocument();
  });
});
