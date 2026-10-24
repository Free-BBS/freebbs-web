import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';

import { ORGANIZATION_GALLERY } from '../modules/organizations/catalog.js';
import { findShowcase } from '../modules/organizations/showcase/registry.js';
import { AppShell } from './AppShell.js';
import { mainSiteHref } from './main-site-api.js';
import { loadModuleStates } from './router.js';

const { mockRequest, mockUseAuth } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockUseAuth: vi.fn(),
}));

vi.mock('../core/auth/AuthProvider.js', () => ({
  useAuth: mockUseAuth,
}));

vi.mock('../core/api/client.js', () => ({
  createApiClient: () => ({ request: mockRequest }),
}));

vi.mock('../core/auth/DemoUserSwitcher.js', () => ({
  DemoUserSwitcher: () => <div data-testid="demo-user-switcher">演示身份切换</div>,
}));

const user: UserContext = {
  uid: 'student-1',
  displayName: '林同学',
  avatarUrl: '/avatars/student-1.png',
  baseRole: 'student',
  roles: [],
  tags: [],
};
const pendingClient = { request: vi.fn(() => new Promise(() => undefined)) };
function financeAccessClient(request: (path: string) => unknown) {
  return {
    request: (path: string) =>
      path === '/finance/tracking/access' ? request(path) : new Promise(() => undefined),
  };
}

function authenticatedAuth(overrides: Record<string, unknown> = {}) {
  return {
    status: 'authenticated',
    user,
    error: null,
    reload: vi.fn(),
    authMode: 'main',
    demoUser: 'demo-student',
    setDemoUser: vi.fn(),
    loginUrl: '/login?next=%2Fdevelopment%2Fdashboard',
    client: pendingClient,
    ...overrides,
  };
}

function renderShell(route = '/knowledge', props: React.ComponentProps<typeof AppShell> = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppShell {...props} />
    </MemoryRouter>,
  );
}

describe('module state loader', () => {
  it('fails closed when the module registry cannot be loaded', async () => {
    mockRequest.mockRejectedValueOnce(new Error('registry unavailable'));
    const states = await loadModuleStates();
    expect(Object.keys(states)).toHaveLength(11);
    expect(Object.values(states)).toEqual(Array(11).fill('disabled'));
  });
});

describe('AppShell', () => {
  it('shows financial navigation from explicit access even without legacy finance permissions', async () => {
    const request = vi.fn().mockResolvedValue({
      configured: true,
      canAccess: true,
      canManageBudget: false,
    });
    mockUseAuth.mockReturnValue(authenticatedAuth({ client: financeAccessClient(request) }));
    renderShell('/finance/budget');
    const navigation = screen.getByRole('navigation', { name: '主要导航' });
    const finance = await within(navigation).findByRole('link', { name: '财务治理' });
    expect(finance).toHaveAttribute('href', '/finance');
    expect(finance).toHaveAttribute('aria-current', 'page');
    expect(request).toHaveBeenCalledWith('/finance/tracking/access');
    expect(
      within(screen.getByRole('navigation', { name: '移动导航' })).getByRole('link', {
        name: '财务治理',
      }),
    ).toBeInTheDocument();
  });

  it('does not infer financial access from global administrator or legacy finance permissions', async () => {
    const request = vi.fn().mockResolvedValue({
      configured: true,
      canAccess: false,
      canManageBudget: false,
    });
    mockUseAuth.mockReturnValue(
      authenticatedAuth({
        client: financeAccessClient(request),
        user: {
          ...user,
          roles: ['platform.admin'],
          businessAdmin: true,
          policies: [{ action: 'finance.record.read', effect: 'allow' }],
        },
      }),
    );
    renderShell();
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(screen.queryByRole('link', { name: '财务治理' })).not.toBeInTheDocument();
  });

  it.each([{ configured: false, canAccess: true, canManageBudget: true }, undefined])(
    'keeps finance hidden when access is unconfigured or unavailable (%s)',
    async (access) => {
      const request = vi.fn().mockResolvedValue(access);
      mockUseAuth.mockReturnValue(authenticatedAuth({ client: financeAccessClient(request) }));
      renderShell();
      await waitFor(() => expect(request).toHaveBeenCalledOnce());
      expect(screen.queryByRole('link', { name: '财务治理' })).not.toBeInTheDocument();
    },
  );

  it('keeps finance hidden during identity preview without fetching financial access', () => {
    const request = vi.fn();
    mockUseAuth.mockReturnValue(
      authenticatedAuth({
        client: financeAccessClient(request),
        user: { ...user, previewing: true, businessAdmin: true },
      }),
    );
    renderShell('/finance/claims');
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: '财务治理' })).not.toBeInTheDocument();
  });

  it('does not fetch access or show finance when its module is disabled', () => {
    const request = vi.fn();
    mockUseAuth.mockReturnValue(authenticatedAuth({ client: financeAccessClient(request) }));
    renderShell('/finance/budget', { moduleStates: { finance: 'disabled' } });
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: '财务治理' })).not.toBeInTheDocument();
  });

  it('clears financial visibility immediately when the authenticated identity changes', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ configured: true, canAccess: true, canManageBudget: false })
      .mockImplementationOnce(() => new Promise(() => undefined));
    const client = financeAccessClient(request);
    mockUseAuth.mockReturnValue(authenticatedAuth({ client }));
    const view = renderShell('/finance/budget');
    await screen.findAllByRole('link', { name: '财务治理' });
    mockUseAuth.mockReturnValue(authenticatedAuth({ client, user: { ...user, uid: 'student-2' } }));
    view.rerender(
      <MemoryRouter initialEntries={['/finance/budget']}>
        <AppShell />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: '财务治理' })).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('ignores a delayed access response for an identity that has been replaced', async () => {
    let finishFirst: ((access: { configured: boolean; canAccess: boolean }) => void) | undefined;
    const request = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce({ configured: true, canAccess: false, canManageBudget: false });
    const client = financeAccessClient(request);
    mockUseAuth.mockReturnValue(authenticatedAuth({ client }));
    const view = renderShell('/finance/budget');
    mockUseAuth.mockReturnValue(authenticatedAuth({ client, user: { ...user, uid: 'student-2' } }));
    view.rerender(
      <MemoryRouter initialEntries={['/finance/budget']}>
        <AppShell />
      </MemoryRouter>,
    );
    await act(async () => finishFirst?.({ configured: true, canAccess: true }));
    expect(screen.queryByRole('link', { name: '财务治理' })).not.toBeInTheDocument();
  });

  it('keeps identity preview out of the global shell even for a qualified lead', () => {
    mockUseAuth.mockReturnValue(
      authenticatedAuth({
        client: { request: vi.fn().mockResolvedValue([]) },
        user: {
          ...user,
          roles: ['platform.super_admin'],
          developmentAccess: 'lead',
          viewer: {
            uid: user.uid,
            displayName: user.displayName,
            canManageDevelopment: true,
            canPreviewDevelopment: true,
          },
        },
      }),
    );
    renderShell('/community');
    expect(screen.queryByRole('combobox', { name: '预览发展端身份' })).not.toBeInTheDocument();
    expect(screen.queryByText('只读身份预览')).not.toBeInTheDocument();
  });
  it('does not infer reserved access from a role when trusted viewer qualification denies it', () => {
    mockUseAuth.mockReturnValue(
      authenticatedAuth({
        authMode: 'demo',
        user: {
          ...user,
          roles: ['platform.super_admin'],
          developmentAccess: 'member',
          viewer: { uid: user.uid, displayName: user.displayName, canManageDevelopment: false },
        },
      }),
    );
    renderShell('/community');
    expect(screen.queryByRole('link', { name: '管理员模块' })).not.toBeInTheDocument();
  });
  it('keeps system settings available when the finance module is disabled', () => {
    mockUseAuth.mockReturnValue(
      authenticatedAuth({ user: { ...user, roles: ['platform.admin'], businessAdmin: true } }),
    );
    renderShell('/system-settings', { moduleStates: { finance: 'disabled' } });
    expect(
      within(screen.getByRole('complementary', { name: '发展平台侧栏' })).getByRole('link', {
        name: '管理员端',
      }),
    ).toBeInTheDocument();
  });
  it('places one effective administrator settings entry at the sidebar bottom and in mobile navigation', () => {
    mockUseAuth.mockReturnValue(
      authenticatedAuth({ user: { ...user, roles: ['platform.admin'], businessAdmin: true } }),
    );
    renderShell('/system-settings');
    const navigation = screen.getByRole('navigation', { name: '主要导航' });
    expect(within(navigation).queryByRole('link', { name: '管理员端' })).not.toBeInTheDocument();
    const sidebar = screen.getByRole('complementary', { name: '发展平台侧栏' });
    const settings = within(sidebar).getByRole('link', { name: '管理员端' });
    expect(settings.parentElement).toHaveClass('sidebar-footer');
    expect(settings.nextElementSibling).toHaveAccessibleName('学习端');
    expect(settings).toHaveAttribute('href', '/system-settings');
    expect(settings).toHaveAttribute('aria-current', 'page');
    const mobile = screen.getByRole('navigation', { name: '移动导航' });
    expect(within(mobile).getAllByRole('link', { name: '管理员端' })).toHaveLength(1);
    expect(within(sidebar).getAllByRole('link', { name: '管理员端' })).toHaveLength(1);
    expect(within(mobile).getAllByRole('link').at(-2)).toHaveAccessibleName('管理员端');
    expect(screen.queryByRole('link', { name: '管理员模块' })).not.toBeInTheDocument();
  });

  it('keeps one management entry for both qualifications and defaults it to organization settings', () => {
    mockUseAuth.mockReturnValue(
      authenticatedAuth({
        user: {
          ...user,
          roles: ['platform.admin', 'platform.super_admin'],
          businessAdmin: true,
          developmentAccess: 'lead',
          viewer: { uid: user.uid, displayName: user.displayName, canManageDevelopment: true },
        },
      }),
    );
    renderShell('/admin');
    for (const container of [
      screen.getByRole('complementary', { name: '发展平台侧栏' }),
      screen.getByRole('navigation', { name: '移动导航' }),
    ]) {
      const links = within(container).getAllByRole('link', { name: '管理员端' });
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute('href', '/system-settings');
      expect(links[0]).toHaveAttribute('aria-current', 'page');
    }
    expect(screen.queryByRole('link', { name: '管理员模块' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '系统设置' })).not.toBeInTheDocument();
  });

  it('does not show administrative navigation to ordinary students', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    renderShell('/community');
    expect(screen.queryByRole('link', { name: '管理员端' })).not.toBeInTheDocument();
  });

  it.each([false, undefined])(
    'hides settings for a role without effective global authority (%s)',
    (businessAdmin) => {
      mockUseAuth.mockReturnValue(
        authenticatedAuth({ user: { ...user, roles: ['platform.admin'], businessAdmin } }),
      );
      renderShell('/community');
      expect(screen.queryByRole('link', { name: '管理员端' })).not.toBeInTheDocument();
    },
  );

  it('shows target administrator settings during qualified lead preview while hiding the lead module', () => {
    mockUseAuth.mockReturnValue(
      authenticatedAuth({
        setPreviewUser: vi.fn(),
        user: {
          ...user,
          roles: ['platform.admin', 'platform.super_admin'],
          businessAdmin: true,
          previewing: true,
          viewer: { canManageDevelopment: true, canPreviewDevelopment: true },
          developmentAccess: 'lead',
        },
      }),
    );
    renderShell('/community');
    expect(screen.getAllByRole('link', { name: '管理员端' })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: '管理员模块' })).not.toBeInTheDocument();
  });

  it('keeps system settings hidden for lead-only identities', () => {
    mockUseAuth.mockReturnValue(
      authenticatedAuth({
        user: {
          ...user,
          roles: ['platform.super_admin'],
          developmentAccess: 'lead',
          viewer: { canManageDevelopment: true },
        },
      }),
    );
    renderShell('/community');
    expect(
      screen.getAllByRole('link', { name: '管理员端' }).map((link) => link.getAttribute('href')),
    ).toEqual(['/admin', '/admin']);
    expect(screen.queryByRole('link', { name: '财务治理' })).not.toBeInTheDocument();
  });
  it.each([
    ['/events', '/collections'],
    ['/events/activity-night-run', '/collections'],
    ['/events/student-festival', '/community'],
  ])('keeps %s inside the visible navigation module %s', (route, target) => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    renderShell(route);
    const navigation = screen.getByRole('navigation', { name: '主要导航' });
    expect(navigation.querySelector('a[aria-current="page"]')).toHaveAttribute('href', target);
  });
  it('places one learning-site footer after main content with the shared support links', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    renderShell('/community', { children: <p>社区内容</p> });
    const footer = screen.getByRole('contentinfo');
    const main = screen.getByRole('main');
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    expect(main.nextElementSibling).toBe(footer);
    expect(footer).toHaveClass('site-footer', 'site-footer-compact');
    const links = within(footer).getByRole('navigation', { name: '关于平台' });
    expect(within(links).getByRole('link', { name: '关于 FREE BBS' })).toHaveAttribute(
      'href',
      mainSiteHref('/about'),
    );
    expect(within(links).getByRole('link', { name: 'FREE BBS 工作人员名单' })).toHaveAttribute(
      'href',
      mainSiteHref('/staff'),
    );
    expect(within(links).getByRole('link', { name: '清华大学电子系' })).toHaveAttribute(
      'href',
      'https://www.ee.tsinghua.edu.cn/',
    );
    expect(within(links).getByRole('link', { name: '清华大学电子系' })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(within(links).getByRole('link', { name: '电子系学生科协' })).toHaveAttribute(
      'href',
      'https://www.eesast.com',
    );
    expect(footer).toHaveTextContent('© 2026-2027 FREE BBS 工作组');
    expect(footer).toHaveTextContent('京ICP备2025155858号-2');
  });
  it('places the learning-site link in the desktop footer and at the end of mobile navigation', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    renderShell('/events');

    const sidebar = screen.getByRole('complementary', { name: '发展平台侧栏' });
    expect(within(sidebar).getByRole('link', { name: '学习端' })).toHaveAttribute('href', '/world');
    expect(
      within(screen.getByRole('navigation', { name: '主要导航' })).queryByRole('link', {
        name: '学习端',
      }),
    ).not.toBeInTheDocument();
    const mobileLinks = within(screen.getByRole('navigation', { name: '移动导航' })).getAllByRole(
      'link',
    );
    expect(mobileLinks.at(-1)).toHaveAttribute('href', '/world');
    expect(mobileLinks.at(-1)).toHaveAccessibleName('学习端');
    expect(document.head.querySelector('link[data-learning-prefetch]')).toHaveAttribute(
      'href',
      '/world',
    );
  });

  it('keeps authentication failures in the app with a retry instead of a construction redirect', () => {
    mockUseAuth.mockReturnValue({
      ...authenticatedAuth(),
      status: 'error',
      user: null,
      error: new Error('Authentication service unavailable'),
    });
    renderShell('/events');
    expect(screen.getByRole('alert')).toHaveTextContent('Authentication service unavailable');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /施工/ })).not.toBeInTheDocument();
  });
  it('uses the new square-first navigation while keeping established development modules', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());

    renderShell('/knowledge');

    const navigation = screen.getByRole('navigation', { name: '主要导航' });
    const items = within(navigation).getAllByTestId('module-navigation-item');

    expect(items.map((item) => item.querySelector('.module-name')?.textContent)).toEqual([
      '無界广场',
      '萬事屋',
      '無体育',
      '無尽书桌',
      '风采展示',
      '个人成长档案',
    ]);
    expect(within(navigation).queryByRole('link', { name: '工作台' })).not.toBeInTheDocument();
    expect(within(navigation).queryByText('财务治理')).not.toBeInTheDocument();
    expect(within(navigation).queryByText('权限与模块管理')).not.toBeInTheDocument();
    expect(within(navigation).queryByText('趣缘群体')).not.toBeInTheDocument();
    expect(within(navigation).queryByText('無限机会')).not.toBeInTheDocument();
    expect(within(navigation).queryByText('無活动')).not.toBeInTheDocument();
    expect(within(navigation).getByRole('link', { name: '个人成长档案' })).toHaveAttribute(
      'href',
      '/growth',
    );
    expect(within(navigation).getByRole('link', { name: '無尽书桌' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(navigation).getByRole('link', { name: '风采展示' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: 'FREE BBS' })).toHaveAttribute('href', '/community');
    expect(screen.getByRole('img', { name: 'FREE BBS' })).toHaveAttribute(
      'src',
      expect.stringContaining('freebbs-emblem-v2.png'),
    );
    expect(screen.getByRole('link', { name: 'FREE BBS' })).toHaveTextContent('FREE-BBS');
    expect(screen.queryByText('发展平台')).not.toBeInTheDocument();
  });

  it('keeps exhibition navigation independent from the desk and respects information availability', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    const view = renderShell('/organizations/student_union/arts_center');
    const navigation = screen.getByRole('navigation', { name: '主要导航' });
    expect(within(navigation).getByRole('link', { name: '风采展示' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(navigation).getByRole('link', { name: '無尽书桌' })).not.toHaveAttribute(
      'aria-current',
    );
    view.unmount();
    renderShell('/organizations', { moduleStates: { information: 'disabled' } });
    expect(
      within(screen.getByRole('navigation', { name: '主要导航' })).queryByRole('link', {
        name: '风采展示',
      }),
    ).not.toBeInTheDocument();
  });

  it('keeps the current mobile navigation item horizontally reachable', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      renderShell('/sports');

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    } finally {
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });

  it('marks the information module active for nested routes', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());

    renderShell('/information/triage');

    const navigation = screen.getByRole('navigation', { name: '主要导航' });
    expect(within(navigation).getByRole('link', { name: '無尽书桌' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('navigation', { name: '移动导航' })).toHaveTextContent('無尽书桌');
  });

  it('does not mark information active for an unrelated route prefix', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());

    renderShell('/information-archive');

    expect(
      within(screen.getByRole('navigation', { name: '主要导航' })).getByRole('link', {
        name: '無尽书桌',
      }),
    ).not.toHaveAttribute('aria-current', 'page');
  });

  it('omits a disabled module from navigation', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());

    renderShell('/dashboard', { moduleStates: { community: 'disabled' } });

    const navigation = screen.getByRole('navigation', { name: '主要导航' });
    expect(within(navigation).queryByRole('link', { name: '無界广场' })).not.toBeInTheDocument();
    expect(within(navigation).queryByText('無界广场')).not.toBeInTheDocument();
  });

  it('offers one desk entry while keeping knowledge out of both sidebar menus', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    renderShell('/desk/knowledge');
    for (const label of ['主要导航', '移动导航']) {
      const navigation = screen.getByRole('navigation', { name: label });
      expect(within(navigation).getAllByRole('link', { name: '無尽书桌' })).toHaveLength(1);
      expect(within(navigation).getByRole('link', { name: '無尽书桌' })).toHaveAttribute(
        'href',
        '/desk',
      );
      expect(within(navigation).getByRole('link', { name: '無尽书桌' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(within(navigation).queryByRole('link', { name: '经验库' })).not.toBeInTheDocument();
    }
  });

  it('does not expose the desk navigation when its information module is disabled', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    renderShell('/desk', { moduleStates: { information: 'disabled' } });
    expect(
      within(screen.getByRole('navigation', { name: '主要导航' })).queryByRole('link', {
        name: '無尽书桌',
      }),
    ).not.toBeInTheDocument();
  });

  it('renders the authenticated user name and avatar', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());

    renderShell();

    expect(screen.getByText('林同学')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '林同学头像' })).toHaveAttribute(
      'src',
      '/avatars/student-1.png',
    );
  });

  it('offers the shared light and dark mode control', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    renderShell();

    const desktopToggle = document.querySelector<HTMLButtonElement>('.main-site-desktop-theme');
    expect(desktopToggle).toHaveAccessibleName('切换到明亮模式');
    expect(desktopToggle).toBeInTheDocument();
    fireEvent.click(desktopToggle!);
    expect(document.body).toHaveClass('theme-light');
    expect(window.localStorage.getItem('free_bbs_theme_mode')).toBe('light');
  });

  it('renders the main-site placeholder avatar without exposing demo identity selection', () => {
    mockUseAuth.mockReturnValue(
      authenticatedAuth({
        authMode: 'demo',
        user: { ...user, displayName: '周同学', avatarUrl: null },
      }),
    );

    renderShell();

    expect(screen.getByRole('img', { name: '周同学头像' })).toHaveAttribute(
      'src',
      expect.stringContaining('avatar_placeholder.webp'),
    );
    expect(screen.queryByTestId('demo-user-switcher')).not.toBeInTheDocument();
    expect(document.querySelector('.demo-preview-toolbar')).not.toBeInTheDocument();
  });

  it.each([
    '/organizations',
    ...ORGANIZATION_GALLERY.map((organization) => `/organizations/${organization.key}`),
    '/organizations/tms',
    '/organizations/tms/position',
    ...ORGANIZATION_GALLERY.flatMap((organization) =>
      organization.departments.map(
        (department) => `/organizations/${organization.key}/${department.key}`,
      ),
    ),
  ])(
    'keeps the exhibition title and corresponding location in the fixed top header for %s',
    (route) => {
      mockUseAuth.mockReturnValue(authenticatedAuth());
      renderShell(route, { children: <iframe title="部门网页" /> });
      expect(document.querySelector('.development-shell-root')).toHaveClass(
        'development-shell-root--full-page',
      );
      expect(screen.getByRole('complementary', { name: '发展平台侧栏' })).toBeInTheDocument();
      const header = document.querySelector<HTMLElement>('.main-site-header')!;
      expect(header).toBeInTheDocument();
      expect(header).toHaveClass('main-site-header--custom-title');
      expect(
        within(header).getByRole('heading', { name: '风采展示', level: 1 }),
      ).toBeInTheDocument();
      expect(within(header).getByRole('link', { name: '风采展示' })).toHaveAttribute(
        'href',
        '/organizations',
      );
      const [, , organizationKey, departmentKey] = route.split('/');
      const organization = ORGANIZATION_GALLERY.find(({ key }) => key === organizationKey);
      if (organization) {
        const trail = within(header).getByRole('navigation', { name: '展厅位置' });
        expect(header.querySelector('.main-site-header-title-slot')).toContainElement(trail);
        const department =
          organization.key !== 'tms' && departmentKey
            ? organization.departments.find(({ key }) => key === departmentKey)
            : undefined;
        const content = department
          ? findShowcase(`${organization.key}.${departmentKey}`)
          : undefined;
        expect(
          within(trail).getByText(
            content?.shortName ?? content?.name ?? department?.name ?? organization.name,
          ),
        ).toHaveAttribute('aria-current', 'page');
        expect(within(trail).queryByRole('link', { name: '风采展示' })).not.toBeInTheDocument();
        if (department) {
          expect(within(trail).getByRole('link', { name: organization.name })).toHaveAttribute(
            'href',
            `/organizations/${organization.key}`,
          );
          expect(within(trail).getAllByRole('link')).toHaveLength(1);
        } else {
          expect(within(trail).queryByRole('link')).not.toBeInTheDocument();
        }
      }
      expect(screen.queryByRole('link', { name: '返回上一级' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '返回上一级' })).not.toBeInTheDocument();
      expect(document.querySelector('.main-site-back')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: '打开我的个人主页' })).toHaveAttribute(
        'href',
        '/profile',
      );
      expect(document.querySelector('.main-site-mobile-theme')).toBeInTheDocument();
      expect(screen.getByTitle('部门网页')).toBeInTheDocument();
      expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    },
  );

  it.each([
    '/organizations/unknown',
    '/organizations/youth_league/unknown',
    '/organizations/media_center/creative/edit',
  ])('retains the normal shell outside department showcase routes: %s', (route) => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    renderShell(route);
    expect(document.querySelector('.development-shell-root')).not.toHaveClass(
      'development-shell-root--full-page',
    );
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(document.querySelector('.main-site-header-title-slot')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '展厅位置' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '返回上一级' })).not.toBeInTheDocument();
  });

  it('shows a safe main-site login action for an unauthenticated user', () => {
    mockUseAuth.mockReturnValue({
      ...authenticatedAuth(),
      status: 'unauthenticated',
      user: null,
      loginUrl: '/login?next=%2Fdevelopment%2Fknowledge',
    });

    renderShell('/knowledge');

    expect(screen.getByRole('link', { name: '登录主站' })).toHaveAttribute(
      'href',
      '/login?next=%2Fdevelopment%2Fknowledge',
    );
  });

  it('renders recoverable loading and error states', () => {
    mockUseAuth.mockReturnValue({
      ...authenticatedAuth(),
      status: 'loading',
      user: null,
    });
    const { rerender } = renderShell();
    expect(screen.getByText('正在加载身份信息…')).toBeInTheDocument();

    const reload = vi.fn();
    mockUseAuth.mockReturnValue({
      ...authenticatedAuth(),
      status: 'error',
      user: null,
      error: new Error('network unavailable'),
      reload,
    });
    rerender(
      <MemoryRouter initialEntries={['/knowledge']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('身份信息加载失败');
    screen.getByRole('button', { name: '重试' }).click();
    expect(reload).toHaveBeenCalledOnce();
  });
});

it('does not expose governance to a policy-only administrator', () => {
  mockUseAuth.mockReturnValue(
    authenticatedAuth({
      user: {
        ...user,
        policies: [
          { action: 'finance.*', effect: 'allow' },
          { action: 'admin.manage', effect: 'allow' },
        ],
      },
    }),
  );

  renderShell('/finance');

  const navigation = screen.getByRole('navigation', { name: '主要导航' });
  expect(navigation).not.toHaveTextContent('财务治理');
  expect(within(navigation).queryByText('权限与模块管理')).not.toBeInTheDocument();
});

it('exposes governance to a platform super administrator', () => {
  mockUseAuth.mockReturnValue(
    authenticatedAuth({
      user: {
        ...user,
        roles: ['platform.super_admin'],
        developmentAccess: 'lead',
        viewer: { uid: user.uid, displayName: user.displayName, canManageDevelopment: true },
      },
    }),
  );

  renderShell('/admin');

  const link = within(screen.getByRole('complementary', { name: '发展平台侧栏' })).getByRole(
    'link',
    { name: '管理员端' },
  );
  expect(link).toBeInTheDocument();
  expect(link.querySelector('img')).toHaveClass('sidebar-system-icon');
});
