import { departmentForRoute } from '@freebbs-development/contracts';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ApiClient } from '../../core/api/client.js';
import { DepartmentHomepage } from './DepartmentHomepage.js';
import { findOrganization, organizationRegistrationPath } from './catalog.js';
import { OrganizationMark } from './OrganizationMark.js';
import { OrganizationDepartmentViewport } from './OrganizationDepartmentViewport.js';
import { MainSiteFooter } from '../../app/MainSiteFooter.js';
import {
  CuratedDepartmentShowcase,
  SubmittedDepartmentShowcase,
} from './showcase/CuratedDepartmentShowcase.js';
import { OrganizationShowcaseHome } from './showcase/OrganizationShowcaseHome.js';
import { findShowcase } from './showcase/registry.js';
import { DepartmentShowcaseCard } from './showcase/DepartmentShowcaseCard.js';
import { usesFullPageShowcase } from './showcase/presentation.js';

export function OrganizationsPage({
  organizationKey,
  departmentKey,
  enabled = true,
  client,
}: {
  organizationKey?: string;
  departmentKey?: string;
  enabled?: boolean;
  client?: Pick<ApiClient, 'request'>;
}) {
  const page = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  useLayoutEffect(() => {
    const header = document.querySelector('.main-site-header');
    if (!header) return;
    const update = () =>
      page.current?.style.setProperty(
        '--sc-header-offset',
        `${Math.ceil(header.getBoundingClientRect().height) + 6}px`,
      );
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(header);
    return () => observer?.disconnect();
  }, [organizationKey, departmentKey, enabled]);
  useEffect(() => {
    if (hash) {
      let id = hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // A malformed fragment should still leave a usable page at its entrance.
      }
      const anchor = document.getElementById(id);
      if (anchor && page.current?.contains(anchor)) {
        anchor.scrollIntoView({ block: 'start', behavior: 'instant' });
        return;
      }
    }
    page.current
      ?.querySelector<HTMLElement>('.organization-department-scroll')
      ?.scrollTo?.({ top: 0, left: 0, behavior: 'instant' });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [organizationKey, departmentKey, hash]);
  useEffect(() => {
    const previousTitle = document.title;
    const group = organizationKey ? findOrganization(organizationKey) : undefined;
    const item = group?.departments.find(({ key }) => key === departmentKey);
    const showcase = group
      ? findShowcase(`${group.key}.${departmentKey ?? 'position'}`)
      : undefined;
    document.title = `${showcase?.shortName ?? showcase?.name ?? item?.name ?? group?.name ?? '风采展示'} · FREE BBS`;
    return () => {
      document.title = previousTitle;
    };
  }, [organizationKey, departmentKey]);
  if (!enabled)
    return (
      <section ref={page} className="module-page organization-page">
        <p role="status">风采展示暂未开放，请稍后再来。</p>
      </section>
    );
  const organization = organizationKey ? findOrganization(organizationKey) : undefined;
  const department = organization?.departments.find(({ key }) => key === departmentKey);
  const tmsPosition = organization?.key === 'tms' && departmentKey === 'position';
  if ((organizationKey && !organization) || (departmentKey && !department && !tmsPosition))
    return (
      <section ref={page} className="module-page organization-page">
        <h2>没有找到这个展区</h2>
        <p>可以从组织首页重新开始浏览。</p>
        <Link to="/organizations">返回风采展示</Link>
      </section>
    );
  if (!organization)
    return (
      <OrganizationDepartmentViewport ref={page}>
        <OrganizationShowcaseHome />
        <MainSiteFooter />
      </OrganizationDepartmentViewport>
    );
  const canonicalDepartment =
    department || organization.key === 'tms'
      ? departmentForRoute(organization.key, department?.key ?? 'position')
      : undefined;
  const curated = findShowcase(`${organization.key}.${department?.key ?? 'position'}`);
  const fullPage = Boolean(curated?.site && usesFullPageShowcase(curated.departmentId));
  if (canonicalDepartment || (department && curated))
    return (
      <OrganizationDepartmentViewport
        key={curated?.slug ?? canonicalDepartment?.id ?? department?.key}
        ref={page}
        organization={organization}
        departmentLabel={
          curated?.shortName ?? curated?.name ?? department?.name ?? organization.name
        }
        fullPage={fullPage}
      >
        {fullPage && curated?.departmentId === 'youth_league.organization' ? (
          <Link
            className="sc-fullscreen-toggle sc-department-tool"
            to="/organizations/youth_league/organization/ledger"
          >
            班级活动台账 <span aria-hidden="true">↗</span>
          </Link>
        ) : null}
        {fullPage && curated ? (
          <SubmittedDepartmentShowcase key={curated.slug} content={curated} fullPage />
        ) : canonicalDepartment ? (
          <DepartmentHomepage
            key={canonicalDepartment.id}
            department={canonicalDepartment}
            introduction={department?.introduction ?? organization.introduction}
            client={client}
          />
        ) : curated ? (
          <CuratedDepartmentShowcase content={curated} />
        ) : null}
        {!fullPage ? <MainSiteFooter /> : null}
      </OrganizationDepartmentViewport>
    );
  return (
    <OrganizationDepartmentViewport ref={page} organization={organization}>
      <header className="organization-profile-hero sc-group-hero">
        <div className="organization-profile-mark">
          <OrganizationMark variant={organization.key} />
        </div>
        <div>
          <span className="sc-sticker">欢迎来串门！</span>
          <p className="organization-eyebrow">校园组织 · 电子系</p>
          <h2>{organization.name}</h2>
          <p>{organization.introduction}</p>
          <div className="organization-focus">
            {organization.focus.map((focus) => (
              <span key={focus}>{focus}</span>
            ))}
          </div>
          {!organization.organizationIds.length ? (
            <p className="organization-scope-note">
              目前展示全部活动报名，媒体中心相关活动请查看活动说明。
            </p>
          ) : null}
          <Link
            className="organization-primary-link"
            to={organizationRegistrationPath(organization.organizationIds)}
          >
            查看相关活动 <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>
      <section className="organization-department-section">
        <header>
          <h3>走进各部门</h3>
          <span>看作品，听故事，一起认识它的日常。</span>
        </header>
        <div className="sc-discover-grid">
          {organization.departments.map((department) => (
            <DepartmentShowcaseCard
              key={department.key}
              organization={organization}
              department={department}
            />
          ))}
        </div>
      </section>
      <MainSiteFooter />
    </OrganizationDepartmentViewport>
  );
}
