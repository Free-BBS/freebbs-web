import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import type {
  CollectionsDashboardPayload,
  UnifiedRegistration,
} from '@freebbs-development/contracts';
import collectionKeeper from '../../assets/collections/sheep-collection-keeper.webp';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import { formatCollectionDate } from './collection-utils.js';
import { sourceLabels } from './source-adapters.js';
import { FreeBbsMapAction } from '../discovery/FreeBbsMapAction.js';

export interface CollectionsLandingPageProps {
  client?: Pick<ApiClient, 'request'>;
}

const emptyDashboard: CollectionsDashboardPayload = {
  featured: [],
  showcase: [],
  canCreate: false,
};
const registrationStatusLabels: Record<UnifiedRegistration['status'], string> = {
  open: '开放中',
  upcoming: '即将开放',
  closed: '已结束',
};

function FeatureCard({
  item,
  duplicate = false,
}: {
  item: UnifiedRegistration;
  duplicate?: boolean;
}) {
  return (
    <Link
      className="collections-belt-card"
      aria-hidden={duplicate || undefined}
      tabIndex={duplicate ? -1 : undefined}
      to={`/collections/activities/${item.source}/${encodeURIComponent(item.id)}`}
    >
      <div className="collections-card-meta">
        <span className="collections-source">{sourceLabels[item.source]}</span>
        <span>{registrationStatusLabels[item.status]}</span>
      </div>
      <h3>{item.title}</h3>
      <p>{item.description || item.organizer || '走进活动，发现新的相遇。'}</p>
      <footer>
        <span>{formatCollectionDate(item.closesAt)}</span>
        <span aria-hidden="true">↗</span>
      </footer>
    </Link>
  );
}

export function CollectionsLandingPage({ client }: CollectionsLandingPageProps) {
  const defaultClient = useMemo(createApiClient, []);
  const api = client ?? defaultClient;
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadRevision, setLoadRevision] = useState(0);
  const [boardOpen, setBoardOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const boardRef = useRef<HTMLElement>(null);
  const boardTrigger = useRef<HTMLButtonElement | null>(null);

  function openBoard(trigger: HTMLButtonElement) {
    boardTrigger.current = trigger;
    setBoardOpen(true);
  }

  useEffect(() => {
    let active = true;
    setState('loading');
    api.request<CollectionsDashboardPayload>('/collections/dashboard').then(
      (value) => {
        if (active) {
          setDashboard(value);
          setState('ready');
        }
      },
      () => {
        if (active) setState('error');
      },
    );
    return () => {
      active = false;
    };
  }, [api, loadRevision]);

  useEffect(() => {
    if (!boardOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBoardOpen(false);
      if (event.key === 'Tab') {
        const controls = boardRef.current?.querySelectorAll<HTMLElement>('button, a[href]');
        const first = controls?.[0];
        const last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
      if (boardTrigger.current?.isConnected) boardTrigger.current.focus();
    };
  }, [boardOpen]);

  const features = dashboard.featured;
  const beltItems = [...features, ...features];

  return (
    <main className={`collections-page collections-landing${boardOpen ? ' is-board-open' : ''}`}>
      <header className="collections-heading">
        <div>
          <p className="collections-eyebrow">相遇 · 参与 · 留下故事</p>
          <h1>萬事屋</h1>
          <p>校园里的大小事，都从这里开始。</p>
        </div>
        <div className="collections-heading-actions">
          <FreeBbsMapAction />
          <Link className="collections-activity-link" to="/collections/activities">
            全部活动
          </Link>
          <Link className="collections-wallet" to="/collections/mine" aria-label="我的报名">
            <span aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M4 7V5a2 2 0 0 1 2-2h12v4M4 7h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
                <path d="M21 11h-5v6h5" />
                <circle cx="18" cy="14" r=".8" />
              </svg>
            </span>
            <span>我的报名</span>
          </Link>
        </div>
      </header>

      <section className="collections-belt-section" aria-labelledby="collections-featured-title">
        <div className="collections-section-title">
          <div>
            <span>校园正在发生</span>
            <h2 id="collections-featured-title">最近开放</h2>
          </div>
          <Link to="/collections/activities">查看全部</Link>
        </div>
        {features.length > 0 ? (
          <div className="collections-belt-viewport">
            <div className="collections-belt-track">
              {beltItems.map((item, index) => (
                <FeatureCard
                  key={`${item.source}:${item.id}:${index}`}
                  item={item}
                  duplicate={index >= features.length}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="collections-belt-empty">
            <span aria-hidden="true">✦</span>
            <div>
              <h3>
                {state === 'loading'
                  ? '正在加载活动…'
                  : state === 'error'
                    ? '活动暂时无法加载'
                    : '暂无开放活动'}
              </h3>
              <p>下一次相遇，正在准备。也可以去报名入口看看。</p>
            </div>
            <Link to="/collections/registrations">
              浏览报名入口 <span aria-hidden="true">↗</span>
            </Link>
          </div>
        )}
        {state === 'error' ? (
          <p className="collections-inline-note" role="status">
            活动信息暂时没有连接。
            <button type="button" onClick={() => setLoadRevision((value) => value + 1)}>
              重新加载
            </button>
          </p>
        ) : null}
      </section>

      <section className="collections-tavern" aria-label="萬事屋告示板">
        <div className="collections-board-copy">
          <span>告示已备好</span>
          <h2>把好奇，变成下一次参与</h2>
          <p>报名一场活动，读一篇校园故事，或发起自己的收集。小羊已经替你把告示整理好了。</p>
          <button type="button" onClick={(event) => openBoard(event.currentTarget)}>
            走近看看
          </button>
        </div>
        <button
          className="collections-tavern-art"
          type="button"
          aria-label="打开告示板"
          onClick={(event) => openBoard(event.currentTarget)}
        >
          <img src={collectionKeeper} alt="小羊酒保站在贴满告示的木板旁" />
        </button>
      </section>

      {boardOpen ? (
        <div
          className="collections-board-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setBoardOpen(false);
          }}
        >
          <section
            ref={boardRef}
            className="collections-board-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="collections-board-title"
          >
            <button
              ref={closeRef}
              className="collections-dialog-close"
              type="button"
              aria-label="关闭告示板"
              onClick={() => setBoardOpen(false)}
            >
              ×
            </button>
            <p>NOTICE BOARD</p>
            <h2 id="collections-board-title">今天想从哪里开始？</h2>
            <div className="collections-board-actions">
              <Link to="/collections/registrations">
                <span>01</span>
                <strong>报名入口</strong>
                <small>浏览全部活动与收集</small>
              </Link>
              <Link to="/collections/showcase">
                <span>02</span>
                <strong>内容橱窗</strong>
                <small>读一篇来自校园的故事</small>
              </Link>
              {dashboard.canCreate ? (
                <Link to="/collections/workbench/new">
                  <span>03</span>
                  <strong>创建表单</strong>
                  <small>定义你的表单</small>
                </Link>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
