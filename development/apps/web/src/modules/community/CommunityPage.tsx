import { useCallback, useEffect, useState } from 'react';

import type {
  CommunityChannel,
  CommunityFeedItem,
  CommunityThreadDetail,
  CommunityTrendingPayload,
  CreateCommunityPostInput,
} from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { CommunityPostDialog } from './CommunityPostDialog.js';
import {
  COMMUNITY_CHANNEL_OPTIONS,
  toggleFeedLike,
  wishStatusLabel,
} from './community-view-model.js';

export interface CommunityPageProps {
  client: ApiClient;
  initialPostId?: string;
}

function CommunityCard({
  item,
  onOpen,
  onLike,
}: {
  item: CommunityFeedItem;
  onOpen: () => void;
  onLike: () => void;
}) {
  return (
    <article className={`community-card community-card--${item.kind}`}>
      <button
        className="community-card__body"
        type="button"
        aria-label={`打开${item.title}`}
        onClick={onOpen}
      >
        <div className="community-card__meta">
          <span className="community-avatar" aria-hidden="true">
            {item.author.mode === 'anonymous' ? '羊' : item.author.displayName.slice(0, 1)}
          </span>
          <span>
            <strong>{item.author.displayName}</strong>
            <small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small>
          </span>
          {item.wishStatus ? (
            <span className="community-status">{wishStatusLabel(item.wishStatus)}</span>
          ) : null}
        </div>
        <h3>{item.title}</h3>
        <p>{item.body}</p>
        <div className="community-tags">
          {item.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        {item.officialResponse ? (
          <blockquote>
            <strong>官方回应</strong>
            {item.officialResponse}
          </blockquote>
        ) : null}
      </button>
      <footer>
        <button type="button" className={item.likedByViewer ? 'is-active' : ''} onClick={onLike}>
          ♡ {item.likeCount}
        </button>
        <button type="button" onClick={onOpen}>
          回复 {item.commentCount}
        </button>
      </footer>
    </article>
  );
}

export function CommunityPage({ client, initialPostId }: CommunityPageProps) {
  const [channel, setChannel] = useState<CommunityChannel>('all');
  const [items, setItems] = useState<CommunityFeedItem[]>([]);
  const [trending, setTrending] = useState<CommunityTrendingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [detail, setDetail] = useState<CommunityThreadDetail | null>(null);
  const [reply, setReply] = useState('');
  const [replyMode, setReplyMode] = useState<'named' | 'anonymous'>('named');
  const [supplement, setSupplement] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [officialResponse, setOfficialResponse] = useState('');
  const [conversionOpen, setConversionOpen] = useState(false);
  const [conversionTitle, setConversionTitle] = useState('');
  const [conversionDescription, setConversionDescription] = useState('');

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await client.request<CommunityFeedItem[]>(`/community/feed?channel=${channel}`));
      setError('');
    } catch {
      setError('广场内容暂时无法加载，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [channel, client]);

  const loadTrending = useCallback(async () => {
    if (document.hidden) return;
    try {
      setTrending(await client.request<CommunityTrendingPayload>('/community/trending'));
    } catch {
      /* stale list stays visible */
    }
  }, [client]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);
  useEffect(() => {
    void loadTrending();
    const timer = window.setInterval(() => void loadTrending(), 30_000);
    const visible = () => {
      if (!document.hidden) void loadTrending();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [loadTrending]);

  async function createPost(input: CreateCommunityPostInput) {
    await client.request('/community/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    await loadFeed();
  }

  async function toggleLike(item: CommunityFeedItem) {
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? toggleFeedLike(candidate) : candidate,
      ),
    );
    try {
      await client.request(`/community/targets/post/${item.id}/like`, {
        method: item.likedByViewer ? 'DELETE' : 'PUT',
      });
    } catch {
      setItems((current) =>
        current.map((candidate) => (candidate.id === item.id ? item : candidate)),
      );
      setError('点赞状态未能保存，请重试。');
    }
  }

  const openThreadById = useCallback(
    async (postId: string) => {
      try {
        const next = await client.request<CommunityThreadDetail>(`/community/posts/${postId}`);
        setDetail(next);
        setOfficialResponse(next.item.officialResponse ?? '');
        setReplyMode('named');
        setReportOpen(false);
        void client
          .request(`/community/posts/${postId}/views`, { method: 'POST' })
          .catch(() => undefined);
      } catch {
        setError('帖子详情暂时无法打开。');
      }
    },
    [client],
  );

  useEffect(() => {
    if (initialPostId) void openThreadById(initialPostId);
  }, [initialPostId, openThreadById]);

  async function openThread(item: CommunityFeedItem) {
    await openThreadById(item.id);
  }

  async function refreshDetail(postId: string) {
    const next = await client.request<CommunityThreadDetail>(`/community/posts/${postId}`);
    setDetail(next);
    setItems((current) => current.map((item) => (item.id === postId ? next.item : item)));
  }

  async function submitReply(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || !reply.trim()) return;
    await client.request(`/community/posts/${detail.item.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: reply.trim(), parentId: null, displayMode: replyMode }),
    });
    setReply('');
    await refreshDetail(detail.item.id);
  }

  async function submitSupplement(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || !supplement.trim()) return;
    await client.request(`/community/posts/${detail.item.id}/supplements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: supplement.trim() }),
    });
    setSupplement('');
    await refreshDetail(detail.item.id);
  }

  async function submitReport(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || !reportReason.trim()) return;
    await client.request(`/community/posts/${detail.item.id}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reportReason.trim() }),
    });
    setReportOpen(false);
    setReportReason('');
  }

  async function submitOfficialResponse(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || !officialResponse.trim()) return;
    await client.request(`/community/wishes/${detail.item.id}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: officialResponse.trim() }),
    });
    await refreshDetail(detail.item.id);
  }

  async function transition(to: 'collecting' | 'responded' | 'planning' | 'realized') {
    if (!detail) return;
    await client.request(`/community/wishes/${detail.item.id}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to }),
    });
    await refreshDetail(detail.item.id);
  }

  async function requestConversion(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    await client.request(`/community/wishes/${detail.item.id}/conversion-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: conversionTitle.trim(),
        description: conversionDescription.trim(),
        organizationId: 'tuanwei',
        startsAt: null,
      }),
    });
    setConversionOpen(false);
    await refreshDetail(detail.item.id);
  }

  async function approveConversion() {
    if (!detail) return;
    await client.request(`/community/wishes/${detail.item.id}/conversion-requests/approve`, {
      method: 'POST',
    });
    await refreshDetail(detail.item.id);
  }

  return (
    <section className="community-page" aria-labelledby="community-title">
      <header className="community-hero">
        <div>
          <p className="community-eyebrow">OPEN CAMPUS SQUARE</p>
          <h1 id="community-title">無界广场</h1>
          <p>聊聊校园里的小事，也让一个愿望慢慢长成真实活动。</p>
        </div>
        <button className="community-primary" type="button" onClick={() => setComposerOpen(true)}>
          发布新内容
        </button>
      </header>
      <nav className="community-channels" role="tablist" aria-label="广场分区">
        {COMMUNITY_CHANNEL_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={channel === option.value}
            onClick={() => setChannel(option.value)}
          >
            {option.label}
          </button>
        ))}
      </nav>
      {error ? (
        <p className="community-alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="community-layout">
        <main className="community-feed" aria-live="polite">
          {loading ? <p className="community-empty">正在收集广场上的新鲜事…</p> : null}
          {!loading && items.length === 0 ? (
            <p className="community-empty">这个分区还没有内容，来写下第一条吧。</p>
          ) : null}
          {items.map((item) => (
            <CommunityCard
              key={item.id}
              item={item}
              onOpen={() => void openThread(item)}
              onLike={() => void toggleLike(item)}
            />
          ))}
        </main>
        <aside className="community-trending" aria-labelledby="community-trending-title">
          <div>
            <p className="community-eyebrow">NOW TRENDING</p>
            <h2 id="community-trending-title">实时热榜</h2>
          </div>
          <ol>
            {trending?.items.map((item, index) => (
              <li key={item.postId}>
                <button
                  type="button"
                  onClick={() => {
                    void openThreadById(item.postId);
                  }}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{item.title}</strong>
                </button>
              </li>
            ))}
          </ol>
          <small>
            {trending
              ? `${new Date(trending.generatedAt).toLocaleTimeString('zh-CN')} 更新`
              : '正在计算热度…'}
          </small>
        </aside>
      </div>
      {composerOpen ? (
        <CommunityPostDialog
          initialKind={channel === 'wishes' ? 'wish' : 'daily'}
          onClose={() => setComposerOpen(false)}
          onSubmit={createPost}
        />
      ) : null}
      {detail ? (
        <div className="community-dialog-backdrop" role="presentation">
          <section
            className="community-dialog community-thread"
            role="dialog"
            aria-modal="true"
            aria-labelledby="community-thread-title"
          >
            <header>
              <div>
                <p className="community-eyebrow">{detail.item.tags[0]}</p>
                <h2 id="community-thread-title">{detail.item.title}</h2>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setDetail(null)}>
                ×
              </button>
            </header>
            <div className="community-thread__content">
              <p>{detail.item.body}</p>
              {detail.supplements.map((item) => (
                <aside key={item.id}>
                  <strong>作者补充</strong>
                  {item.body}
                </aside>
              ))}
              {detail.item.capabilities.canSupplement ? (
                <form
                  className="community-supplement-form"
                  onSubmit={(event) => void submitSupplement(event)}
                >
                  <label>
                    作者补充
                    <textarea
                      value={supplement}
                      maxLength={10_000}
                      onChange={(event) => setSupplement(event.target.value)}
                      required
                    />
                  </label>
                  <button type="submit">发布补充</button>
                </form>
              ) : null}
              {detail.item.capabilities.canReport ? (
                <div className="community-report">
                  <button type="button" onClick={() => setReportOpen((open) => !open)}>
                    举报帖子
                  </button>
                  {reportOpen ? (
                    <form onSubmit={(event) => void submitReport(event)}>
                      <label>
                        举报理由
                        <textarea
                          value={reportReason}
                          maxLength={500}
                          onChange={(event) => setReportReason(event.target.value)}
                          required
                        />
                      </label>
                      <button type="submit">提交举报</button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </div>
            {detail.item.kind === 'wish' ? (
              <section className="community-workflow">
                <div className="community-workflow__status">
                  <span>当前进度</span>
                  <strong>
                    {detail.item.wishStatus ? wishStatusLabel(detail.item.wishStatus) : '征集中'}
                  </strong>
                  {detail.item.linkedActivityId ? (
                    <a href={`/development/events/${detail.item.linkedActivityId}`}>查看活动草稿</a>
                  ) : null}
                </div>
                {detail.item.capabilities.canRespondToWish ? (
                  <form onSubmit={(event) => void submitOfficialResponse(event)}>
                    <label>
                      官方回应
                      <textarea
                        value={officialResponse}
                        onChange={(event) => setOfficialResponse(event.target.value)}
                        required
                      />
                    </label>
                    <button type="submit">发布官方回应</button>
                  </form>
                ) : null}
                {detail.item.capabilities.canTransitionWish ? (
                  <div className="community-workflow__actions">
                    <button type="button" onClick={() => void transition('planning')}>
                      进入筹备
                    </button>
                    <button type="button" onClick={() => void transition('realized')}>
                      标记已实现
                    </button>
                  </div>
                ) : null}
                {detail.item.capabilities.canRequestConversion &&
                detail.item.conversionStatus === 'none' ? (
                  <button type="button" onClick={() => setConversionOpen(true)}>
                    准备转为活动
                  </button>
                ) : null}
                {detail.item.capabilities.canApproveConversion &&
                detail.item.conversionStatus === 'requested' ? (
                  <button
                    className="community-primary"
                    type="button"
                    onClick={() => void approveConversion()}
                  >
                    批准转为活动草稿
                  </button>
                ) : null}
                {conversionOpen ? (
                  <form onSubmit={(event) => void requestConversion(event)}>
                    <label>
                      活动名称
                      <input
                        value={conversionTitle}
                        onChange={(event) => setConversionTitle(event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      活动简介
                      <textarea
                        value={conversionDescription}
                        onChange={(event) => setConversionDescription(event.target.value)}
                        required
                      />
                    </label>
                    <button type="submit">提交转换申请</button>
                  </form>
                ) : null}
              </section>
            ) : null}
            <section className="community-comments">
              <h3>讨论</h3>
              {detail.comments.length === 0 ? (
                <p>还没有回复。</p>
              ) : (
                detail.comments.map((comment) => (
                  <article key={comment.id}>
                    <strong>{comment.author.displayName}</strong>
                    <p>{comment.body}</p>
                  </article>
                ))
              )}
              {detail.item.capabilities.canComment ? (
                <form onSubmit={(event) => void submitReply(event)}>
                  <fieldset className="community-reply-mode">
                    <legend>回复身份</legend>
                    <label>
                      <input
                        type="radio"
                        name="reply-mode"
                        checked={replyMode === 'named'}
                        onChange={() => setReplyMode('named')}
                      />
                      实名回复
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="reply-mode"
                        checked={replyMode === 'anonymous'}
                        onChange={() => setReplyMode('anonymous')}
                      />
                      匿名回复
                    </label>
                  </fieldset>
                  <label>
                    写下回复
                    <textarea
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      required
                    />
                  </label>
                  <button type="submit">发送回复</button>
                </form>
              ) : null}
            </section>
          </section>
        </div>
      ) : null}
    </section>
  );
}
