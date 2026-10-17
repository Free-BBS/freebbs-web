import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ORGANIZATION_GALLERY, type OrganizationExhibit } from './catalog.js';
import { OrganizationBreadcrumb } from './OrganizationBreadcrumb.js';

function renderBreadcrumb({
  organization,
  departmentLabel,
  compact,
}: {
  organization?: OrganizationExhibit;
  departmentLabel?: string;
  compact?: boolean;
} = {}) {
  render(
    <MemoryRouter>
      <OrganizationBreadcrumb
        organization={organization}
        departmentLabel={departmentLabel}
        compact={compact}
      />
    </MemoryRouter>,
  );
  return screen.getByRole('navigation', { name: '展厅位置' });
}

describe('organization location breadcrumb', () => {
  it('marks the exhibition index as the current page without a link to itself', () => {
    const trail = renderBreadcrumb();
    expect(within(trail).getByText('风采展示')).toHaveAttribute('aria-current', 'page');
    expect(within(trail).queryByRole('link')).not.toBeInTheDocument();
    expect(trail.textContent).toBe('风采展示');
  });

  it.each(ORGANIZATION_GALLERY.map((organization) => [organization.name, organization] as const))(
    'gives %s its full name and one working parent link',
    (_name, organization) => {
      const trail = renderBreadcrumb({ organization });
      const links = within(trail).getAllByRole('link');
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAccessibleName('风采展示');
      expect(links[0]).toHaveAttribute('href', '/organizations');
      const current = within(trail).getByText(organization.name);
      expect(current).toHaveAttribute('aria-current', 'page');
      expect(current.closest('a')).toBeNull();
      expect(trail.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    },
  );

  const departments = ORGANIZATION_GALLERY.flatMap((organization) =>
    organization.departments.map(
      (department) =>
        [`${organization.name} / ${department.name}`, organization, department.name] as const,
    ),
  );

  it.each(departments)(
    'matches the labels and parent destinations for %s',
    (_name, organization, departmentLabel) => {
      const trail = renderBreadcrumb({ organization, departmentLabel, compact: true });
      expect(within(trail).getAllByRole('link')).toHaveLength(2);
      expect(within(trail).getByRole('link', { name: '风采展示' })).toHaveAttribute(
        'href',
        '/organizations',
      );
      expect(within(trail).getByRole('link', { name: organization.name })).toHaveAttribute(
        'href',
        `/organizations/${organization.key}`,
      );
      const current = within(trail).getByText(departmentLabel);
      expect(current).toHaveAttribute('aria-current', 'page');
      expect(current.closest('a')).toBeNull();
      expect(trail.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    },
  );

  it.each([false, true])('keeps the full organization label when compact is %s', (compact) => {
    const organization = ORGANIZATION_GALLERY.find(({ key }) => key === 'student_union')!;
    const trail = renderBreadcrumb({ organization, compact });
    expect(within(trail).getByText('电子系学生会')).toHaveAttribute('aria-current', 'page');
    expect(within(trail).queryByText('学生会', { exact: true })).not.toBeInTheDocument();
  });

  it('does not add a duplicate department level for the direct TMS page', () => {
    const organization = ORGANIZATION_GALLERY.find(({ key }) => key === 'tms')!;
    const trail = renderBreadcrumb({
      organization,
      departmentLabel: '电子系 TMS 分会',
      compact: true,
    });
    expect(within(trail).getAllByRole('link')).toHaveLength(1);
    expect(within(trail).getByText(organization.name)).toHaveAttribute('aria-current', 'page');
    expect(within(trail).getAllByText('电子系 TMS 分会')).toHaveLength(1);
    expect(trail.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });
});
