import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { PresentationUser } from '../core/permissions/Can.js';
import { ManagementNavigation } from './ManagementNavigation.js';

const user: PresentationUser = {
  uid: 'manager',
  displayName: '管理员',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};
function show(actor: PresentationUser, path = '/system-settings') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ManagementNavigation user={actor} />
    </MemoryRouter>,
  );
}
describe('management navigation', () => {
  it('keeps ordinary users out of both administrative views', () => {
    show(user);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
  it('shows only organization management for a business administrator', () => {
    show({ ...user, roles: ['platform.admin'], businessAdmin: true });
    const navigation = screen.getByRole('navigation', { name: '管理员端导航' });
    expect(within(navigation).getByRole('link', { name: '人员与组织' })).toHaveAttribute(
      'href',
      '/system-settings',
    );
    expect(screen.queryByRole('link', { name: '负责人任命' })).not.toBeInTheDocument();
  });
  it('preserves the appointments view for a qualified development lead', () => {
    show(
      {
        ...user,
        roles: ['platform.super_admin'],
        developmentAccess: 'lead',
        viewer: { uid: user.uid, displayName: user.displayName, canManageDevelopment: true },
      },
      '/admin',
    );
    expect(screen.getByRole('link', { name: '负责人任命' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('link', { name: '人员与组织' })).not.toBeInTheDocument();
  });
  it('allows switching between existing management capabilities when both are held', () => {
    show({
      ...user,
      roles: ['platform.admin', 'platform.super_admin'],
      businessAdmin: true,
      developmentAccess: 'lead',
      viewer: { uid: user.uid, displayName: user.displayName, canManageDevelopment: true },
    });
    expect(screen.getByRole('link', { name: '人员与组织' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: '负责人任命' })).toHaveAttribute('href', '/admin');
  });
});
