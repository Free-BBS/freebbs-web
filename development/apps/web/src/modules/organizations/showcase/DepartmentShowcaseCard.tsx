import { Link } from 'react-router-dom';
import type { OrganizationDepartment, OrganizationExhibit } from '../catalog.js';
import { OrganizationMark } from '../OrganizationMark.js';
import { findShowcase } from './registry.js';

export function DepartmentShowcaseCard({
  organization,
  department,
}: {
  organization: OrganizationExhibit;
  department: Pick<OrganizationDepartment, 'key' | 'name' | 'introduction' | 'focus'>;
}) {
  const content = findShowcase(`${organization.key}.${department.key}`);
  const title = content?.shortName ?? content?.name ?? department.name;
  const summaryId = `sc-discover-summary-${organization.key}-${department.key}`;
  return (
    <Link
      className={`sc-discover-card sc-discover-card--${organization.key}${content?.hero ? ' sc-discover-card--photo' : ''}`}
      to={
        organization.key === 'tms'
          ? '/organizations/tms'
          : `/organizations/${organization.key}/${department.key}`
      }
      aria-label={`了解${title}`}
      aria-describedby={summaryId}
    >
      <div className="sc-discover-art">
        {content?.hero ? (
          <img
            src={content.hero.src}
            alt={content.hero.alt}
            loading="lazy"
            decoding="async"
            style={{
              objectFit: 'cover',
              objectPosition: content.hero.position,
            }}
          />
        ) : (
          <OrganizationMark variant={organization.key} />
        )}
        <span className="sc-card-label">{organization.shortName}</span>
      </div>
      <div className="sc-discover-copy">
        <h4>
          {title}
          <span aria-hidden="true">↗</span>
        </h4>
        <p id={summaryId}>{content?.summary ?? department.introduction}</p>
        <div className="sc-card-tags">
          {department.focus.slice(0, 3).map((focus) => (
            <span key={focus}>{focus}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}
