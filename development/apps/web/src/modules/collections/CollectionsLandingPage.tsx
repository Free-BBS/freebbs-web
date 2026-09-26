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

export interface CollectionsLandingPageProps {
  client?: Pick<ApiClient, 'request'>;
}

const emptyDashboard: CollectionsDashboardPayload = {
  featured: [],
  showcase: [],
  canCreate: false,
};

function FeatureCard({ item }: { item: UnifiedRegistration }) {
  return (
    <Link
      className="collections-belt-card"
      to={`/collections/registrations?focus=${encodeURIComponent(`${item.source}:${item.id}`)}`}
    >
      <span className="collections-source">{sourceLabels[item.source]}</span>
      <strong>{item.title}</strong>
      <span>{formatCollectionDate(item.closesAt)}</span>
    </Link>
  );
}

export function CollectionsLandingPage({ client }: CollectionsLandingPageProps) {
  const defaultClient = useMemo(createApiClient, []);
  const api = client ?? defaultClient;
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [boardOpen, setBoardOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
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
  }, [api]);

  useEffect(() => {
    if (!boardOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBoardOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [boardOpen]);

  const features =
    dashboard.featured.length > 0
      ? dashboard.featured
      : ([
          {
            id: 'preview-1',
            source: 'native_collection',
            title: '秋季工作坊许愿池',
            description: '',
            organizer: '',
            coverUrl: null,
            opensAt: null,
            closesAt: null,
            location: null,
            capacity: null,
            registrationCount: null,
            registered: false,
            status: 'open',
          },
          {
            id: 'preview-2',
            source: 'development_activity',
            title: '本周校园活动',
            description: '',
            organizer: '',
            coverUrl: null,
            opensAt: null,
            closesAt: null,
            location: null,
            capacity: null,
            registrationCount: null,
            registered: false,
            status: 'open',
          },
          {
            id: 'preview-3',
            source: 'learning_survey',
            title: '讲座与交流报名',
            description: '',
            organizer: '',
            coverUrl: null,
            opensAt: null,
            closesAt: null,
            location: null,
            capacity: null,
            registrationCount: null,
            registered: false,
            status: 'open',
          },
        ] satisfies UnifiedRegistration[]);
  const beltItems = [...features, ...features];

  return (
    <main className={`collections-page${boardOpen ? ' is-board-open' : ''}`}>
      <header className="collections-heading">
        <div>
          <p className="collections-eyebrow">COLLECT · SHARE · BEGIN</p>
          <h1>萬事集</h1>
          <p>把分散的报名、作品和想法收在一处。挑一张卡片，看看今天有什么值得参与。</p>
        </div>
        <Link className="collections-wallet" to="/collections/mine" aria-label="我的报名">
          <span aria-hidden="true">⌑</span>
          <span>我的报名</span>
        </Link>
      </header>

      <section className="collections-belt-section" aria-labelledby="collections-featured-title">
        <div className="collections-section-title">
          <div>
            <span>正在传送</span>
            <h2 id="collections-featured-title">最近开放</h2>
          </div>
          <Link to="/collections/registrations">查看全部</Link>
        </div>
        <div className="collections-belt-viewport">
          <div className="collections-belt-track">
            {beltItems.map((item, index) => (
              <FeatureCard key={`${item.source}:${item.id}:${index}`} item={item} />
            ))}
          </div>
        </div>
        {state === 'error' ? (
          <p className="collections-inline-note">部分报名源暂时没有连接，已保留可用内容。</p>
        ) : null}
      </section>

      <section className="collections-tavern" aria-label="萬事集告示板">
        <img src={collectionKeeper} alt="小羊酒保站在贴满告示的木板旁" />
        <div className="collections-board-copy">
          <span>今日告示</span>
          <strong>每张纸，都可能是一件新鲜事的开始</strong>
          <button type="button" onClick={() => setBoardOpen(true)}>
            走近看看
          </button>
        </div>
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
                  <small>用积木搭出新的收集</small>
                </Link>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
