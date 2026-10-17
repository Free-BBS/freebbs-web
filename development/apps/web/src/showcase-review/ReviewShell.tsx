import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { OrganizationShowcaseHeader } from '../modules/organizations/OrganizationShowcaseHeader.js';
import freeBbsEmblem from '../assets/freebbs-emblem-v2.png';
import communityIcon from '../assets/icons/community.svg';
import collectionsIcon from '../assets/icons/collections.svg';
import sportsIcon from '../assets/icons/sports.svg';
import informationIcon from '../assets/icons/information.svg';
import organizationsIcon from '../assets/icons/organizations.svg';
import growthIcon from '../assets/icons/growth.svg';
import learningIcon from '../assets/icons/learning.svg';
import calendarIcon from '../assets/main-site/calendar.svg';
import inventoryIcon from '../assets/main-site/inventory.svg';
import shopIcon from '../assets/main-site/shop.svg';
import gearIcon from '../assets/main-site/gear.svg';
import moonIcon from '../assets/main-site/moon.svg';
import sunIcon from '../assets/main-site/sun.svg';
import electronIcon from '../assets/main-site/electron.svg';
import magnetronIcon from '../assets/main-site/magnetron.svg';
import flameIcon from '../assets/main-site/flame.svg';
import placeholderAvatar from '../assets/main-site/avatar_placeholder.webp';

const navigation = [
  { label: '無界广场', icon: communityIcon },
  { label: '萬事屋', icon: collectionsIcon },
  { label: '無体育', icon: sportsIcon },
  { label: '無尽书桌', icon: informationIcon },
  { label: '风采展示', icon: organizationsIcon, active: true },
  { label: '个人成长档案', icon: growthIcon },
];
const offlineOnly = '此离线包仅包含组织风采';

export function ReviewShell({
  departmentPage,
  children,
}: {
  departmentPage: boolean;
  children: ReactNode;
}) {
  const [dark, setDark] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  useEffect(() => {
    document.body.classList.toggle('theme-light', !dark);
    document.body.classList.toggle('theme-dark', dark);
  }, [dark]);
  useEffect(() => setNavigationOpen(false), [location.pathname]);
  useEffect(() => {
    if (!navigationOpen) return;
    sidebarRef.current?.querySelector<HTMLElement>('a')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavigationOpen(false);
      if (event.key === 'Tab') {
        const links = sidebarRef.current?.querySelectorAll<HTMLAnchorElement>('a[href]');
        if (!links?.length) return;
        if (event.shiftKey && document.activeElement === links[0]) {
          event.preventDefault();
          links[links.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === links[links.length - 1]) {
          event.preventDefault();
          links[0].focus();
        }
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      menuRef.current?.focus();
    };
  }, [navigationOpen]);

  return (
    <div
      className={`review-layout development-shell-root${departmentPage ? ' review-layout--department' : ''}${navigationOpen ? ' review-layout--navigation-open' : ''}`}
    >
      <a className="review-skip" href="#main-content">
        跳到内容
      </a>
      {navigationOpen ? (
        <button
          className="review-sidebar-backdrop"
          type="button"
          aria-label="关闭侧栏"
          onClick={() => setNavigationOpen(false)}
        />
      ) : null}
      <aside
        ref={sidebarRef}
        className="sidebar review-sidebar"
        id="review-sidebar"
        aria-label="发展平台侧栏"
      >
        <Link className="brand" to="/organizations" aria-label="FREE BBS">
          <img className="brand-mark" src={freeBbsEmblem} alt="" />
          <span className="brand-name">FREE-BBS</span>
        </Link>
        <nav className="module-nav" aria-label="主要导航">
          {navigation.map((item) => {
            const label = (
              <>
                <span className="module-icon" aria-hidden="true">
                  <img src={item.icon} alt="" />
                </span>
                <span className="module-copy">
                  <span className="module-name">{item.label}</span>
                </span>
              </>
            );
            return item.active ? (
              <Link
                className="module-link active"
                aria-current="page"
                to="/organizations"
                key={item.label}
              >
                {label}
              </Link>
            ) : (
              <span
                className="module-link review-unavailable"
                aria-disabled="true"
                title={offlineOnly}
                key={item.label}
              >
                {label}
              </span>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <span
            className="module-link sidebar-learning-link review-unavailable"
            aria-disabled="true"
            title={offlineOnly}
          >
            <span className="module-icon" aria-hidden="true">
              <img src={learningIcon} alt="" />
            </span>
            <span className="module-name">学习端</span>
          </span>
        </div>
        <div className="review-currencies" aria-hidden="true">
          {[electronIcon, magnetronIcon, flameIcon].map((icon) => (
            <span className="main-site-currency" key={icon}>
              <img src={icon} alt="" />
              <span>—</span>
            </span>
          ))}
        </div>
      </aside>
      <div className="review-workspace">
        <header className="review-header main-site-header">
          <button
            ref={menuRef}
            className="review-menu-toggle main-site-tool-button"
            type="button"
            aria-label={navigationOpen ? '关闭发展平台侧栏' : '打开发展平台侧栏'}
            aria-controls="review-sidebar"
            aria-expanded={navigationOpen}
            onClick={() => setNavigationOpen(!navigationOpen)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <OrganizationShowcaseHeader />
          <div className="main-site-account review-header-tools">
            <span
              className="main-site-search main-site-tool-button review-unavailable"
              aria-disabled="true"
              title={offlineOnly}
              aria-label="全站搜索（离线不可用）"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <circle cx="10" cy="10" r="6.5" />
                <path d="m15 15 5 5" />
              </svg>
            </span>
            <div
              className="main-site-shortcuts review-header-shortcuts"
              aria-label="主站功能（离线不可用）"
            >
              {[
                { label: '签到', icon: calendarIcon },
                { label: '仓库', icon: inventoryIcon },
                { label: '商店', icon: shopIcon },
              ].map((item) => (
                <span
                  className={`main-site-shortcut review-unavailable${item.label === '签到' ? ' main-site-checkin' : ''}`}
                  aria-disabled="true"
                  title={offlineOnly}
                  key={item.label}
                >
                  <img src={item.icon} alt="" />
                  <span>{item.label}</span>
                </span>
              ))}
            </div>
            <span
              className="main-site-avatar review-unavailable"
              aria-disabled="true"
              title={offlineOnly}
              aria-label="个人主页（离线不可用）"
            >
              <img src={placeholderAvatar} alt="" />
            </span>
            <span
              className="main-site-settings main-site-tool-button review-unavailable"
              aria-disabled="true"
              title={offlineOnly}
              aria-label="设置（离线不可用）"
            >
              <img src={gearIcon} alt="" />
            </span>
            <button
              className="main-site-tool-button review-theme-toggle"
              type="button"
              aria-label={dark ? '切换到浅色模式' : '切换到暗色模式'}
              onClick={() => setDark(!dark)}
            >
              <img src={dark ? sunIcon : moonIcon} alt="" />
            </button>
            <span
              className="main-site-notification-bell review-unavailable"
              aria-disabled="true"
              title={offlineOnly}
              aria-label="通知（离线不可用）"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 8H3c0-1 3-1 3-8Z" />
                <path d="M9 21h6" />
              </svg>
            </span>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
