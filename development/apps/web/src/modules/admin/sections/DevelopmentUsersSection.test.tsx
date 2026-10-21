import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../../core/api/client.js';
import { DevelopmentUsersSection } from './DevelopmentUsersSection.js';
import { MemoryRouter, useLocation } from 'react-router-dom';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn(() => null as unknown) }));
vi.mock('../../../core/auth/AuthProvider.js', () => ({ useOptionalAuth: mockAuth }));
function LocationMarker() {
  return <span data-testid="preview-path">{useLocation().pathname}</span>;
}
const person = {
  uid: 'u-target',
  username: 'Target',
  displayName: '目标同学',
  studentId: '2023000002',
  avatarUrl: null,
  accessLevel: 'member' as const,
  roles: ['department.arts_member'],
  captainTeamIds: ['basketball'],
};
function setup(fail = false, accessLevel: 'member' | 'lead' | null = 'member') {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      if (fail) throw new Error('访问设置保存失败');
      return { updated: true, uid: person.uid };
    }
    if (path === '/admin/business-admin-bootstrap')
      return { canInitialize: false, globalAdminCount: 1 };
    if (path.startsWith('/admin/development-users'))
      return { items: [{ ...person, accessLevel }], page: 1, pageSize: 20, total: 1 };
    throw new Error(path);
  });
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <DevelopmentUsersSection client={{ request: request as ApiClient['request'] }} />
      <LocationMarker />
    </MemoryRouter>,
  );
  return request;
}
describe('DevelopmentUsersSection access boundary', () => {
  beforeEach(() => mockAuth.mockReturnValue(null));
  it.each(['member', null] as const)(
    'offers identity preview of %s members only from the qualified lead directory',
    async (accessLevel) => {
      const setPreviewUser = vi.fn();
      mockAuth.mockReturnValue({
        authMode: 'main',
        setPreviewUser,
        user: {
          uid: 'lead',
          roles: ['platform.super_admin'],
          developmentAccess: 'lead',
          viewer: { canManageDevelopment: true, canPreviewDevelopment: true },
        },
      });
      setup(false, accessLevel);
      await userEvent.click(await screen.findByRole('button', { name: '预览此用户界面' }));
      expect(setPreviewUser).toHaveBeenCalledWith(person.uid);
      expect(screen.getByTestId('preview-path')).toHaveTextContent('/community');
      mockAuth.mockReturnValue(null);
    },
  );
  it('does not offer identity preview to a business administrator', async () => {
    mockAuth.mockReturnValue({
      authMode: 'main',
      setPreviewUser: vi.fn(),
      user: {
        uid: 'admin',
        roles: ['platform.admin'],
        businessAdmin: true,
        developmentAccess: 'member',
        viewer: { canManageDevelopment: false, canPreviewDevelopment: true },
      },
    });
    setup();
    await screen.findByRole('button', { name: /Target/ });
    expect(screen.queryByRole('button', { name: '预览此用户界面' })).not.toBeInTheDocument();
    mockAuth.mockReturnValue(null);
  });
  it('manages lead appointment without exposing organizational roles', async () => {
    const request = setup();
    await screen.findByRole('button', { name: /Target/ });
    expect(screen.queryByRole('checkbox', { name: /^平台管理员/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /电子系学生会/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /代表队队长/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '发展端负责人' }));
    await userEvent.click(screen.getByRole('button', { name: '保存负责人设置' }));
    const save = request.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(save?.[1]?.body))).toEqual({ accessLevel: 'lead' });
  });
  it('retains unsaved appointments when searching and preserves failure drafts', async () => {
    const request = setup(true);
    await screen.findByRole('button', { name: /Target/ });
    await userEvent.click(screen.getByRole('button', { name: '发展端负责人' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: '搜索用户名、学号或 UID' }),
      'missing',
    );
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(request.mock.calls.some(([path]) => String(path).includes('query=missing'))).toBe(false);
    expect(screen.getByRole('button', { name: '发展端负责人' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: '保存负责人设置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('访问设置保存失败');
    expect(screen.getByRole('button', { name: '发展端负责人' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('released development membership', () => {
  beforeEach(() => mockAuth.mockReturnValue(null));

  it.each(['member', null] as const)(
    'treats %s access as ordinary membership without whitelist controls',
    async (accessLevel) => {
      const request = setup(false, accessLevel);
      await screen.findByRole('button', { name: /Target/ });
      expect(screen.getByRole('heading', { name: '发展端成员与负责人' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '普通成员' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: '保存负责人设置' })).toBeDisabled();
      expect(screen.queryByText('不可访问')).not.toBeInTheDocument();
      expect(screen.queryByText(/访问白名单/)).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: '批量开放发展端访问' })).not.toBeInTheDocument();
      expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    },
  );

  it('revokes lead authority through the normal-member choice while preserving ordinary access', async () => {
    const request = setup(false, 'lead');
    await screen.findByRole('button', { name: /Target/ });
    expect(screen.getByRole('button', { name: '发展端负责人' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: '普通成员' }));
    await userEvent.click(screen.getByRole('button', { name: '保存负责人设置' }));
    expect(await screen.findByRole('status')).toHaveTextContent('已保存 Target 的负责人设置');
    const save = request.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(save?.[0]).toBe('/admin/development-users/u-target');
    expect(JSON.parse(String(save?.[1]?.body))).toEqual({ accessLevel: null });
    expect(screen.getByRole('button', { name: '普通成员' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '保存负责人设置' })).toBeDisabled();
  });

  it('filters ordinary members and leads without obsolete admission states', async () => {
    const request = setup();
    await screen.findByRole('button', { name: /Target/ });
    const filter = screen.getByRole('combobox', { name: '发展端身份' });
    expect(
      within(filter)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['全部用户', '普通成员', '发展端负责人']);
    await userEvent.selectOptions(filter, 'member');
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(request.mock.calls.some(([path]) => String(path).includes('admission=member'))).toBe(
      true,
    );
  });
});
