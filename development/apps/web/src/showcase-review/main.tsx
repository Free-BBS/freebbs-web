import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  HashRouter,
  Link,
  useLocation,
  useParams,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { ORGANIZATION_GALLERY, findOrganization } from '../modules/organizations/catalog.js';
import { CuratedDepartmentShowcase } from '../modules/organizations/showcase/CuratedDepartmentShowcase.js';
import { OrganizationShowcaseHome } from '../modules/organizations/showcase/OrganizationShowcaseHome.js';
import { findShowcase } from '../modules/organizations/showcase/registry.js';
import { OrganizationMark } from '../modules/organizations/OrganizationMark.js';
import '../styles/tokens.css';
import '../styles/theme.css';
import '../styles/organizations.css';
import '../styles/organization-showcase.css';
import './review.css';

const destinations = ORGANIZATION_GALLERY.flatMap((group) =>
  group.key === 'tms'
    ? [{ name: group.name, path: '/organizations/tms', submitted: true }]
    : group.departments.map((department) => ({
        name:
          findShowcase(`${group.key}.${department.key}`)?.shortName ??
          findShowcase(`${group.key}.${department.key}`)?.name ??
          department.name,
        path: `/organizations/${group.key}/${department.key}`,
        submitted: Boolean(findShowcase(`${group.key}.${department.key}`)),
      })),
);

function ReviewPage() {
  const { organizationKey, departmentKey } = useParams();
  const location = useLocation();
  const [dark, setDark] = useState(false);
  const group = organizationKey ? findOrganization(organizationKey) : undefined;
  const department = group?.departments.find((item) => item.key === departmentKey);
  const content = group ? findShowcase(`${group.key}.${departmentKey ?? 'position'}`) : undefined;
  const invalid = Boolean(organizationKey && (!group || (departmentKey && !department)));
  const title =
    content?.shortName ?? content?.name ?? department?.name ?? group?.name ?? '风采展示';
  useEffect(() => {
    document.title = `${title} · FREE BBS 组织风采`;
    if (location.hash) {
      requestAnimationFrame(() =>
        document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' }),
      );
    } else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname, location.hash, title]);
  useEffect(() => {
    document.body.classList.toggle('theme-light', !dark);
  }, [dark]);
  return (
    <>
      <a className="review-skip" href="#main-content">
        跳到内容
      </a>
      <header className="review-header main-site-header">
        <Link className="review-brand" to="/organizations">
          <OrganizationMark variant="science_association" />
          <span>
            FREE BBS<small>组织风采 · 离线审核</small>
          </span>
        </Link>
        <nav aria-label="审核页操作">
          <Link to="/organizations">全部展区</Link>
          <button
            type="button"
            aria-label={dark ? '切换到浅色模式' : '切换到暗色模式'}
            onClick={() => setDark(!dark)}
          >
            {dark ? '☀' : '☾'}
          </button>
        </nav>
      </header>
      <main id="main-content" className="review-main organization-page">
        {group ? (
          <nav className="organization-breadcrumb" aria-label="展厅位置">
            <Link to="/organizations">风采展示</Link>
            <span>/</span>
            <Link to={`/organizations/${group.key}`}>{group.name}</Link>
            {department ? (
              <>
                <span>/</span>
                <span aria-current="page">{title}</span>
              </>
            ) : null}
          </nav>
        ) : null}
        {invalid ? (
          <section className="review-empty">
            <h1>没有找到这个展区</h1>
            <Link to="/organizations">返回全部展区</Link>
          </section>
        ) : content ? (
          <CuratedDepartmentShowcase key={content.slug} content={content} publicReview />
        ) : department ? (
          <section className="review-empty">
            <OrganizationMark variant={group!.key} />
            <h1>{department.name}</h1>
            <p>{department.introduction}</p>
            <p>这个部门的特色材料还在准备中，先认识它的日常工作吧。</p>
            <Link to={`/organizations/${group!.key}`}>返回{group!.shortName}</Link>
          </section>
        ) : group ? (
          <>
            <header className="organization-profile-hero sc-group-hero">
              <OrganizationMark variant={group.key} />
              <div>
                <span className="sc-sticker">欢迎来串门！</span>
                <h1>{group.name}</h1>
                <p>{group.introduction}</p>
              </div>
            </header>
            <div className="review-department-grid">
              {group.departments.map((item) => (
                <Link key={item.key} to={`/organizations/${group.key}/${item.key}`}>
                  <h2>{findShowcase(`${group.key}.${item.key}`)?.shortName ?? item.name}</h2>
                  <p>{findShowcase(`${group.key}.${item.key}`)?.summary ?? item.introduction}</p>
                  <span>走进这个部门 ↗</span>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <>
            <OrganizationShowcaseHome />
            <section className="review-link-list" id="review-help">
              <header>
                <div>
                  <span className="sc-sticker">一起把页面做得更好</span>
                  <h2>部门审核目录</h2>
                </div>
              </header>
              <div>
                {destinations.map((item) => (
                  <Link key={item.path} to={item.path}>
                    {item.name}
                    <small>{item.submitted ? '查看展示 ↗' : '介绍页 · 待投稿'}</small>
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
      <footer className="review-footer">
        <Link to="/organizations">← 继续逛逛组织小街</Link>
        <span>FREE BBS · 同在电子，亲如一家</span>
      </footer>
    </>
  );
}

// Hash navigation works for files opened directly from an extracted folder.
// Section anchors scroll inside the current page without replacing its route.
document.addEventListener('click', (event) => {
  const anchor = (event.target as Element)?.closest?.('a[href^="#"]');
  const href = anchor?.getAttribute('href');
  if (!href || href.startsWith('#/')) return;
  const target = document.getElementById(href.slice(1));
  if (target) {
    event.preventDefault();
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
});
if (!window.location.hash.startsWith('#/'))
  window.location.hash = document.body.dataset.route ?? '/organizations';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/organizations" element={<ReviewPage />} />
        <Route path="/organizations/:organizationKey" element={<ReviewPage />} />
        <Route path="/organizations/:organizationKey/:departmentKey" element={<ReviewPage />} />
        <Route path="*" element={<Navigate to="/organizations" replace />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
