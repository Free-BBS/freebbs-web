import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { OrganizationsPage } from './OrganizationsPage.js';
import { ORGANIZATION_GALLERY, organizationRegistrationPath } from './catalog.js';

const positionLabels = /部长|部员|主席|书记|组长|组员|顾问|会长|会员|小导|学员|财务负责人|岗位层级/;

function show(organizationKey?: string, departmentKey?: string) {
  return render(
    <MemoryRouter>
      <OrganizationsPage organizationKey={organizationKey} departmentKey={departmentKey} />
    </MemoryRouter>,
  );
}
describe('organization exhibition', () => {
  it('keeps four entrances and shows all sixteen department names inside their organization cards', () => {
    show();
    expect(screen.getByRole('heading', { name: '风采展示' })).toBeInTheDocument();
    expect(screen.getByText('同在电子，亲如一家')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^走进电子系/ })).toHaveLength(4);
    for (const organization of ORGANIZATION_GALLERY) {
      const entrance = screen.getByRole('link', { name: `走进${organization.name}` });
      expect(entrance).toHaveAttribute('href', `/organizations/${organization.key}`);
      expect(within(entrance).queryByRole('link')).not.toBeInTheDocument();
      for (const department of organization.departments) {
        expect(within(entrance).getByText(department.name, { exact: true })).toBeInTheDocument();
      }
    }
    expect(document.querySelector('.organization-gallery')).not.toHaveTextContent(positionLabels);
  });

  it('uses four different sheep scene images with descriptions of their activities', () => {
    show();
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(4);
    expect(new Set(images.map((image) => image.getAttribute('src'))).size).toBe(4);
    for (const activity of [/小羊.*活动/, /小羊.*水墨.*竹/, /小羊.*阅读/, /小羊.*机器人/]) {
      expect(screen.getByRole('img', { name: activity })).toBeInTheDocument();
    }
  });

  it.each(ORGANIZATION_GALLERY)(
    'shows the complete $name department overview without positions',
    (organization) => {
      show(organization.key);
      expect(screen.queryAllByRole('link', { name: /^了解/ })).toHaveLength(
        organization.departments.length,
      );
      for (const department of organization.departments) {
        expect(screen.getByRole('link', { name: `了解${department.name}` })).toHaveAttribute(
          'href',
          `/organizations/${organization.key}/${department.key}`,
        );
      }
      expect(screen.getByRole('link', { name: '查看组织报名' })).toHaveAttribute(
        'href',
        organizationRegistrationPath(organization.organizationIds),
      );
      expect(document.querySelector('.organization-page')).not.toHaveTextContent(positionLabels);
      expect(screen.queryByLabelText('组织分工')).not.toBeInTheDocument();
    },
  );

  it.each(
    ORGANIZATION_GALLERY.flatMap((organization) =>
      organization.departments.map((department) => ({ organization, department })),
    ),
  )(
    'focuses $department.name on its activities and preserves the registration destination',
    ({ organization, department }) => {
      show(organization.key, department.key);
      expect(screen.getByRole('heading', { name: department.name, level: 2 })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: '部门日常' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '查看相关报名' })).toHaveAttribute(
        'href',
        organizationRegistrationPath(department.organizationIds),
      );
      expect(document.querySelector('.organization-page')).not.toHaveTextContent(positionLabels);
      expect(screen.queryByLabelText('部门岗位层级')).not.toBeInTheDocument();
      if (department.sharedActivityScope) {
        expect(
          screen.getByText(`目前展示${organization.name}的报名，具体承办组请查看活动说明。`),
        ).toBeInTheDocument();
      }
    },
  );
  it('clearly explains parent organization activity scope and rejects unknown departments', () => {
    const view = show('youth_league', 'freshman');
    expect(screen.getByText(/目前展示电子系团委的报名/)).toBeInTheDocument();
    view.unmount();
    show('student_union', 'software');
    expect(screen.getByRole('heading', { name: '没有找到这个展区' })).toBeInTheDocument();
  });
  it('respects the existing information module availability', () => {
    render(
      <MemoryRouter>
        <OrganizationsPage enabled={false} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('风采展示暂未开放');
    expect(screen.queryByRole('link', { name: /走进/ })).not.toBeInTheDocument();
  });
});
