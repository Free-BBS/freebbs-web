import { render, screen } from '@testing-library/react';
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
function setup(fail = false) {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      if (fail) throw new Error('访问设置保存失败');
      return { updated: true, uid: person.uid };
    }
    if (path === '/admin/business-admin-bootstrap')
      return { canInitialize: false, globalAdminCount: 1 };
    if (path.startsWith('/admin/development-users'))
      return { items: [person], page: 1, pageSize: 20, total: 1 };
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
  it('offers real identity preview only from the qualified lead directory', async () => {
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
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '预览此用户界面' }));
    expect(setPreviewUser).toHaveBeenCalledWith(person.uid);
    expect(screen.getByTestId('preview-path')).toHaveTextContent('/community');
    mockAuth.mockReturnValue(null);
  });
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
  it('manages only access and lead appointment without exposing organizational roles', async () => {
    const request = setup();
    await screen.findByRole('button', { name: /Target/ });
    expect(screen.queryByRole('checkbox', { name: /^平台管理员/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /电子系学生会/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /代表队队长/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '发展端负责人' }));
    await userEvent.click(screen.getByRole('button', { name: '保存访问设置' }));
    const save = request.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(save?.[1]?.body))).toEqual({ accessLevel: 'lead' });
  });
  it('retains unsaved access when searching and preserves failure drafts', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: '保存访问设置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('访问设置保存失败');
    expect(screen.getByRole('button', { name: '发展端负责人' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('batch development admission selection', () => {
  beforeEach(() => mockAuth.mockReturnValue(null));
  function batchSetup(failFirst = false) {
    let attempts = 0;
    const first = { ...person, uid: 'u-first', username: 'First', accessLevel: null };
    const second = { ...person, uid: 'u-second', username: 'Second', accessLevel: null };
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/admin/business-admin-bootstrap')
        return { canInitialize: false, globalAdminCount: 1 };
      if (init?.method === 'POST') {
        attempts += 1;
        if (failFirst && attempts === 1) throw new Error('批量开放失败，请重试');
        return {
          changedCount: 2,
          unchangedCount: 0,
          items: [
            { uid: first.uid, accessLevel: 'member' },
            { uid: second.uid, accessLevel: 'member' },
          ],
        };
      }
      const page = Number(new URL(path, 'https://test.local').searchParams.get('page') ?? 1);
      return { items: [page === 2 ? second : first], page, pageSize: 20, total: 21 };
    });
    render(
      <MemoryRouter>
        <DevelopmentUsersSection client={{ request: request as ApiClient['request'] }} />
      </MemoryRouter>,
    );
    return request;
  }
  it('keeps exact selected UIDs across pages and search, reviews names, and retains selection for retry', async () => {
    const request = batchSetup(true);
    await userEvent.click(await screen.findByRole('checkbox', { name: '选择 First' }));
    await userEvent.click(screen.getByRole('button', { name: '下一页' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: '选择当前页用户' }));
    expect(screen.getByText('已选择 2 位用户（最多 100 位）')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: '搜索用户名、学号或 UID' }), 'First');
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByRole('checkbox', { name: '选择 First' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: '批量开放所选用户' }));
    const review = screen.getByRole('region', { name: '确认批量开放' });
    expect(review).toHaveTextContent('First');
    expect(review).toHaveTextContent('Second');
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: '确认开放 2 位用户' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('批量开放失败，请重试');
    expect(screen.getByRole('checkbox', { name: '选择 First' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: '确认开放 2 位用户' }));
    expect(
      await screen.findByText('已开放 2 位用户，2 位新增准入，0 位保留原访问权限。'),
    ).toBeInTheDocument();
    const posts = request.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { uids: ['u-first', 'u-second'] },
      { uids: ['u-first', 'u-second'] },
    ]);
    expect(screen.getByRole('checkbox', { name: '选择 First' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '可访问' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('guards unsaved single-user edits and clears checked users explicitly', async () => {
    const request = batchSetup();
    await userEvent.click(await screen.findByRole('checkbox', { name: '选择 First' }));
    await userEvent.click(screen.getByRole('button', { name: '发展端负责人' }));
    expect(screen.getByRole('button', { name: '批量开放所选用户' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发展端负责人' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: '清空选择' }));
    expect(screen.getByRole('checkbox', { name: '选择 First' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '发展端负责人' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});
