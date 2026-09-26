import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../../../core/api/client.js';
import { DevelopmentUsersSection } from './DevelopmentUsersSection.js';

vi.mock('../../../core/auth/AuthProvider.js', () => ({
  useOptionalAuth: () => ({ setPreviewUser: vi.fn() }),
}));

const person = {
  uid: 'u-target',
  username: 'Target',
  displayName: '目标同学',
  studentId: '2023000002',
  avatarUrl: null,
  accessLevel: 'member' as const,
  roles: [],
  captainTeamIds: [],
};

const teams = [
  {
    id: 'team-basketball',
    name: '男篮代表队',
    description: '',
    season: '2026',
    trainingSchedule: '',
    status: 'active',
    scope: { type: 'sports_team', id: 'team-basketball' },
  },
];

describe('DevelopmentUsersSection', () => {
  it('uses group-exclusive buttons, cross-group selection, and scoped captain choices', async () => {
    const request = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/admin/development-users') return Promise.resolve([person]);
      if (path === '/sports/teams') return Promise.resolve(teams);
      if (path === '/admin/development-users/u-target' && init?.method === 'PUT')
        return Promise.resolve({ updated: true, uid: 'u-target' });
      throw new Error(`Unexpected request ${path}`);
    });
    const user = userEvent.setup();
    render(<DevelopmentUsersSection client={{ request: request as ApiClient['request'] }} />);

    await screen.findByRole('button', { name: /Target/ });
    await user.click(screen.getByRole('button', { name: /电子系学生会/ }));
    await user.click(screen.getByRole('button', { name: '文艺中心：负责人' }));
    await user.click(screen.getByRole('button', { name: '文艺中心：部员' }));
    expect(screen.getByRole('button', { name: '文艺中心：负责人' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: '文艺中心：部员' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: '体育中心：部员' }));
    expect(screen.getByRole('button', { name: '文艺中心：部员' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '体育中心：部员' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('checkbox', { name: /^平台管理员/ }));
    const mediaHeading = screen.getByRole('button', { name: /电子系学生媒体中心/ });
    const captainHeading = screen.getByRole('button', { name: /代表队队长/ });
    expect(mediaHeading.compareDocumentPosition(captainHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    await user.click(captainHeading);
    await user.click(screen.getByRole('checkbox', { name: /^担任代表队队长/ }));
    await user.click(screen.getByRole('checkbox', { name: '男篮代表队' }));
    await user.click(screen.getByRole('button', { name: '保存身份设置' }));

    const save = request.mock.calls.find(
      ([path, init]) => path === '/admin/development-users/u-target' && init?.method === 'PUT',
    );
    const body = JSON.parse(String(save?.[1]?.body));
    expect(body.roles).toEqual(
      expect.arrayContaining([
        'department.arts_member',
        'department.sports_member',
        'platform.admin',
      ]),
    );
    expect(body.roles).not.toContain('domain.arts_lead');
    expect(body.captainTeamIds).toEqual(['team-basketball']);
  });

  it('shows a clear compact identity summary in the directory', async () => {
    const request = vi.fn((path: string) => {
      if (path === '/admin/development-users')
        return Promise.resolve([
          {
            ...person,
            roles: ['student_union.executive_president', 'media_center.creative.member'],
          },
        ]);
      if (path === '/sports/teams') return Promise.resolve([]);
      throw new Error(`Unexpected request ${path}`);
    });
    render(<DevelopmentUsersSection client={{ request: request as ApiClient['request'] }} />);

    const row = await screen.findByRole('button', { name: /Target/ });
    expect(within(row).getByText(/执行主席/)).toBeInTheDocument();
    expect(within(row).getByText(/创意设计部部员/)).toBeInTheDocument();
    expect(within(row).getByText('可访问')).toBeInTheDocument();
  });
});
