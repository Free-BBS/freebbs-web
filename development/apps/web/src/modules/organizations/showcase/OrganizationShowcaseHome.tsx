import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ORGANIZATION_GALLERY } from '../catalog.js';
import { OrganizationMark } from '../OrganizationMark.js';
import { findShowcase } from './registry.js';
import { DepartmentShowcaseCard } from './DepartmentShowcaseCard.js';

export function OrganizationShowcaseHome() {
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const entries = useMemo(
    () =>
      ORGANIZATION_GALLERY.flatMap((organization) => {
        const departments =
          organization.key === 'tms'
            ? [
                {
                  key: 'position',
                  name: organization.name,
                  introduction: organization.introduction,
                  focus: organization.focus,
                },
              ]
            : organization.departments;
        return departments.map((department) => {
          const content = findShowcase(`${organization.key}.${department.key}`);
          return {
            organization,
            department,
            content,
            route:
              organization.key === 'tms'
                ? '/organizations/tms'
                : `/organizations/${organization.key}/${department.key}`,
            title: content?.shortName ?? content?.name ?? department.name,
            summary: content?.summary ?? department.introduction,
            searchText: [
              department.name,
              organization.name,
              content?.name,
              content?.tagline,
              content?.summary,
              ...department.focus,
              ...(content?.keywords ?? []),
              ...(content?.introduction ?? []),
              ...(content?.duties ?? []),
              ...(content?.sections.flatMap((section) => [
                section.title,
                section.introduction,
                ...(section.paragraphs ?? []),
                ...(section.items?.flatMap((item) => [
                  item.title,
                  item.description,
                  ...(item.paragraphs ?? []),
                ]) ?? []),
              ]) ?? []),
              ...(content?.faq?.flatMap((item) => [item.question, item.answer]) ?? []),
            ]
              .filter(Boolean)
              .join(' ')
              .toLocaleLowerCase(),
          };
        });
      }),
    [],
  );
  const query = search.trim().toLocaleLowerCase();
  const visible = entries.filter(
    (entry) =>
      (group === 'all' || entry.organization.key === group) &&
      (!query || entry.searchText.includes(query)),
  );
  return (
    <>
      <header className="sc-campus-hero">
        <div className="sc-campus-intro">
          <span className="sc-sticker">同在电子，亲如一家</span>
          <p className="sc-eyebrow">FREE BBS · 校园组织小街</p>
          <h2>
            风采展示
            <span>
              电子的另一面，
              <br />
              等你来逛！
            </span>
          </h2>
          <p>
            一场比赛、一张海报、一次志愿行动……
            <br />
            认识让校园变得热闹的伙伴，找到想一起做的事。
          </p>
          <a className="sc-pill-link" href="#showcase-discover">
            跟小羊出发 <span aria-hidden="true">↓</span>
          </a>
        </div>
        <div className="sc-campus-characters" aria-hidden="true">
          <div className="sc-character-sticker sc-character-sticker--media">
            <span>记录精彩！</span>
            <OrganizationMark variant="media_center" />
          </div>
          <div className="sc-character-sticker sc-character-sticker--science">
            <span>动手，造点什么！</span>
            <OrganizationMark variant="science_association" />
          </div>
          <span className="sc-campus-doodle sc-campus-doodle--star">✦</span>
          <span className="sc-campus-doodle sc-campus-doodle--hello">HELLO!</span>
          <span className="sc-campus-doodle sc-campus-doodle--circle" />
        </div>
      </header>
      <section className="sc-neighborhoods" aria-labelledby="showcase-neighborhoods-title">
        <header className="sc-home-section-heading">
          <div>
            <span className="sc-sticker">先认个门</span>
            <h3 id="showcase-neighborhoods-title">五个组织，许多种热爱</h3>
          </div>
          <p>每一扇门后，都有人在认真做喜欢的事。</p>
        </header>
        <div className="organization-gallery sc-organization-street" aria-label="电子系社工组织">
          {ORGANIZATION_GALLERY.map((organization) => (
            <Link
              key={organization.key}
              className={`sc-neighborhood sc-neighborhood--${organization.key}`}
              to={`/organizations/${organization.key}`}
              aria-label={`走进${organization.name}`}
              aria-describedby={`sc-neighborhood-summary-${organization.key} sc-neighborhood-departments-${organization.key}`}
            >
              <div className="sc-neighborhood-character">
                <OrganizationMark variant={organization.key} />
              </div>
              <div className="sc-neighborhood-copy">
                <h4>{organization.shortName}</h4>
                <p id={`sc-neighborhood-summary-${organization.key}`}>{organization.motto}</p>
                <div
                  className="sc-neighborhood-departments"
                  id={`sc-neighborhood-departments-${organization.key}`}
                >
                  {organization.departments.length ? (
                    organization.departments.map((department) => (
                      <span key={department.key}>{department.name}</span>
                    ))
                  ) : (
                    <span>理论学习 · 交流与实践</span>
                  )}
                </div>
              </div>
              <span className="sc-neighborhood-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section
        className="sc-discover"
        id="showcase-discover"
        aria-labelledby="showcase-discover-title"
      >
        <header className="sc-home-section-heading">
          <div>
            <span className="sc-sticker">随心逛逛</span>
            <h3 id="showcase-discover-title">哪一站，让你有点心动？</h3>
          </div>
          <p>看作品，听故事，认识部门的日常。</p>
        </header>
        <div className="sc-discover-toolbar">
          <div className="sc-group-filters" role="group" aria-label="按组织筛选">
            <button type="button" aria-pressed={group === 'all'} onClick={() => setGroup('all')}>
              全部
            </button>
            {ORGANIZATION_GALLERY.map((organization) =>
              organization.key === 'tms' ? (
                <Link key={organization.key} to="/organizations/tms">
                  TMS
                </Link>
              ) : (
                <button
                  type="button"
                  key={organization.key}
                  aria-pressed={group === organization.key}
                  onClick={() => setGroup(organization.key)}
                >
                  {organization.shortName}
                </button>
              ),
            )}
          </div>
          <label className="sc-search">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">搜索部门、活动或兴趣</span>
            <input
              ref={searchInputRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜部门、活动或兴趣"
            />
            {search ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  searchInputRef.current?.focus();
                }}
                aria-label="清空搜索"
              >
                ×
              </button>
            ) : null}
          </label>
        </div>
        <p className="sc-results-count" role="status" aria-live="polite">
          {query || group !== 'all' ? `找到 ${visible.length} 个去处` : '从这里，开始认识彼此。'}
        </p>
        {visible.length ? (
          <div className="sc-discover-grid">
            {visible.map((entry) => (
              <DepartmentShowcaseCard
                key={`${entry.organization.key}.${entry.department.key}`}
                organization={entry.organization}
                department={entry.department}
              />
            ))}
          </div>
        ) : (
          <div className="sc-search-empty">
            <OrganizationMark variant="tms" />
            <h4>小羊还没找到这一站</h4>
            <p>换个关键词，或看看其他组织吧。</p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setGroup('all');
              }}
            >
              看看全部
            </button>
          </div>
        )}
      </section>
      <footer className="sc-campus-footer">
        <span aria-hidden="true">✳</span>
        <p>下一段校园故事，也许就从一次相识开始。</p>
        <a href="#showcase-neighborhoods-title">回到小街入口 ↑</a>
      </footer>
    </>
  );
}
