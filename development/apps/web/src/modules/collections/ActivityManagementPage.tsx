import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { CollectionFormSummary } from '@freebbs-development/contracts';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import { EventsPage, canCreateActivity, type EventsPageProps } from '../events/EventsPage.js';
import '../../styles/activity-workspace.css';

export interface ActivityManagementPageProps {
  client?: Pick<ApiClient, 'request'>;
  user?: EventsPageProps['user'];
  initialCreate?: boolean;
}

export function ActivityManagementPage({
  client,
  user: suppliedUser,
  initialCreate = false,
}: ActivityManagementPageProps) {
  const defaultClient = useMemo(createApiClient, []);
  const auth = useOptionalAuth();
  const api = client ?? auth?.client ?? defaultClient;
  const user = suppliedUser === undefined ? (auth?.user ?? null) : suppliedUser;
  const [state, setState] = useState<{
    identity: string;
    canCreate: boolean;
    forms: CollectionFormSummary[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [createRequest, setCreateRequest] = useState(0);
  const identity = user?.uid ?? '';
  useEffect(() => {
    let active = true;
    setState(null);
    setError(null);
    Promise.all([
      api.request<{ canCreate: boolean }>('/collections/dashboard'),
      api.request<CollectionFormSummary[]>('/collections/forms'),
    ]).then(
      ([capability, forms]) => {
        if (active)
          setState({
            identity,
            canCreate: capability.canCreate === true,
            forms: forms.filter((form) => form.canManage),
          });
      },
      () => {
        if (active) setError('活动管理暂时无法加载，请重试。');
      },
    );
    return () => {
      active = false;
    };
  }, [api, identity, reload]);
  const ready = state?.identity === identity ? state : null;
  const canCreateLegacy = canCreateActivity(user);
  if (ready?.canCreate && initialCreate && !canCreateLegacy)
    return <Navigate to="/collections/workbench/new" replace />;
  return (
    <main className="activity-catalog activity-management collections-page">
      <Link className="activity-back" to="/collections/activities">
        ← 全部活动
      </Link>
      <header className="activity-catalog-heading">
        <div>
          <p className="activity-eyebrow">萬事屋 · 管理空间</p>
          <h1>活动管理</h1>
          <p>发起新的相遇，记录每一步精彩。</p>
        </div>
        {ready?.canCreate ? (
          <nav className="activity-authoring-actions" aria-label="创建入口">
            {canCreateLegacy ? (
              <button
                type="button"
                className="activity-action-primary"
                onClick={() => setCreateRequest((value) => value + 1)}
              >
                <span aria-hidden="true">＋</span> 创建活动
              </button>
            ) : null}
            <Link
              to="/collections/workbench/new"
              className={canCreateLegacy ? '' : 'activity-action-primary'}
            >
              {canCreateLegacy ? '创建报名表单' : '创建活动'}
            </Link>
          </nav>
        ) : null}
      </header>
      {error ? (
        <div className="activity-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            重新加载
          </button>
        </div>
      ) : !ready ? (
        <p role="status" className="activity-empty">
          正在整理管理入口…
        </p>
      ) : !ready.canCreate ? (
        <p className="activity-empty">
          当前身份可浏览和报名活动。活动创建与管理入口向社工同学开放。
        </p>
      ) : (
        <>
          {canCreateLegacy ? (
            <EventsPage
              key={identity}
              client={api}
              user={user}
              managementOnly
              initialCreate={initialCreate}
              createRequest={createRequest}
            />
          ) : null}
          <section className="activity-owned-forms" aria-label="我的报名表单">
            <header className="activity-management-section-heading">
              <div>
                <h2>我的报名表单</h2>
                <p>自定义问题与报名规则，随时回到工作台完善。</p>
              </div>
              <span className="activity-section-count">{ready.forms.length} 份表单</span>
            </header>
            {ready.forms.length ? (
              <div className="activity-managed-form-grid">
                {[...ready.forms]
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map((form) => (
                    <article className="activity-managed-form" key={form.id}>
                      <span
                        className={`activity-status is-${form.status === 'published' ? 'open' : 'ended'}`}
                      >
                        {form.status === 'published'
                          ? '已发布'
                          : form.status === 'draft'
                            ? '草稿'
                            : form.status === 'closed'
                              ? '已关闭'
                              : '已归档'}
                      </span>
                      <h3>{form.title}</h3>
                      <p>{form.description || '活动介绍待补充'}</p>
                      <div className="activity-authoring-actions">
                        <Link to={`/collections/workbench/${encodeURIComponent(form.id)}`}>
                          编辑报名表
                        </Link>
                        {form.status !== 'draft' ? (
                          <Link
                            to={`/collections/activities/native_collection/${encodeURIComponent(form.id)}`}
                          >
                            编辑页面 · 动态与复盘
                          </Link>
                        ) : null}
                      </div>
                    </article>
                  ))}
              </div>
            ) : (
              <p className="activity-muted">还没有创建报名表单，新的草稿会保留在这里。</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
