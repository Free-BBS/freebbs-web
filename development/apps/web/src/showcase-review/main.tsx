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
import { findOrganization } from '../modules/organizations/catalog.js';
import {
  CuratedDepartmentShowcase,
  SubmittedDepartmentShowcase,
} from '../modules/organizations/showcase/CuratedDepartmentShowcase.js';
import { OrganizationShowcaseHome } from '../modules/organizations/showcase/OrganizationShowcaseHome.js';
import { findShowcase } from '../modules/organizations/showcase/registry.js';
import { usesFullPageShowcase } from '../modules/organizations/showcase/presentation.js';
import { OrganizationMark } from '../modules/organizations/OrganizationMark.js';
import { OrganizationBreadcrumb } from '../modules/organizations/OrganizationBreadcrumb.js';
import { OrganizationDepartmentViewport } from '../modules/organizations/OrganizationDepartmentViewport.js';
import { DepartmentShowcaseCard } from '../modules/organizations/showcase/DepartmentShowcaseCard.js';
import '../styles/tokens.css';
import '../styles/theme.css';
import '../styles/organizations.css';
import '../styles/organization-showcase.css';
import './review.css';

function ReviewFooter() {
  return (
    <footer className="review-footer">
      <Link to="/organizations">← 继续逛逛组织小街</Link>
      <span>FREE BBS · 同在电子，亲如一家</span>
    </footer>
  );
}

function ReviewPage() {
  const { organizationKey, departmentKey } = useParams();
  const location = useLocation();
  const [dark, setDark] = useState(false);
  const group = organizationKey ? findOrganization(organizationKey) : undefined;
  const department = group?.departments.find((item) => item.key === departmentKey);
  const content = group ? findShowcase(`${group.key}.${departmentKey ?? 'position'}`) : undefined;
  const fullPage = Boolean(content?.site && usesFullPageShowcase(content.departmentId));
  const tmsPosition = group?.key === 'tms' && departmentKey === 'position';
  const invalid = Boolean(
    organizationKey && (!group || (departmentKey && !department && !tmsPosition)),
  );
  const departmentPage = Boolean(group && !invalid && (content || department));
  const title =
    content?.shortName ?? content?.name ?? department?.name ?? group?.name ?? '风采展示';
  useEffect(() => {
    document.title = `${title} · FREE BBS 组织风采`;
    if (location.hash) {
      requestAnimationFrame(() =>
        document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' }),
      );
    } else {
      document
        .querySelector<HTMLElement>('.organization-department-scroll')
        ?.scrollTo?.({ top: 0, left: 0, behavior: 'instant' });
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  }, [location.pathname, location.hash, title]);
  useEffect(() => {
    document.body.classList.toggle('theme-light', !dark);
  }, [dark]);
  return (
    <div className={`review-layout${departmentPage ? ' review-layout--department' : ''}`}>
      <a className="review-skip" href="#main-content">
        跳到内容
      </a>
      <header className="review-header main-site-header">
        <Link className="review-brand" to="/organizations">
          <OrganizationMark variant="science_association" />
          <span>
            FREE BBS<small>组织风采</small>
          </span>
        </Link>
        <nav aria-label="风采展示操作">
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
      <main
        id="main-content"
        className={`review-main organization-page${departmentPage ? ' review-main--department' : ''}${fullPage ? ' review-main--full-page' : ''}`}
      >
        {group && !invalid && !departmentPage ? (
          <OrganizationBreadcrumb organization={group} />
        ) : null}
        {invalid ? (
          <section className="review-empty">
            <h1>没有找到这个展区</h1>
            <Link to="/organizations">返回全部展区</Link>
          </section>
        ) : departmentPage && group ? (
          <OrganizationDepartmentViewport
            key={content?.slug ?? `${group.key}.${department?.key}`}
            organization={group}
            departmentLabel={title}
            fullPage={fullPage}
          >
            {content ? (
              fullPage ? (
                <SubmittedDepartmentShowcase content={content} offline fullPage />
              ) : (
                <CuratedDepartmentShowcase content={content} publicReview />
              )
            ) : department ? (
              <section className="review-empty">
                <OrganizationMark variant={group.key} />
                <h1>{department.name}</h1>
                <p>{department.introduction}</p>
              </section>
            ) : null}
            {!fullPage ? <ReviewFooter /> : null}
          </OrganizationDepartmentViewport>
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
            <div className="sc-discover-grid">
              {group.departments.map((department) => (
                <DepartmentShowcaseCard
                  key={department.key}
                  organization={group}
                  department={department}
                />
              ))}
            </div>
          </>
        ) : (
          <OrganizationShowcaseHome />
        )}
      </main>
      {!departmentPage ? <ReviewFooter /> : null}
    </div>
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
