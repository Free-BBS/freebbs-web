import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';

import { AppShell } from './AppShell.js';
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
    expect(Object.keys(states)).toHaveLength(10);
    expect(Object.values(states)).toEqual(Array(10).fill('disabled'));
  });
});

describe('AppShell', () => {
  it('places a prefetched learning-site link at the end of desktop and mobile navigation', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    renderShell('/events');

    for (const name of ['主要导航', '移动导航']) {
      const navigation = screen.getByRole('navigation', { name });
      const links = within(navigation).getAllByRole('link');
      expect(links.at(-1)).toHaveAttribute('href', '/world');
      expect(links.at(-1)).toHaveAccessibleName('学习端');
    }
    expect(document.head.querySelector('link[data-learning-prefetch]')).toHaveAttribute(
      'href',
      '/world',
    );
  });

  it('sends a preview-denied identity back to the main-site construction page', () => {
    mockUseAuth.mockReturnValue({ ...authenticatedAuth(), status: 'denied', user: null });
    renderShell('/events');
    expect(screen.getByRole('link', { name: '返回主站施工页' })).toHaveAttribute(
      'href',
      '/development',
    );
  });
  it('removes only the opportunity module while keeping the other development modules', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());

    renderShell('/knowledge');

    const navigation = screen.getByRole('navigation', { name: '主要导航' });
    const items = within(navigation).getAllByTestId('module-navigation-item');

    expect(items.map((item) => item.querySelector('.module-name')?.textContent)).toEqual([
      '無活动',
      '無体育',
      '萬事集',
      '信息与咨询',
      '经验库',
      '个人成长档案',
    ]);
    expect(within(navigation).queryByRole('link', { name: '工作台' })).not.toBeInTheDocument();
    expect(within(navigation).queryByText('财务治理')).not.toBeInTheDocument();
    expect(within(navigation).queryByText('权限与模块管理')).not.toBeInTheDocument();
    expect(within(navigation).queryByText('趣缘群体')).not.toBeInTheDocument();
    expect(within(navigation).queryByText('無限机会')).not.toBeInTheDocument();
    expect(within(navigation).getByRole('link', { name: '个人成长档案' })).toHaveAttribute(
      'href',
      '/growth',
    );
    expect(within(navigation).getByRole('link', { name: '经验库' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'FREE BBS' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('img', { name: 'FREE BBS' })).toHaveAttribute(
      'src',
      expect.stringContaining('freebbs-emblem-v2.png'),
    );
    expect(screen.getByRole('link', { name: 'FREE BBS' })).toHaveTextContent('FREE-BBS');
    expect(screen.queryByText('发展平台')).not.toBeInTheDocument();
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
    expect(within(navigation).getByRole('link', { name: '信息与咨询' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('navigation', { name: '移动导航' })).toHaveTextContent('信息与咨询');
  });

  it('does not mark information active for an unrelated route prefix', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());

    renderShell('/information-archive');

    expect(
      within(screen.getByRole('navigation', { name: '主要导航' })).getByRole('link', {
        name: '信息与咨询',
      }),
    ).not.toHaveAttribute('aria-current', 'page');
  });

  it('omits a disabled module from navigation', () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());

    renderShell('/dashboard', { moduleStates: { events: 'disabled' } });

    const navigation = screen.getByRole('navigation', { name: '主要导航' });
    expect(within(navigation).queryByRole('link', { name: '無活动' })).not.toBeInTheDocument();
    expect(within(navigation).queryByText('無活动')).not.toBeInTheDocument();
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

    const desktopToggle = within(
      screen.getByRole('complementary', { name: '发展平台侧栏' }),
    ).getByRole('button', { name: '切换到明亮模式' });
    expect(desktopToggle).toBeInTheDocument();
    fireEvent.click(desktopToggle);
    expect(document.body).toHaveClass('theme-light');
    expect(window.localStorage.getItem('free_bbs_theme_mode')).toBe('light');
  });

  it('renders the main-site placeholder avatar and the demo identity switcher', () => {
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
    expect(screen.getByTestId('demo-user-switcher')).toBeInTheDocument();
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
  expect(navigation).toHaveTextContent('财务治理');
  expect(within(navigation).queryByText('权限与模块管理')).not.toBeInTheDocument();
});

it('exposes governance to a platform super administrator', () => {
  mockUseAuth.mockReturnValue(
    authenticatedAuth({
      user: {
        ...user,
        roles: ['platform.super_admin'],
        viewer: { uid: user.uid, displayName: user.displayName, canManageDevelopment: true },
      },
    }),
  );

  renderShell('/admin');

  expect(screen.getByRole('link', { name: '管理员模块' })).toBeInTheDocument();
});
