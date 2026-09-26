import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import freeBbsEmblem from '../assets/freebbs-emblem-v2.png';
import moonIcon from '../assets/main-site/moon.svg';
import sunIcon from '../assets/main-site/sun.svg';
import learningIcon from '../assets/icons/learning.svg';
import adminIcon from '../assets/icons/admin.svg';
import { DemoUserSwitcher } from '../core/auth/DemoUserSwitcher.js';
import { useAuth } from '../core/auth/AuthProvider.js';
import type { PresentationUser } from '../core/permissions/Can.js';
import { useMainSiteTheme } from '../core/theme/useMainSiteTheme.js';
import { MainSiteHeader } from './MainSiteHeader.js';
import { visibleModuleManifests, type ModuleStateOverrides } from './module-manifests.js';

export interface AppShellProps {
  children?: ReactNode;
  moduleStates?: ModuleStateOverrides;
}

interface ModuleNavigationProps {
  activePath?: string;
  className: string;
  ensureCurrentVisible?: boolean;
  label: string;
  moduleStates?: ModuleStateOverrides;
  user: PresentationUser;
}

function ModuleNavigation({
  activePath,
  className,
  ensureCurrentVisible = false,
  label,
  moduleStates,
  user,
}: ModuleNavigationProps) {
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!ensureCurrentVisible) {
      return;
    }

    navigationRef.current
      ?.querySelector<HTMLElement>('a[aria-current="page"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activePath, ensureCurrentVisible]);

  return (
    <nav ref={navigationRef} className={className} aria-label={label}>
      {visibleModuleManifests(user, moduleStates)
        .filter((module) => module.id !== 'dashboard' && module.id !== 'admin')
        .map((module) => {
          const content = (
            <>
              <span className="module-icon" aria-hidden="true">
                <img src={module.icon} alt="" />
              </span>
              <span className="module-copy">
                <span className="module-name">{module.name}</span>
              </span>
            </>
          );

          return (
            <div data-testid="module-navigation-item" key={module.id}>
              <NavLink
                className={({ isActive }) => `module-link${isActive ? ' active' : ''}`}
                to={module.route}
              >
                {content}
              </NavLink>
            </div>
          );
        })}
      <a className="module-link learning-return-link" href="/world">
        <span className="module-icon" aria-hidden="true">
          <img src={learningIcon} alt="" />
        </span>
        <span className="module-copy">
          <span className="module-name">返回学习端</span>
        </span>
      </a>
    </nav>
  );
}

function AuthState({ children }: { children: ReactNode }) {
  return (
    <main className="auth-state">
      <div>{children}</div>
    </main>
  );
}

function PreviewDenied() {
  useEffect(() => {
    if (window.location.pathname.startsWith('/development/')) {
      window.location.replace('/development');
    }
  }, []);

  return (
    <AuthState>
      <p>正在返回主站…</p>
      <a href="/development">返回主站施工页</a>
    </AuthState>
  );
}

export function AppShell({ children, moduleStates }: AppShellProps) {
  const auth = useAuth();
  const location = useLocation();

  const theme = useMainSiteTheme();
  if (auth.status === 'loading') {
    return (
      <AuthState>
        <h1>FREE / BBS</h1>
        <p>正在加载身份信息…</p>
      </AuthState>
    );
  }

  if (auth.status === 'unauthenticated') {
    return (
      <AuthState>
        <h1>需要登录</h1>
        <p>请使用主站账号登录后继续访问发展平台。</p>
        <a href={auth.loginUrl}>登录主站</a>
      </AuthState>
    );
  }

  if (auth.status === 'denied') {
    return <PreviewDenied />;
  }

  if (auth.status === 'error') {
    return (
      <AuthState>
        <div role="alert">
          <h1>身份信息加载失败</h1>
          <p>{auth.error?.message ?? '暂时无法连接身份服务，请稍后重试。'}</p>
          <button type="button" onClick={auth.reload}>
            重试
          </button>
        </div>
      </AuthState>
    );
  }

  if (!auth.user) {
    return (
      <AuthState>
        <div role="alert">
          <h1>身份信息不可用</h1>
          <button type="button" onClick={auth.reload}>
            重试
          </button>
        </div>
      </AuthState>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className="app-shell">
        <aside className="sidebar" aria-label="发展平台侧栏">
          <NavLink className="brand" to="/dashboard" aria-label="FREE BBS">
            <img className="brand-mark" src={freeBbsEmblem} alt="FREE BBS" />
            <span className="brand-name">FREE-BBS</span>
          </NavLink>

          <ModuleNavigation
            className="module-nav"
            label="主要导航"
            moduleStates={moduleStates}
            user={auth.user as PresentationUser}
          />
          <div className="sidebar-footer">
            {(auth.user.viewer?.canManageDevelopment ||
              (auth.authMode === 'demo' && auth.user.roles.includes('platform.super_admin'))) &&
            !auth.user.previewing ? (
              <NavLink className="sidebar-system-link" to="/admin">
                <img src={adminIcon} alt="" />
                <span>管理员模块</span>
              </NavLink>
            ) : null}
            <button
              className="sidebar-theme-button"
              type="button"
              aria-label={theme.mode === 'light' ? '切换到暗色模式' : '切换到明亮模式'}
              aria-pressed={theme.mode === 'light'}
              onClick={theme.toggle}
            >
              <img src={theme.mode === 'light' ? moonIcon : sunIcon} alt="" />
              <span>{theme.mode === 'light' ? '暗色模式' : '明亮模式'}</span>
            </button>
          </div>
        </aside>

        <div>
          <MainSiteHeader
            user={auth.user}
            authMode={auth.authMode}
            themeMode={theme.mode}
            onToggleTheme={theme.toggle}
          />
          {auth.user.previewing ? (
            <div className="development-preview-banner" role="status">
              <span>
                正在以 <strong>{auth.user.displayName}</strong> 的身份预览
              </span>
              <button type="button" onClick={() => auth.setPreviewUser(null)}>
                退出预览
              </button>
            </div>
          ) : null}
          {auth.authMode === 'demo' ? (
            <div className="demo-preview-toolbar">
              <DemoUserSwitcher />
            </div>
          ) : null}

          <main className="page-content" id="main-content">
            {children ?? <Outlet />}
          </main>
        </div>
      </div>

      <ModuleNavigation
        activePath={location.pathname}
        className="mobile-nav"
        ensureCurrentVisible
        label="移动导航"
        moduleStates={moduleStates}
        user={auth.user as PresentationUser}
      />
    </>
  );
}
