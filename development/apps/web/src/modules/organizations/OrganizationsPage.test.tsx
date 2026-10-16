import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../core/api/client.js';
import { OrganizationsPage } from './OrganizationsPage.js';
import { ORGANIZATION_GALLERY, organizationRegistrationPath } from './catalog.js';
import { findShowcase } from './showcase/registry.js';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function show(organizationKey?: string, departmentKey?: string, enabled = true) {
  const request = vi.fn(async (path: string) =>
    path.endsWith('/activities')
      ? { active: [], past: [] }
      : { html: null, canEdit: false, revision: 0 },
  );
  return {
    request,
    ...render(
      <MemoryRouter>
        <OrganizationsPage
          organizationKey={organizationKey}
          departmentKey={departmentKey}
          enabled={enabled}
          client={{ request: request as ApiClient['request'] }}
        />
      </MemoryRouter>,
    ),
  };
}

describe('organization exhibition', () => {
  it('keeps five organization entrances and makes every department directly discoverable', () => {
    const { request } = show();
    expect(screen.getByRole('heading', { name: /^风采展示/ })).toBeInTheDocument();
    expect(screen.getByText('同在电子，亲如一家')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^走进电子系/ })).toHaveLength(5);
    for (const organization of ORGANIZATION_GALLERY) {
      const entrance = screen.getByRole('link', { name: `走进${organization.name}` });
      expect(entrance).toHaveAttribute('href', `/organizations/${organization.key}`);
      expect(entrance).toHaveAccessibleDescription(expect.stringContaining(organization.motto));
      expect(within(entrance).queryByRole('link')).not.toBeInTheDocument();
      for (const department of organization.departments) {
        expect(within(entrance).getByText(department.name, { exact: true })).toBeInTheDocument();
        const content = findShowcase(`${organization.key}.${department.key}`);
        expect(
          screen.getByRole('link', {
            name: `了解${content?.shortName ?? content?.name ?? department.name}`,
          }),
        ).toHaveAttribute('href', `/organizations/${organization.key}/${department.key}`);
        expect(
          screen.getByRole('link', {
            name: `了解${content?.shortName ?? content?.name ?? department.name}`,
          }),
        ).toHaveAccessibleDescription(content?.summary ?? department.introduction);
      }
    }
    expect(screen.getByRole('link', { name: '了解电子系 TMS 分会' })).toHaveAttribute(
      'href',
      '/organizations/tms',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('gives each of the five organization entrances its own descriptive sheep scene', () => {
    show();
    const scenes = ORGANIZATION_GALLERY.map((organization) =>
      within(screen.getByRole('link', { name: `走进${organization.name}` })).getByRole('img'),
    );
    expect(new Set(scenes.map((image) => image.getAttribute('src'))).size).toBe(5);
    for (const scene of scenes) expect(scene).toHaveAccessibleName(/小羊/);
    expect(document.querySelector('.organization-gallery')).not.toHaveTextContent(
      /财务负责人|岗位层级/,
    );
  });

  it('searches interests, combines organization filters, and clears search without dropping the chosen organization', () => {
    show();
    const filters = screen.getByRole('group', { name: '按组织筛选' });
    const search = screen.getByRole('searchbox', { name: '搜索部门、活动或兴趣' });
    fireEvent.change(search, { target: { value: '采访' } });
    expect(screen.getByRole('status')).toHaveTextContent('找到 1 个去处');
    expect(screen.getByRole('link', { name: '了解新媒体部暨记者团' })).toBeInTheDocument();
    fireEvent.click(within(filters).getByRole('button', { name: '媒体中心' }));
    expect(within(filters).getByRole('button', { name: '媒体中心' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('status')).toHaveTextContent('找到 1 个去处');
    fireEvent.click(within(filters).getByRole('button', { name: '科协' }));
    expect(screen.getByRole('status')).toHaveTextContent('找到 0 个去处');
    expect(screen.getByRole('heading', { name: '小羊还没找到这一站' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^了解/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
    expect(search).toHaveValue('');
    expect(within(filters).getByRole('button', { name: '科协' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByRole('link', { name: /^了解/ })).toHaveLength(5);
    expect(screen.getByRole('status')).toHaveTextContent('找到 5 个去处');
  });

  it('resets both filters from the empty result state and ignores surrounding search whitespace', () => {
    show();
    const search = screen.getByRole('searchbox', { name: '搜索部门、活动或兴趣' });
    fireEvent.change(search, { target: { value: '  采访  ' } });
    expect(screen.getByRole('status')).toHaveTextContent('找到 1 个去处');
    fireEvent.click(screen.getByRole('button', { name: '学生会' }));
    fireEvent.click(screen.getByRole('button', { name: '看看全部' }));
    expect(search).toHaveValue('');
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('link', { name: /^了解/ })).toHaveLength(
      ORGANIZATION_GALLERY.reduce(
        (total, organization) => total + Math.max(organization.departments.length, 1),
        0,
      ),
    );
  });

  it('finds interests and works mentioned inside exhibition chapters rather than only basic department labels', () => {
    show();
    const search = screen.getByRole('searchbox', { name: '搜索部门、活动或兴趣' });
    fireEvent.change(search, { target: { value: 'LaTeX' } });
    expect(screen.getByRole('status')).toHaveTextContent('找到 1 个去处');
    expect(screen.getByRole('link', { name: '了解办公室·新生组' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '每一个飞驰的瞬间' } });
    expect(screen.getByRole('status')).toHaveTextContent('找到 1 个去处');
    expect(screen.getByRole('link', { name: '了解新媒体部暨记者团' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'docx' } });
    expect(screen.getByRole('status')).toHaveTextContent('找到 0 个去处');
  });

  it('returns to the top when entering another organization or department in the same mounted page', () => {
    const { rerender, request } = show();
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    rerender(
      <MemoryRouter>
        <OrganizationsPage
          organizationKey="youth_league"
          client={{ request: request as ApiClient['request'] }}
        />
      </MemoryRouter>,
    );
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    rerender(
      <MemoryRouter>
        <OrganizationsPage
          organizationKey="youth_league"
          departmentKey="research"
          client={{ request: request as ApiClient['request'] }}
        />
      </MemoryRouter>,
    );
    expect(window.scrollTo).toHaveBeenCalledTimes(3);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(screen.getByRole('heading', { name: '调研组', level: 2 })).toBeInTheDocument();
  });

  it('honors an initial department fragment instead of resetting a deep link to the entrance', async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    const scrolledIds: string[] = [];
    const scrollIntoView = vi.fn(function (this: HTMLElement) {
      scrolledIds.push(this.id);
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
    const request = vi.fn(async (path: string) =>
      path.endsWith('/activities')
        ? { active: [], past: [] }
        : { html: null, canEdit: false, revision: 0 },
    );
    const view = render(
      <MemoryRouter initialEntries={['/organizations/youth_league/freshman#showcase-contact']}>
        <OrganizationsPage
          organizationKey="youth_league"
          departmentKey="freshman"
          client={{ request: request as ApiClient['request'] }}
        />
      </MemoryRouter>,
    );
    try {
      await screen.findByText('暂无活跃活动');
      expect(scrolledIds).toEqual(['showcase-contact']);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
      expect(window.scrollTo).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

  it.each(ORGANIZATION_GALLERY.filter(({ key }) => key !== 'tms'))(
    'shows every $name department and retains its explicit root activity destination',
    (organization) => {
      const { request } = show(organization.key);
      expect(screen.getAllByRole('link', { name: /^了解/ })).toHaveLength(
        organization.departments.length,
      );
      for (const department of organization.departments) {
        const content = findShowcase(`${organization.key}.${department.key}`);
        expect(
          screen.getByRole('link', { name: `了解${content?.shortName ?? department.name}` }),
        ).toHaveAttribute('href', `/organizations/${organization.key}/${department.key}`);
        expect(
          screen.getByRole('link', { name: `了解${content?.shortName ?? department.name}` }),
        ).toHaveAccessibleDescription(content?.summary ?? department.introduction);
      }
      expect(screen.getByRole('link', { name: /^查看相关活动/ })).toHaveAttribute(
        'href',
        organizationRegistrationPath(organization.organizationIds),
      );
      expect(screen.queryByLabelText('组织分工')).not.toBeInTheDocument();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each(
    ORGANIZATION_GALLERY.flatMap((organization) =>
      organization.departments
        .filter(({ key }) => key !== 'research')
        .map((department) => ({ organization, department })),
    ),
  )(
    'loads only $organization.key/$department.key associations without guessing from its parent',
    async ({ organization, department }) => {
      const { request } = show(organization.key, department.key);
      await screen.findByText('暂无活跃活动');
      expect(request.mock.calls.map(([path]) => path).sort()).toEqual([
        `/organizations/${organization.key}/${department.key}/activities`,
        `/organizations/${organization.key}/${department.key}/home`,
      ]);
      expect(screen.queryByRole('link', { name: '查看相关报名' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: '查看活动报名' })).not.toBeInTheDocument();
      expect(
        screen.queryByText('目前展示全部活动报名，媒体中心相关活动请查看活动说明。'),
      ).not.toBeInTheDocument();
      const content = findShowcase(`${organization.key}.${department.key}`);
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: content?.shortName ?? content?.name ?? department.name,
        }),
      ).toBeInTheDocument();
    },
  );

  it('retains the honest unscoped media root activity link', () => {
    show('media_center');
    expect(screen.getByRole('link', { name: /^查看相关活动/ })).toHaveAttribute(
      'href',
      '/collections/registrations',
    );
    expect(
      screen.getByText('目前展示全部活动报名，媒体中心相关活动请查看活动说明。'),
    ).toBeInTheDocument();
  });

  it('loads TMS root from its exact server position department', async () => {
    const { request } = show('tms');
    await screen.findByText('暂无活跃活动');
    expect(request.mock.calls.map(([path]) => path).sort()).toEqual([
      '/organizations/tms/position/activities',
      '/organizations/tms/position/home',
    ]);
    expect(screen.getByRole('link', { name: /^查看相关活动/ })).toHaveAttribute(
      'href',
      '/collections/registrations?organization=tms',
    );
  });

  it('opens research as an independent read-only exhibition without practice APIs or editing actions', () => {
    const { request } = show('youth_league', 'research');
    expect(screen.getByRole('heading', { name: '调研组', level: 2 })).toBeInTheDocument();
    expect(screen.getByTitle('调研组特色展区')).toHaveAttribute(
      'src',
      '/development/organization-showcase/sites/research/index.html',
    );
    expect(screen.queryByLabelText('选择 HTML 文件')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '相关活动' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '撰写部门文章' })).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['student_union', 'software'],
    ['unknown', undefined],
    ['youth_league', 'missing'],
  ])(
    'rejects unknown organization or department %s/%s without requesting data',
    (organization, department) => {
      const { request } = show(organization, department);
      expect(screen.getByRole('heading', { name: '没有找到这个展区' })).toBeInTheDocument();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('respects the existing module availability boundary before rendering or requesting data', () => {
    const { request } = show('student_union', 'sports_center', false);
    expect(screen.getByRole('status')).toHaveTextContent('风采展示暂未开放');
    expect(screen.queryByRole('link', { name: /走进|了解/ })).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
});
