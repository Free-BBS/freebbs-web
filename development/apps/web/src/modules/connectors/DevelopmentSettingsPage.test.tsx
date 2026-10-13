import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DevelopmentSettingsPage } from './DevelopmentSettingsPage.js';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock('../../core/auth/AuthProvider.js', () => ({ useAuth: mockAuth }));

describe('development connector settings', () => {
  it('offers effective administrators a clear system settings identity entry while retaining connector management', async () => {
    const request = vi.fn(async (path: string) =>
      path === '/connectors/status'
        ? [
            {
              id: 'feed',
              label: '栏目更新',
              configured: true,
              requirement: '已连接',
            },
          ]
        : [],
    );
    mockAuth.mockReturnValue({
      client: { request },
      user: { roles: ['platform.admin'], businessAdmin: true },
    });
    render(
      <MemoryRouter>
        <DevelopmentSettingsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: '立即更新栏目' })).toBeEnabled();
    expect(screen.getByRole('link', { name: '管理社工身份' })).toHaveAttribute(
      'href',
      '/system-settings',
    );
    expect(screen.queryByText(/身份卡片仍在独立的管理员模块中维护/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '准备通知' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '素材转存' })).toBeInTheDocument();
  });
});
