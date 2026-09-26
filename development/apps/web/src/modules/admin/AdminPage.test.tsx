import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminPage } from './AdminPage.js';

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));

vi.mock('../../core/api/client.js', () => ({
  createApiClient: () => ({ request: mockRequest }),
}));

const directoryUser = {
  uid: 'uid-1001',
  username: 'Yuchong',
  displayName: 'Yuchong',
  studentId: '2023010567',
  avatarUrl: null,
  accessLevel: 'lead',
  roles: [],
  captainTeamIds: [],
};

describe('AdminPage shell', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockRequest.mockImplementation((path: string) => {
      if (path === '/admin/development-users') return Promise.resolve([directoryUser]);
      if (path === '/sports/teams') return Promise.resolve([]);
      if (path.startsWith('/admin/audit-logs'))
        return Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 });
      throw new Error(`Unexpected request ${path}`);
    });
  });

  it('opens directly on the administrator identity directory', async () => {
    render(<AdminPage />);

    expect(screen.getByRole('heading', { name: '管理员模块' })).toBeInTheDocument();
    expect(await screen.findAllByText(/2023010567/)).not.toHaveLength(0);
    expect(screen.queryByRole('tab', { name: 'Tag 定义' })).not.toBeInTheDocument();
    expect(screen.queryByText('运行状态')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '操作记录' })).toBeInTheDocument();
  });

  it('loads operation records only after opening the secondary panel', async () => {
    render(<AdminPage />);
    await screen.findAllByText(/2023010567/);
    expect(
      mockRequest.mock.calls.some(([path]) => String(path).startsWith('/admin/audit-logs')),
    ).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: '操作记录' }));

    expect(await screen.findByRole('dialog', { name: '操作记录' })).toBeInTheDocument();
    expect(mockRequest).toHaveBeenCalledWith(
      '/admin/audit-logs?action=admin.development_user.update&page=1&pageSize=20',
    );
  });
});
