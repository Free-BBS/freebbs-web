import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminPage } from './AdminPage.js';

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));

vi.mock('../../core/api/client.js', () => ({
  createApiClient: () => ({ request: mockRequest }),
}));

const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 20, total: items.length });
const recordBase = {
  status: 'active',
  ownerUid: 'admin-1',
  scope: { type: 'public', id: '*' },
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
};

describe('AdminPage shell', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it('uses the default API client and opens on the paged user governance section', async () => {
    mockRequest.mockImplementation((path: string) => {
      if (path === '/admin/subjects?page=1&pageSize=20')
        return Promise.resolve(
          page([
            {
              ...recordBase,
              id: 'subject-1',
              uid: 'uid-1001',
              displayName: '测试用户',
              avatarUrl: null,
            },
          ]),
        );
      if (path === '/admin/role-assignments?page=1&pageSize=20') return Promise.resolve(page([]));
      if (path === '/admin/tag-assignments?page=1&pageSize=20') return Promise.resolve(page([]));
      if (path === '/admin/roles' || path === '/admin/tag-definitions') return Promise.resolve([]);
      throw new Error(`Unexpected request ${path}`);
    });

    render(<AdminPage />);
    expect(screen.getByRole('heading', { name: '系统设置' }).closest('header')).toHaveClass(
      'module-page-header',
    );
    expect(await screen.findByText('uid-1001')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: '用户与授权' })).toBeInTheDocument();
    expect(screen.getByRole('search')).toHaveClass('filter-bar');
    expect(screen.getByRole('list')).toHaveClass('responsive-record-list');
  });

  it('uses the shared loading state while governance data is pending', () => {
    mockRequest.mockImplementation(() => new Promise(() => undefined));

    render(<AdminPage />);

    expect(screen.getByRole('status')).toHaveClass('async-state');
  });

  it('keeps a restricted or failed section recoverable', async () => {
    mockRequest.mockRejectedValue({ status: 403, message: '仅平台最高管理员可访问' });
    render(<AdminPage />);

    expect((await screen.findByRole('alert')).closest('[data-state]')).toHaveAttribute(
      'data-state',
      'error',
    );
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '系统状态' })).toBeInTheDocument();
  });
});
