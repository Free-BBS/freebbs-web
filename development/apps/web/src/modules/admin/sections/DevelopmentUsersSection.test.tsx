import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../../core/api/client.js';
import { DevelopmentUsersSection } from './DevelopmentUsersSection.js';

vi.mock('../../../core/auth/AuthProvider.js', () => ({ useOptionalAuth: () => null }));
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
    if (path.startsWith('/admin/development-users')) return [person];
    throw new Error(path);
  });
  render(<DevelopmentUsersSection client={{ request: request as ApiClient['request'] }} />);
  return request;
}
describe('DevelopmentUsersSection access boundary', () => {
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
    expect(request).not.toHaveBeenCalledWith('/admin/development-users?query=missing');
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
