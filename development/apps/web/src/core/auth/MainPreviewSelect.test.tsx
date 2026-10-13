import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { UserContext } from '@freebbs-development/contracts';
import { MainPreviewSelect } from './MainPreviewSelect.js';
import { MemoryRouter, useLocation } from 'react-router-dom';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock('./AuthProvider.js', () => ({ useAuth: mockAuth }));
function LocationMarker() {
  return <span data-testid="preview-path">{useLocation().pathname}</span>;
}
function setup(previewing = false, administrator = true) {
  const request = vi.fn(async () => [
    { uid: 'target', username: 'Target', displayName: '目标同学', canReceiveNotifications: true },
    {
      uid: 'inactive',
      username: 'Inactive',
      displayName: '未开放同学',
      canReceiveNotifications: false,
    },
  ]);
  const setPreviewUser = vi.fn();
  const user: UserContext = {
    uid: previewing ? 'target' : 'actor',
    displayName: '同学',
    avatarUrl: null,
    baseRole: 'student',
    roles: administrator ? ['platform.admin'] : ['platform.super_admin'],
    tags: [],
    previewing,
    viewer: {
      uid: 'actor',
      displayName: '管理员',
      canManageDevelopment: !administrator,
      canPreviewDevelopment: administrator,
    },
  };
  mockAuth.mockReturnValue({
    user,
    authMode: 'main',
    demoUser: null,
    client: { request },
    previewUser: previewing ? 'target' : null,
    setPreviewUser,
  });
  render(
    <MemoryRouter initialEntries={['/system-settings']}>
      <MainPreviewSelect />
      <LocationMarker />
    </MemoryRouter>,
  );
  return { request, setPreviewUser };
}
describe('MainPreviewSelect', () => {
  it('loads the business directory for real read-only preview and rejects inactive choices', async () => {
    const { request, setPreviewUser } = setup();
    const picker = await screen.findByRole('combobox', { name: '预览发展端身份' });
    await screen.findByRole('option', { name: /Target/ });
    expect(screen.getByRole('option', { name: /Inactive/ })).toBeDisabled();
    expect(request).toHaveBeenCalledWith('/system-settings/users');
    await userEvent.selectOptions(picker, 'target');
    expect(setPreviewUser).toHaveBeenCalledWith('target');
    expect(screen.getByTestId('preview-path')).toHaveTextContent('/community');
  });
  it('does not expose or fetch preview identities for pure leads', async () => {
    const { request } = setup(false, false);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
  it('returns to actual identity without reading reserved settings during preview', async () => {
    const { request, setPreviewUser } = setup(true);
    await userEvent.click(screen.getByRole('button', { name: '返回实际身份' }));
    await waitFor(() => expect(setPreviewUser).toHaveBeenCalledWith(null));
    expect(screen.getByTestId('preview-path')).toHaveTextContent('/system-settings');
    expect(request).not.toHaveBeenCalled();
  });
});
