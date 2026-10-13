import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminPage } from './AdminPage.js';

const { mockRequest, mockAuth, mockReload } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockAuth: vi.fn(),
  mockReload: vi.fn(),
}));

vi.mock('../../core/auth/AuthProvider.js', () => ({ useOptionalAuth: mockAuth }));

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
    mockReload.mockReset();
    mockReload.mockResolvedValue(undefined);
    mockAuth.mockReturnValue({
      user: {
        uid: 'lead',
        roles: ['platform.super_admin'],
        developmentAccess: 'lead',
        viewer: { canManageDevelopment: true },
      },
      reload: mockReload,
    });
    mockRequest.mockImplementation((path: string) => {
      if (path === '/admin/business-admin-bootstrap')
        return Promise.resolve({ canInitialize: false, globalAdminCount: 1 });
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
      '/admin/audit-logs?action=admin.development_access.update&page=1&pageSize=20',
    );
  });

  it('initializes the first platform administrator only after selecting a user and confirming', async () => {
    let initialized = false;
    mockRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/admin/development-users') return Promise.resolve([directoryUser]);
      if (path === '/admin/business-admin-bootstrap') {
        if (options?.method === 'POST') {
          initialized = true;
          return Promise.resolve({ initialized: true, uid: directoryUser.uid });
        }
        return Promise.resolve({
          canInitialize: !initialized,
          globalAdminCount: initialized ? 1 : 0,
        });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    render(<AdminPage />);
    const confirm = await screen.findByRole('button', { name: '任命首位平台管理员' });
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('首位平台管理员'), directoryUser.uid);
    await userEvent.type(screen.getByLabelText('任命说明'), '初始化业务管理');
    expect(mockRequest.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    await userEvent.click(confirm);
    await waitFor(() => expect(mockReload).toHaveBeenCalledOnce());
    expect(mockRequest).toHaveBeenCalledWith('/admin/business-admin-bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: directoryUser.uid, reason: '初始化业务管理' }),
    });
    expect(screen.queryByRole('button', { name: '任命首位平台管理员' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已任命 Yuchong 为首位平台管理员');
  });

  it('keeps the selected first administrator and reason when initialization fails', async () => {
    mockRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/admin/development-users') return Promise.resolve([directoryUser]);
      if (path === '/admin/business-admin-bootstrap') {
        return options?.method === 'POST'
          ? Promise.reject(new Error('任命冲突，请刷新'))
          : Promise.resolve({ canInitialize: true, globalAdminCount: 0 });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    render(<AdminPage />);
    await screen.findByRole('button', { name: '任命首位平台管理员' });
    await userEvent.selectOptions(screen.getByLabelText('首位平台管理员'), directoryUser.uid);
    await userEvent.type(screen.getByLabelText('任命说明'), '保留说明');
    await userEvent.click(screen.getByRole('button', { name: '任命首位平台管理员' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('任命冲突，请刷新');
    expect(screen.getByLabelText('首位平台管理员')).toHaveValue(directoryUser.uid);
    expect(screen.getByLabelText('任命说明')).toHaveValue('保留说明');
    expect(mockReload).not.toHaveBeenCalled();
  });

  it.each([
    { roles: ['platform.admin'], businessAdmin: true, developmentAccess: 'member' },
    {
      roles: ['platform.super_admin'],
      developmentAccess: 'member',
      viewer: { canManageDevelopment: false },
    },
    {
      roles: ['platform.super_admin'],
      developmentAccess: 'lead',
      viewer: { canManageDevelopment: true },
      previewing: true,
    },
  ])(
    'does not load administrative data for an unqualified or preview identity %j',
    async (user) => {
      mockAuth.mockReturnValue({ user, reload: mockReload });
      render(<AdminPage />);
      await Promise.resolve();
      expect(screen.queryByRole('heading', { name: '管理员模块' })).not.toBeInTheDocument();
      expect(mockRequest).not.toHaveBeenCalled();
    },
  );
});
