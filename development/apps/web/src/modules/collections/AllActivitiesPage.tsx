import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RegistrationSource, UnifiedRegistration } from '@freebbs-development/contracts';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import { activityDate, activityState, sortActivities } from './activity-lifecycle.js';
import { Bookmark } from './ActivityPage.js';
import { loadRegistrationCatalog, sourceLabels } from './source-adapters.js';
import '../../styles/activity-workspace.css';

export interface AllActivitiesPageProps {
  client?: Pick<ApiClient, 'request'>;
}
const filters = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '正在报名' },
  { key: 'upcoming', label: '预告' },
  { key: 'ended', label: '已结束' },
] as const;
export function AllActivitiesPage({ client }: AllActivitiesPageProps) {
  const defaultClient = useMemo(createApiClient, []);
  const auth = useOptionalAuth();
  const api = client ?? auth?.client ?? defaultClient;
  const identity = auth?.user?.uid ?? '';
  const [items, setItems] = useState<UnifiedRegistration[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [learningUnavailable, setLearningUnavailable] = useState(false);
  const [bookmarkUnavailable, setBookmarkUnavailable] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);
  const [canCreate, setCanCreate] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    setLoading(true);
    setError(null);
    setItems([]);
    setFollowing(new Set());
    setPending(new Set());
    setCanCreate(false);
    setBookmarkUnavailable(false);
    Promise.allSettled([
      loadRegistrationCatalog(api, globalThis.fetch.bind(globalThis), { includePast: true }),
      api.request<Array<{ source: RegistrationSource; activityId: string }>>('/events/following'),
      api.request<{ canCreate: boolean }>('/collections/dashboard'),
    ]).then((results) => {
      if (!active || current !== generation.current) return;
      const [catalog, subscriptions, authoring] = results;
      setCanCreate(authoring.status === 'fulfilled' && authoring.value.canCreate === true);
      if (catalog.status === 'fulfilled') {
        setItems(sortActivities(catalog.value.items));
        setLearningUnavailable(catalog.value.unavailable.length > 0);
      } else setError('活动列表暂时无法加载，请重试。');
      if (subscriptions.status === 'fulfilled')
        setFollowing(
          new Set(subscriptions.value.map((item) => `${item.source}:${item.activityId}`)),
        );
      else setBookmarkUnavailable(true);
      setLoading(false);
    });
    return () => {
      active = false;
      generation.current++;
    };
  }, [api, identity, reload]);
  async function toggle(item: UnifiedRegistration) {
    const key = `${item.source}:${item.id}`;
    if (pending.has(key)) return;
    const current = generation.current;
    setPending((value) => new Set([...value, key]));
    setError(null);
    try {
      const value = await api.request<{ following: boolean }>(
        `/events/workspaces/${item.source}/${encodeURIComponent(item.id)}/following`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ following: !following.has(key) }),
        },
      );
      if (current === generation.current)
        setFollowing((previous) => {
          const next = new Set(previous);
          if (value.following) next.add(key);
          else next.delete(key);
          return next;
        });
    } catch (caught) {
      if (current === generation.current)
        setError(caught instanceof Error ? caught.message : '关注暂时未能保存，请重试。');
    } finally {
      if (current === generation.current)
        setPending((value) => {
          const next = new Set(value);
          next.delete(key);
          return next;
        });
    }
  }
  const visible = items.filter(
    (item) =>
      (filter === 'all' || activityState(item).key === filter) &&
      `${item.title} ${item.description} ${item.organizer}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <main className="activity-catalog collections-page">
      <Link className="activity-back" to="/collections">
        ← 返回萬事屋
      </Link>
      <header className="activity-catalog-heading">
        <div>
          <p className="activity-eyebrow">MEET · JOIN · REMEMBER</p>
          <h1>全部活动</h1>
          <p>从新的相遇，到值得回味的故事。</p>
        </div>
        {canCreate ? (
          <nav className="activity-authoring-actions" aria-label="活动管理入口">
            <Link
              aria-label="创建活动"
              className="activity-action-primary"
              to="/collections/activities/manage?create=1"
            >
              <span aria-hidden="true">＋</span> 创建活动
            </Link>
            <Link to="/collections/activities/manage">管理我的活动</Link>
          </nav>
        ) : null}
      </header>
      <div className="activity-catalog-controls">
        <div className="activity-filters" role="group" aria-label="筛选活动状态">
          {filters.map((option) => (
            <button
              type="button"
              key={option.key}
              aria-pressed={filter === option.key}
              className={filter === option.key ? 'is-selected' : ''}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="activity-search">
          <span className="activity-sr-only">搜索活动</span>
          <input
            type="search"
            placeholder="搜索活动或发起组织"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      {error ? (
        <div className="activity-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            重新加载
          </button>
        </div>
      ) : null}
      {learningUnavailable ? (
        <p className="activity-muted">学习端活动暂时无法连接，其余活动仍可查看。</p>
      ) : null}
      {bookmarkUnavailable ? (
        <p className="activity-muted">关注状态暂时无法加载，稍后刷新再试。</p>
      ) : null}
      {loading ? (
        <p className="activity-empty" role="status">
          正在整理活动…
        </p>
      ) : null}
      <section className="activity-catalog-grid" aria-label="活动列表">
        {!loading && visible.length === 0 ? (
          <p className="activity-empty">暂时没有符合条件的活动。</p>
        ) : null}
        {visible.map((item) => {
          const state = activityState(item);
          const key = `${item.source}:${item.id}`;
          const followed = following.has(key);
          return (
            <article key={key} className={`activity-catalog-card is-${state.key}`}>
              <div className="activity-card-top">
                <span className={`activity-status is-${state.key}`}>{state.label}</span>
                <button
                  className="activity-card-bookmark"
                  type="button"
                  aria-pressed={followed}
                  aria-label={`${followed ? '取消关注' : '关注'}：${item.title}`}
                  disabled={pending.has(key) || bookmarkUnavailable}
                  onClick={() => void toggle(item)}
                >
                  <Bookmark filled={followed} />
                </button>
              </div>
              <Link
                className="activity-card-link"
                to={`/collections/activities/${item.source}/${encodeURIComponent(item.id)}`}
              >
                <span className="activity-card-source">{sourceLabels[item.source]}</span>
                <h2>{item.title}</h2>
                <p>{item.description || '打开活动，了解更多安排。'}</p>
                <div className="activity-card-footer">
                  <div>
                    <span>{activityDate(item.startsAt || item.opensAt)}</span>
                    <small>{item.organizer || '发起组织待公布'}</small>
                  </div>
                  <span className="activity-card-arrow" aria-hidden="true">
                    ↗
                  </span>
                </div>
              </Link>
            </article>
          );
        })}
      </section>
    </main>
  );
}
