import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UserContext } from '@freebbs-development/contracts';
import { describe, expect, it } from 'vitest';
import { SystemSettingsRouteGuard } from './SystemSettingsRouteGuard.js';

const member: UserContext = {
  uid: 'u',
  displayName: '同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};
describe('SystemSettingsRouteGuard', () => {
  it.each([
    null,
    member,
    { ...member, roles: ['platform.super_admin'] },
    { ...member, roles: ['platform.admin'] },
    { ...member, roles: ['platform.admin'], businessAdmin: false },
    { ...member, roles: ['platform.admin'], businessAdmin: true, previewing: true },
  ])('denies %j', (user) => {
    render(
      <MemoryRouter initialEntries={['/system-settings']}>
        <Routes>
          <Route
            path="/system-settings"
            element={
              <SystemSettingsRouteGuard user={user as UserContext | null}>
                设置内容
              </SystemSettingsRouteGuard>
            }
          />
          <Route path="/community" element={<p>广场</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('广场')).toBeInTheDocument();
    expect(screen.queryByText('设置内容')).not.toBeInTheDocument();
  });
  it.each([{ roles: ['platform.admin'] }, { roles: ['platform.admin', 'platform.super_admin'] }])(
    'allows %j',
    ({ roles }) => {
      render(
        <MemoryRouter>
          <SystemSettingsRouteGuard
            user={{ ...member, roles: roles as UserContext['roles'], businessAdmin: true }}
          >
            设置内容
          </SystemSettingsRouteGuard>
        </MemoryRouter>,
      );
      expect(screen.getByText('设置内容')).toBeInTheDocument();
    },
  );
});
