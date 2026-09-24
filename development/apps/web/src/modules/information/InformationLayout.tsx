import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { ScopeRef, UserContext } from '@freebbs-development/contracts';

export interface InformationLayoutProps {
  children: ReactNode;
  title: string;
  user?:
    | (UserContext & {
        policies?: readonly { action: string; effect?: 'allow' | 'deny'; scope?: ScopeRef }[];
      })
    | null;
}

function matches(pattern: string, permission: string): boolean {
  return (
    pattern === '*' ||
    pattern === permission ||
    (pattern.endsWith('.*') && permission.startsWith(pattern.slice(0, -1)))
  );
}

function hasCapability(user: InformationLayoutProps['user'], permission: string): boolean {
  if (user?.roles.includes('platform.super_admin')) return true;
  const policies = (user?.policies ?? []).filter((policy) => matches(policy.action, permission));
  return (
    !policies.some((policy) => policy.effect === 'deny') &&
    policies.some((policy) => policy.effect !== 'deny')
  );
}

export function InformationLayout({ children, title, user }: InformationLayoutProps) {
  const showTriage =
    hasCapability(user, 'information.consultation.triage') ||
    hasCapability(user, 'information.proposal.manage');
  return (
    <section className="module-page" aria-labelledby="information-route-title">
      <header className="page-section-header">
        <div>
          <h2 id="information-route-title">{title}</h2>
          <nav aria-label="信息与咨询分区">
            <NavLink to="/information/announcements">公开信息</NavLink>{' '}
            <NavLink to="/information/consultations">咨询</NavLink>{' '}
            {showTriage ? (
              <>
                <NavLink to="/information/triage">分诊</NavLink>{' '}
              </>
            ) : null}
            <NavLink to="/information/proposals">提案池</NavLink>
          </nav>
        </div>
      </header>
      {children}
    </section>
  );
}
