import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigationType } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { PresentationUser } from './Can.js';
import { SuperAdminRouteGuard } from './SuperAdminRouteGuard.js';

const policyOnlyUser: PresentationUser = {
  uid: 'policy-admin',
  displayName: '权限管理员',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
  policies: [{ action: 'admin.manage', effect: 'allow' }],
};

function DashboardMarker() {
  const navigationType = useNavigationType();
  return (
    <>
      <p>dashboard content</p>
      <p data-testid="navigation-type">{navigationType}</p>
    </>
  );
}

function renderGuard(user: PresentationUser) {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route
          path="/admin"
          element={
            <SuperAdminRouteGuard user={user}>
              <p>governance content</p>
            </SuperAdminRouteGuard>
          }
        />
        <Route path="/dashboard" element={<DashboardMarker />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SuperAdminRouteGuard', () => {
  it('redirects a policy-only administrator to the dashboard with replacement', () => {
    renderGuard(policyOnlyUser);

    expect(screen.getByText('dashboard content')).toBeInTheDocument();
    expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');
    expect(screen.queryByText('governance content')).not.toBeInTheDocument();
  });

  it('renders governance for a platform super administrator', () => {
    renderGuard({
      ...policyOnlyUser,
      uid: 'super-admin',
      roles: ['platform.super_admin'],
      policies: [],
    });

    expect(screen.getByText('governance content')).toBeInTheDocument();
    expect(screen.queryByText('dashboard content')).not.toBeInTheDocument();
  });
});
