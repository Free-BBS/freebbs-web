import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { findOrganization } from './catalog.js';
import { OrganizationDepartmentViewport } from './OrganizationDepartmentViewport.js';

describe('department reading viewport', () => {
  it('keeps the department trail outside the native content and its footer scroll region', () => {
    render(
      <MemoryRouter initialEntries={['/organizations/youth_league/freshman']}>
        <OrganizationDepartmentViewport
          organization={findOrganization('youth_league')!}
          departmentLabel="办公室·新生组"
        >
          <section id="showcase-contact">新生组联系人</section>
          <footer>平台页脚</footer>
        </OrganizationDepartmentViewport>
      </MemoryRouter>,
    );
    const trail = screen.getByRole('navigation', { name: '展厅位置' });
    const reading = screen.getByRole('region', { name: '办公室·新生组页面内容' });
    expect(trail).toHaveClass('organization-breadcrumb--compact');
    expect(reading).toHaveAttribute('tabindex', '0');
    expect(reading).not.toContainElement(trail);
    expect(reading).toContainElement(screen.getByText('新生组联系人'));
    expect(reading).toContainElement(screen.getByRole('contentinfo'));
    expect(within(trail).getByRole('link', { name: '风采展示' })).toHaveAttribute(
      'href',
      '/organizations',
    );
    expect(within(trail).getByRole('link', { name: '电子系团委' })).toHaveAttribute(
      'href',
      '/organizations/youth_league',
    );
    expect(within(trail).getByText('办公室·新生组')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: /返回上一级/ })).not.toBeInTheDocument();
  });

  it('lets a full HTML document own the reading surface beneath the shared trail', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/organizations/media_center/creative']}>
        <OrganizationDepartmentViewport
          organization={findOrganization('media_center')!}
          departmentLabel="创意设计部"
          fullPage
        >
          <iframe title="创意设计部 HTML" />
        </OrganizationDepartmentViewport>
      </MemoryRouter>,
    );
    const viewport = container.querySelector('.organization-department-viewport');
    const trail = screen.getByRole('navigation', { name: '展厅位置' });
    const frame = screen.getByTitle('创意设计部 HTML');
    expect(viewport).toHaveClass('organization-department-viewport--html');
    expect(trail.parentElement).toBe(viewport);
    expect(frame.parentElement).toBe(viewport);
    expect(screen.queryByRole('region', { name: /页面内容$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /返回上一级/ })).not.toBeInTheDocument();
    expect(within(trail).getByRole('link', { name: '电子系学生媒体中心' })).toHaveAttribute(
      'href',
      '/organizations/media_center',
    );
  });

  it('gives TMS one current level with an exit to the exhibition index', () => {
    render(
      <MemoryRouter initialEntries={['/organizations/tms']}>
        <OrganizationDepartmentViewport
          organization={findOrganization('tms')!}
          departmentLabel="电子系 TMS 分会"
        >
          <p>TMS 组织介绍</p>
        </OrganizationDepartmentViewport>
      </MemoryRouter>,
    );
    const trail = screen.getByRole('navigation', { name: '展厅位置' });
    const links = within(trail).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/organizations');
    expect(within(trail).getByText('TMS')).toHaveAttribute('aria-current', 'page');
    expect(trail).not.toHaveTextContent('TMS /');
  });
});
