import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../core/api/client.js';
import { OrganizationsPage } from './OrganizationsPage.js';
import { ORGANIZATION_GALLERY, organizationRegistrationPath } from './catalog.js';

const positionLabels = /部长|部员|主席|书记|组长|组员|顾问|会长|会员|小导|学员|财务负责人|岗位层级/;

const request = vi.fn(async (path: string) =>
  path.endsWith('/activities')
    ? { active: [], past: [] }
    : { html: null, canEdit: false, revision: 0 },
);
function show(organizationKey?: string, departmentKey?: string) {
  return render(
    <MemoryRouter>
      <OrganizationsPage
        organizationKey={organizationKey}
        departmentKey={departmentKey}
        client={{ request: request as ApiClient['request'] }}
      />
    </MemoryRouter>,
  );
}
describe('organization exhibition', () => {
  it('keeps five entrances and shows all nineteen department names inside their organization cards', () => {
    show();
    expect(screen.getByRole('heading', { name: '风采展示' })).toBeInTheDocument();
    expect(screen.getByText('同在电子，亲如一家')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^走进电子系/ })).toHaveLength(5);
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

  it('uses five different sheep scene images with descriptions of their activities', () => {
    show();
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(5);
    expect(new Set(images.map((image) => image.getAttribute('src'))).size).toBe(5);
    for (const activity of [
      /小羊.*活动/,
      /小羊.*水墨.*竹/,
      /小羊.*阅读/,
      /小羊.*机器人/,
      /媒中小羊.*拍摄/,
    ]) {
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
      expect(
        screen.getByRole('link', {
          name: organization.organizationIds.length ? '查看组织报名' : '查看活动报名',
        }),
      ).toHaveAttribute('href', organizationRegistrationPath(organization.organizationIds));
      expect(document.querySelector('.organization-page')).not.toHaveTextContent(positionLabels);
      expect(screen.queryByLabelText('组织分工')).not.toBeInTheDocument();
    },
  );

  it.each(
    ORGANIZATION_GALLERY.flatMap((organization) =>
      organization.departments.map((department) => ({ organization, department })),
    ),
  )(
    'loads only $department.name associations without guessing from its parent',
    async ({ organization, department }) => {
      show(organization.key, department.key);
      expect(screen.getByRole('heading', { name: department.name, level: 2 })).toBeInTheDocument();
      expect(await screen.findByText('暂无活跃活动')).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith(
        `/organizations/${organization.key}/${department.key}/activities`,
      );
      expect(screen.queryByRole('link', { name: '查看相关报名' })).not.toBeInTheDocument();
      expect(document.querySelector('.organization-page')).not.toHaveTextContent(positionLabels);
    },
  );
  it('retains the honest all-activity media root link but uses exact media department associations', async () => {
    const view = show('media_center');
    expect(screen.getByRole('link', { name: '查看活动报名' })).toHaveAttribute(
      'href',
      '/collections/registrations',
    );
    expect(
      screen.getByText('目前展示全部活动报名，媒体中心相关活动请查看活动说明。'),
    ).toBeInTheDocument();
    view.unmount();
    show('media_center', 'creative');
    expect(await screen.findByText('暂无活跃活动')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看活动报名' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('目前展示全部活动报名，媒体中心相关活动请查看活动说明。'),
    ).not.toBeInTheDocument();
  });
  it('loads TMS root from its server position department', async () => {
    show('tms');
    await screen.findByText('暂无活跃活动');
    expect(request).toHaveBeenCalledWith('/organizations/tms/position/home');
    expect(request).toHaveBeenCalledWith('/organizations/tms/position/activities');
  });
  it('rejects unknown departments', () => {
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
