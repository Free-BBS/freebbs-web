import type { AdminModule } from '@freebbs-development/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { errorMessage, SectionState, type AdminClient } from '../admin-support.js';

const DOMAIN_LINKS = [
  { href: '/knowledge', label: '进入知识库', description: '流程、FAQ、联系人与公告' },
  { href: '/information', label: '进入信息中心', description: '通知与信息聚合' },
  {
    href: '/growth',
    label: '进入个人成长档案',
    description: '查看个人活动足迹与成就称号',
  },
  { href: '/events', label: '进入活动管理', description: '活动计划与状态' },
  { href: '/liaison', label: '进入联络管理', description: '联络任务与跟进' },
  { href: '/sports', label: '进入体育管理', description: '代表队、赛程与队长' },
  { href: '/finance', label: '进入财务管理', description: '预算与报销' },
] as const;

export function BusinessEntrySection({ client }: { client: AdminClient }) {
  const [modules, setModules] = useState<AdminModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setModules(await client.request<AdminModule[]>('/admin/modules'));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => void load(), [load]);

  const disabled = modules.filter(({ status }) => status !== 'enabled');

  return (
    <section className="admin-section-layout" aria-labelledby="business-heading">
      <header className="admin-section-heading">
        <p className="eyebrow">OPERATIONS INDEX</p>
        <h3 id="business-heading">业务数据入口</h3>
        <p>这里提供汇总、异常提示和业务域链接；具体数据继续由各业务模块管理。</p>
      </header>
      <SectionState loading={loading} error={error} onRetry={() => void load()}>
        <div className="admin-stat-grid" aria-label="业务汇总">
          <article>
            <span>模块总数</span>
            <strong>{modules.length}</strong>
          </article>
          <article>
            <span>启用模块</span>
            <strong>{modules.length - disabled.length}</strong>
          </article>
          <article data-tone={disabled.length ? 'danger' : 'success'}>
            <span>异常与待处理</span>
            <strong>{disabled.length}</strong>
            <small>
              {disabled.length ? disabled.map(({ name }) => name).join('、') : '未发现停用模块'}
            </small>
          </article>
        </div>
        <nav className="domain-link-grid" aria-label="业务模块入口">
          {DOMAIN_LINKS.map((link) => (
            <Link key={link.href} to={link.href} aria-label={link.label}>
              <span>{link.description}</span>
              <strong>{link.label}</strong>
            </Link>
          ))}
        </nav>
        <aside className="governance-note">
          <strong>数据边界</strong>
          <p>治理后台不提供数据库直录、通用 SQL 或业务对象的重复编辑器。</p>
        </aside>
      </SectionState>
    </section>
  );
}
