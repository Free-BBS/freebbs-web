import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import freeBbsEmblem from '../assets/freebbs-emblem-v2.png';
import learningIcon from '../assets/icons/learning.svg';
import { isOrganizationShowcasePath } from '../modules/organizations/showcase/presentation.js';
import { OrganizationShowcaseHeader } from '../modules/organizations/OrganizationShowcaseHeader.js';
import { useAuth } from '../core/auth/AuthProvider.js';
import type { PresentationUser } from '../core/permissions/Can.js';
import { useMainSiteTheme } from '../core/theme/useMainSiteTheme.js';
import { MainSiteHeader } from './MainSiteHeader.js';
import { MainSiteFooter } from './MainSiteFooter.js';
import { useMainSiteTypography } from './main-site-typography.js';
import {
  visibleModuleManifests,
  MODULE_MANIFESTS,
  ORGANIZATIONS_NAVIGATION,
  managementNavigationFor,
  navigationPathname,
  resolveModuleStatus,
  type ModuleStateOverrides,
} from './module-manifests.js';

const HIDDEN_SIDEBAR_MODULE_IDS = new Set([
  'dashboard',
  'admin',
  'liaison',
  'events',
  'knowledge',
  'finance',
]);
const FINANCE_NAVIGATION = MODULE_MANIFESTS.find((module) => module.id === 'finance');

export interface AppShellProps {
  children?: ReactNode;
  moduleStates?: ModuleStateOverrides;
}

interface ModuleNavigationProps {
  activePath?: string;
  className: string;
  ensureCurrentVisible?: boolean;
  financeAccess: boolean;
  label: string;
  moduleStates?: ModuleStateOverrides;
  user: PresentationUser;
  withLearningLink?: boolean;
}

function LearningSiteLink({ className = '' }: { className?: string }) {
  return (
    <a className={`module-link learning-return-link ${className}`.trim()} href="/world">
      <span className="module-icon" aria-hidden="true">
        <img src={learningIcon} alt="" />
      </span>
      <span className="module-copy">
        <span className="module-name">学习端</span>
      </span>
    </a>
  );
}

function ModuleNavigation({
  activePath,
  className,
  ensureCurrentVisible = false,
  financeAccess,
  label,
  moduleStates,
  user,
  withLearningLink = false,
}: ModuleNavigationProps) {
  const navigationRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const navigationPath = navigationPathname(location.pathname);
  const deskAliasActive = /^\/(?:information|knowledge)(?:\/|$)/.test(location.pathname);

  useEffect(() => {
    if (!ensureCurrentVisible) {
      return;
    }

    navigationRef.current
      ?.querySelector<HTMLElement>('a[aria-current="page"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activePath, ensureCurrentVisible]);

  useEffect(() => {
    if (document.head.querySelector('link[data-learning-prefetch]')) return;
    const prefetch = document.createElement('link');
    prefetch.rel = 'prefetch';
    prefetch.as = 'document';
    prefetch.href = '/world';
    prefetch.dataset.learningPrefetch = 'true';
    document.head.append(prefetch);
    return () => prefetch.remove();
  }, []);

  const navigationModules = visibleModuleManifests(user, moduleStates)
    .filter((module) => !HIDDEN_SIDEBAR_MODULE_IDS.has(module.id))
    .flatMap((module) =>
      module.id === 'information' ? [module, ORGANIZATIONS_NAVIGATION] : [module],
    );
  if (
    financeAccess &&
    FINANCE_NAVIGATION &&
    resolveModuleStatus(FINANCE_NAVIGATION, moduleStates) === 'enabled'
  ) {
    navigationModules.push(FINANCE_NAVIGATION);
    navigationModules.sort((left, right) => left.order - right.order);
  }
  const management = managementNavigationFor(user);
  if (withLearningLink && management) {
    navigationModules.push(management);
  }

  return (
    <nav ref={navigationRef} className={className} aria-label={label}>
      {navigationModules.map((module) => {
        const isActive =
          navigationPath === module.route ||
          navigationPath.startsWith(`${module.route}/`) ||
          (module.route === '/desk' && deskAliasActive) ||
          (module.id === 'admin' && /^\/(?:admin|system-settings)(?:\/|$)/.test(navigationPath));
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
          <div data-testid="module-navigation-item" key={module.route}>
            <Link
              className={`module-link${isActive ? ' active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              to={module.route}
            >
              {content}
            </Link>
          </div>
        );
      })}
      {withLearningLink ? <LearningSiteLink /> : null}
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

export function AppShell({ children, moduleStates }: AppShellProps) {
  const auth = useAuth();
  const location = useLocation();
  const fullPageShowcase = isOrganizationShowcasePath(location.pathname);
  const financeModuleEnabled =
    FINANCE_NAVIGATION !== undefined &&
    resolveModuleStatus(FINANCE_NAVIGATION, moduleStates) === 'enabled';
  const previewing = Boolean(auth.user?.previewing || auth.previewUser);
  const financeIdentity = JSON.stringify([
    auth.status,
    auth.authMode,
    auth.user?.uid,
    auth.demoUser,
    auth.previewUser,
    previewing,
  ]);
  const [financeAccess, setFinanceAccess] = useState<{
    identity: string;
    client: typeof auth.client;
    allowed: boolean;
  } | null>(null);

  useEffect(() => {
    setFinanceAccess(null);
    if (auth.status !== 'authenticated' || previewing || !financeModuleEnabled || !auth.client)
      return;
    let current = true;
    void (async () => {
      try {
        const access = await auth.client.request<{
          configured: boolean;
          canAccess: boolean;
          canManageBudget: boolean;
        }>('/finance/tracking/access');
        if (current)
          setFinanceAccess({
            identity: financeIdentity,
            client: auth.client,
            allowed: access?.configured === true && access.canAccess === true,
          });
      } catch {
        // Financial visibility fails closed independently of the rest of the shell.
      }
    })();
    return () => {
      current = false;
    };
  }, [auth.client, auth.status, financeIdentity, financeModuleEnabled, previewing]);
  const canAccessFinance =
    !previewing &&
    financeAccess?.identity === financeIdentity &&
    financeAccess.client === auth.client &&
    financeAccess.allowed;

  const theme = useMainSiteTheme();
  const typography = useMainSiteTypography();
  if (auth.status === 'loading') {
    return (
      <AuthState>
        <h1 className="auth-brand-label">FREE / BBS</h1>
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

  const management = managementNavigationFor(auth.user);
  const managementActive = /^\/(?:admin|system-settings)(?:\/|$)/.test(location.pathname);
  return (
    <div
      className={`development-shell-root${fullPageShowcase ? ' development-shell-root--full-page' : ''}`}
      style={typography}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className={`app-shell${fullPageShowcase ? ' app-shell--full-page' : ''}`}>
        <aside className="sidebar" aria-label="发展平台侧栏">
          <NavLink className="brand" to="/community" aria-label="FREE BBS">
            <img className="brand-mark" src={freeBbsEmblem} alt="FREE BBS" />
            <span className="brand-name">FREE-BBS</span>
          </NavLink>

          <ModuleNavigation
            className="module-nav"
            label="主要导航"
            financeAccess={canAccessFinance}
            moduleStates={moduleStates}
            user={auth.user as PresentationUser}
          />
          <div className="sidebar-footer">
            {management ? (
              <Link
                className={`sidebar-system-link${managementActive ? ' active' : ''}`}
                aria-current={managementActive ? 'page' : undefined}
                to={management.route}
              >
                <img className="sidebar-system-icon" src={management.icon} alt="" />
                <span>{management.name}</span>
              </Link>
            ) : null}
            <LearningSiteLink className="sidebar-learning-link" />
          </div>
        </aside>

        <div className="app-shell-main">
          <MainSiteHeader
            client={auth.client}
            user={auth.user}
            authMode={auth.authMode}
            themeMode={theme.mode}
            onToggleTheme={theme.toggle}
            titleContent={fullPageShowcase ? <OrganizationShowcaseHeader /> : undefined}
          />
          {auth.user.previewing ? (
            <div className="development-preview-banner" role="status">
              <span>
                正在以 <strong>{auth.user.displayName}</strong> 的身份只读预览
              </span>
              <button type="button" onClick={() => auth.setPreviewUser(null)}>
                退出预览
              </button>
            </div>
          ) : null}

          <main className="page-content" id="main-content">
            {children ?? <Outlet />}
          </main>
          {!fullPageShowcase ? <MainSiteFooter /> : null}
        </div>
      </div>

      <ModuleNavigation
        activePath={location.pathname}
        className="mobile-nav"
        ensureCurrentVisible
        label="移动导航"
        financeAccess={canAccessFinance}
        moduleStates={moduleStates}
        user={auth.user as PresentationUser}
        withLearningLink
      />
    </div>
  );
}
