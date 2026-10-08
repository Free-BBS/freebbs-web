import { Link } from 'react-router-dom';
import { ORGANIZATION_GALLERY, findOrganization, organizationRegistrationPath } from './catalog.js';
import { OrganizationMark } from './OrganizationMark.js';

export function OrganizationsPage({
  organizationKey,
  departmentKey,
  enabled = true,
}: {
  organizationKey?: string;
  departmentKey?: string;
  enabled?: boolean;
}) {
  if (!enabled)
    return (
      <section className="module-page organization-page">
        <p role="status">风采展示暂未开放，请稍后再来。</p>
      </section>
    );
  const organization = organizationKey ? findOrganization(organizationKey) : undefined;
  const department = organization?.departments.find(({ key }) => key === departmentKey);
  if ((organizationKey && !organization) || (departmentKey && !department))
    return (
      <section className="module-page organization-page">
        <h2>没有找到这个展区</h2>
        <p>可以从组织首页重新开始浏览。</p>
        <Link to="/organizations">返回风采展示</Link>
      </section>
    );

  return (
    <section
      className={`module-page organization-page${organization ? ` organization-page--${organization.key}` : ''}`}
    >
      <nav className="organization-breadcrumb" aria-label="展厅位置">
        <Link to="/organizations">风采展示</Link>
        {organization ? (
          <>
            <span aria-hidden="true">/</span>
            <Link to={`/organizations/${organization.key}`}>{organization.name}</Link>
          </>
        ) : null}
        {department ? (
          <>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{department.name}</span>
          </>
        ) : null}
      </nav>
      {!organization ? (
        <>
          <header className="organization-gallery-heading">
            <div>
              <p className="organization-eyebrow">CAMPUS / PEOPLE & IDEAS</p>
              <h2>风采展示</h2>
              <p>走近每一个组织，找到与你相遇的人和事。</p>
            </div>
            <span className="organization-gallery-note">同在电子，亲如一家</span>
          </header>
          <div className="organization-gallery" aria-label="电子系社工组织">
            {ORGANIZATION_GALLERY.map((item, index) => (
              <Link
                key={item.key}
                className={`organization-exhibit organization-exhibit--${item.key}`}
                to={`/organizations/${item.key}`}
                aria-label={`走进${item.name}`}
              >
                <div className="organization-exhibit-top">
                  <span>校园组织</span>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </div>
                <div className="organization-exhibit-art">
                  <OrganizationMark variant={item.key} />
                </div>
                <div className="organization-exhibit-copy">
                  <h3>{item.name}</h3>
                  <p>{item.motto}</p>
                  {item.departments.length ? (
                    <ul className="organization-department-tags" aria-label={`${item.name}部门`}>
                      {item.departments.map((department) => (
                        <li key={department.key}>{department.name}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="organization-focus">
                      {item.focus.map((focus) => (
                        <span key={focus}>{focus}</span>
                      ))}
                    </div>
                  )}
                </div>
                <footer>
                  <span>
                    {item.departments.length ? `${item.departments.length} 个部门` : '了解分会'}
                  </span>
                  <span>
                    走进组织 <b aria-hidden="true">↗</b>
                  </span>
                </footer>
              </Link>
            ))}
          </div>
          <p className="organization-gallery-caption">从一次相识开始，到下一次一起行动。</p>
        </>
      ) : (
        <>
          <header className="organization-profile-hero">
            <div className="organization-profile-mark">
              <OrganizationMark variant={organization.key} />
            </div>
            <div>
              <p className="organization-eyebrow">
                {department ? organization.name : '校园组织 · 电子系'}
              </p>
              <h2>{department?.name ?? organization.name}</h2>
              <p>{department?.introduction ?? organization.introduction}</p>
              {!department ? (
                <>
                  <div className="organization-focus">
                    {organization.focus.map((focus) => (
                      <span key={focus}>{focus}</span>
                    ))}
                  </div>
                  <Link
                    className="organization-primary-link"
                    to={organizationRegistrationPath(organization.organizationIds)}
                  >
                    查看组织报名 <span aria-hidden="true">↗</span>
                  </Link>
                </>
              ) : null}
            </div>
          </header>
          {department ? (
            <div className="organization-detail-grid">
              <section className="organization-panel">
                <p className="organization-eyebrow">一起协作</p>
                <h3>部门日常</h3>
                <p>从这些方向出发，在共同参与中交流想法、积累经历。</p>
                <div className="organization-focus">
                  {department.focus.map((focus) => (
                    <span key={focus}>{focus}</span>
                  ))}
                </div>
                <p className="organization-small-note">
                  具体工作与活动安排，请以组织发布的通知为准。
                </p>
              </section>
              <section className="organization-panel organization-activity-panel">
                <p className="organization-eyebrow">从了解，到参与</p>
                <h3>在萬事屋相遇</h3>
                <p>查看相关活动与表单，展开报名卡片即可了解详情。</p>
                {department.sharedActivityScope ? (
                  <p className="organization-scope-note">
                    目前展示{organization.name}的报名，具体承办组请查看活动说明。
                  </p>
                ) : null}
                <Link
                  className="organization-primary-link"
                  to={organizationRegistrationPath(department.organizationIds)}
                >
                  查看相关报名 <span aria-hidden="true">↗</span>
                </Link>
                <Link
                  className="organization-secondary-link"
                  to={`/organizations/${organization.key}`}
                >
                  浏览其他部门
                </Link>
              </section>
            </div>
          ) : (
            <>
              {organization.departments.length ? (
                <section className="organization-department-section">
                  <header>
                    <h3>走进各部门</h3>
                    <span>选择一个部门，了解它的日常。</span>
                  </header>
                  <div className="organization-department-grid">
                    {organization.departments.map((item, index) => (
                      <Link
                        className="organization-department-card"
                        key={item.key}
                        to={`/organizations/${organization.key}/${item.key}`}
                        aria-label={`了解${item.name}`}
                      >
                        <span className="organization-department-index" aria-hidden="true">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div>
                          <h4>{item.name}</h4>
                          <p>{item.introduction}</p>
                          <div className="organization-focus">
                            {item.focus.map((focus) => (
                              <span key={focus}>{focus}</span>
                            ))}
                          </div>
                        </div>
                        <span className="organization-department-arrow" aria-hidden="true">
                          ↗
                        </span>
                      </Link>
                    ))}
                  </div>
                </section>
              ) : (
                <section className="organization-panel organization-tms-panel">
                  <div>
                    <p className="organization-eyebrow">交流 · 学习 · 行动</p>
                    <h3>在共同参与中，加深了解。</h3>
                    <p>了解近期学习交流与活动安排，在萬事屋查看分会发布的报名。</p>
                  </div>
                  <Link
                    className="organization-primary-link"
                    to={organizationRegistrationPath(organization.organizationIds)}
                  >
                    查看相关报名 <span aria-hidden="true">↗</span>
                  </Link>
                </section>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
