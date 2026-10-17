import React, { useEffect } from 'react';
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
import { OrganizationDepartmentViewport } from '../modules/organizations/OrganizationDepartmentViewport.js';
import { DepartmentShowcaseCard } from '../modules/organizations/showcase/DepartmentShowcaseCard.js';
import { ReviewShell } from './ReviewShell.js';
import '../styles/tokens.css';
import '../styles/theme.css';
import '../styles/shell.css';
import '../styles/main-site-header.css';
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
  const group = organizationKey ? findOrganization(organizationKey) : undefined;
  const department = group?.departments.find((item) => item.key === departmentKey);
  const content = group ? findShowcase(`${group.key}.${departmentKey ?? 'position'}`) : undefined;
  const tmsPosition = group?.key === 'tms' && departmentKey === 'position';
  const invalid = Boolean(
    organizationKey && (!group || (departmentKey && !department && !tmsPosition)),
  );
  const departmentPage = Boolean(group && !invalid && (content || department));
  const fullPage = Boolean(
    departmentPage && content?.site && usesFullPageShowcase(content.departmentId),
  );
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
      document
        .querySelector<HTMLElement>('.review-main')
        ?.scrollTo?.({ top: 0, left: 0, behavior: 'instant' });
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  }, [location.pathname, location.hash, title]);
  return (
    <ReviewShell departmentPage={departmentPage}>
      <main
        id="main-content"
        className={`review-main organization-page${fullPage ? ' review-main--full-page' : ''}`}
      >
        <OrganizationDepartmentViewport
          key={location.pathname}
          organization={invalid ? undefined : group}
          departmentLabel={departmentPage ? title : undefined}
          fullPage={fullPage}
        >
          {departmentPage && group ? (
            <>
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
            </>
          ) : (
            <div className="review-browse-content">
              {invalid ? (
                <section className="review-empty">
                  <h1>没有找到这个展区</h1>
                  <Link to="/organizations">返回全部展区</Link>
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
            </div>
          )}
          {!fullPage ? <ReviewFooter /> : null}
        </OrganizationDepartmentViewport>
      </main>
    </ReviewShell>
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
