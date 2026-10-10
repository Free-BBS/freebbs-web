import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  CommunityChannel,
  CommunityFeedItem,
  CommunityThreadDetail,
  CommunityTrendingPayload,
  CreateCommunityPostInput,
} from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { CommunityPostDialog } from './CommunityPostDialog.js';
import { CommunityIcon } from './CommunityIcon.js';
import { CommunityFestivalFeed } from './CommunityFestivalFeed.js';
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
  likePending,
}: {
  item: CommunityFeedItem;
  onOpen: () => void;
  onLike: () => void;
  likePending: boolean;
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
            {item.author.avatarUrl && item.author.mode === 'named' ? (
              <img src={item.author.avatarUrl} alt="" />
            ) : item.author.mode === 'anonymous' ? (
              '羊'
            ) : (
              item.author.displayName.slice(0, 1)
            )}
          </span>
          <span>
            <strong>{item.author.displayName}</strong>
            <small>
              <time dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>{' '}
              · {item.tags[0]}
            </small>
          </span>
          {item.wishStatus ? (
            <span className="community-status">{wishStatusLabel(item.wishStatus)}</span>
          ) : null}
        </div>
        <h3>{item.title}</h3>
        <p>{item.body}</p>
        <div className="community-tags">
          {item.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
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
        <button
          type="button"
          aria-label={`赞 ${item.likeCount}`}
          aria-pressed={item.likedByViewer}
          disabled={likePending}
          className={item.likedByViewer ? 'is-active' : ''}
          onClick={onLike}
        >
          <CommunityIcon name="heart" />
          <span>赞</span>
          <span className="community-number">{item.likeCount}</span>
        </button>
        <button type="button" onClick={onOpen}>
          <CommunityIcon name="reply" />
          <span>回复</span>
          <span className="community-number">{item.commentCount}</span>
        </button>
        <button type="button" onClick={onOpen}>
          <span>查看讨论</span>
          <CommunityIcon name="arrow" />
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
  const [composerKind, setComposerKind] = useState<'daily' | 'wish'>('daily');
  const composerRef = useRef<HTMLDivElement>(null);
  const [likesPending, setLikesPending] = useState<Set<string>>(new Set());
  const likesInFlight = useRef(new Set<string>());
  const feedRequest = useRef(0);
  const threadRequest = useRef(0);
  const [mutationPending, setMutationPending] = useState(false);
  const mutationInFlight = useRef(false);
  const [mutationError, setMutationError] = useState('');
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
    const requestId = ++feedRequest.current;
    setLoading(true);
    try {
      const nextItems = await client.request<CommunityFeedItem[]>(
        `/community/feed?channel=${channel}`,
      );
      if (requestId !== feedRequest.current) return;
      setItems(nextItems);
      setError('');
    } catch {
      if (requestId === feedRequest.current) setError('广场内容暂时无法加载，请稍后重试。');
    } finally {
      if (requestId === feedRequest.current) setLoading(false);
    }
  }, [channel, client]);
  const latestLoadFeed = useRef(loadFeed);

  const loadTrending = useCallback(async () => {
    if (document.hidden) return;
    try {
      setTrending(await client.request<CommunityTrendingPayload>('/community/trending'));
    } catch {
      /* stale list stays visible */
    }
  }, [client]);

  useEffect(() => {
    latestLoadFeed.current = loadFeed;
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
    await latestLoadFeed.current();
  }

  async function toggleLike(item: CommunityFeedItem) {
    if (likesInFlight.current.has(item.id)) return;
    likesInFlight.current.add(item.id);
    setLikesPending(new Set(likesInFlight.current));
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? toggleFeedLike(candidate) : candidate,
      ),
    );
    try {
      await client.request(`/community/targets/post/${item.id}/like`, {
        method: item.likedByViewer ? 'DELETE' : 'PUT',
      });
      setError('');
    } catch {
      setItems((current) =>
        current.map((candidate) => (candidate.id === item.id ? item : candidate)),
      );
      setError('点赞状态未能保存，请重试。');
    } finally {
      likesInFlight.current.delete(item.id);
      setLikesPending(new Set(likesInFlight.current));
    }
  }

  const openThreadById = useCallback(
    async (postId: string) => {
      if (mutationInFlight.current) return;
      const requestId = ++threadRequest.current;
      try {
        const next = await client.request<CommunityThreadDetail>(`/community/posts/${postId}`);
        if (requestId !== threadRequest.current || mutationInFlight.current) return;
        setDetail(next);
        setOfficialResponse(next.item.officialResponse ?? '');
        setReplyMode('named');
        setReportOpen(false);
        setMutationError('');
        setReply('');
        setSupplement('');
        setReportReason('');
        setConversionOpen(false);
        setConversionTitle('');
        setConversionDescription('');
        void client
          .request(`/community/posts/${postId}/views`, { method: 'POST' })
          .catch(() => undefined);
      } catch {
        if (requestId === threadRequest.current) setError('帖子详情暂时无法打开。');
      }
    },
    [client],
  );

  useEffect(() => {
    if (initialPostId) void openThreadById(initialPostId);
    return () => {
      threadRequest.current++;
    };
  }, [initialPostId, openThreadById]);

  async function openThread(item: CommunityFeedItem) {
    await openThreadById(item.id);
  }

  async function refreshDetail(postId: string) {
    const requestId = threadRequest.current;
    const next = await client.request<CommunityThreadDetail>(`/community/posts/${postId}`);
    if (requestId !== threadRequest.current) return;
    setDetail((current) => (current?.item.id === postId ? next : current));
    setItems((current) => current.map((item) => (item.id === postId ? next.item : item)));
  }

  async function mutateThread(
    operation: () => Promise<unknown>,
    afterSave?: () => void,
    refresh = true,
  ) {
    if (!detail || mutationInFlight.current) return;
    const postId = detail.item.id;
    threadRequest.current++;
    mutationInFlight.current = true;
    setMutationPending(true);
    setMutationError('');
    try {
      await operation();
      afterSave?.();
      if (refresh) {
        try {
          await refreshDetail(postId);
        } catch {
          setMutationError('操作已保存，详情暂时无法更新，请重新打开帖子查看。');
        }
      }
    } catch {
      setMutationError('操作失败，填写的内容已保留，请稍后重试。');
    } finally {
      mutationInFlight.current = false;
      setMutationPending(false);
    }
  }

  async function submitReply(event: React.FormEvent) {
    event.preventDefault();
    if (!detail?.item.capabilities.canComment || !reply.trim()) return;
    await mutateThread(
      () =>
        client.request(`/community/posts/${detail.item.id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: reply.trim(), parentId: null, displayMode: replyMode }),
        }),
      () => setReply(''),
    );
  }

  async function submitSupplement(event: React.FormEvent) {
    event.preventDefault();
    if (!detail?.item.capabilities.canSupplement || !supplement.trim()) return;
    await mutateThread(
      () =>
        client.request(`/community/posts/${detail.item.id}/supplements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: supplement.trim() }),
        }),
      () => setSupplement(''),
    );
  }

  async function submitReport(event: React.FormEvent) {
    event.preventDefault();
    if (!detail?.item.capabilities.canReport || !reportReason.trim()) return;
    await mutateThread(
      () =>
        client.request(`/community/posts/${detail.item.id}/reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reportReason.trim() }),
        }),
      () => {
        setReportOpen(false);
        setReportReason('');
      },
      false,
    );
  }

  async function submitOfficialResponse(event: React.FormEvent) {
    event.preventDefault();
    if (!detail?.item.capabilities.canRespondToWish || !officialResponse.trim()) return;
    await mutateThread(() =>
      client.request(`/community/wishes/${detail.item.id}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: officialResponse.trim() }),
      }),
    );
  }

  async function transition(to: 'collecting' | 'responded' | 'planning' | 'realized') {
    if (!detail?.item.capabilities.canTransitionWish) return;
    if (to === 'planning' && detail.item.wishStatus !== 'responded') return;
    if (
      to === 'realized' &&
      (detail.item.wishStatus !== 'planning' || !detail.item.capabilities.canApproveConversion)
    )
      return;
    await mutateThread(() =>
      client.request(`/community/wishes/${detail.item.id}/transitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      }),
    );
  }

  async function requestConversion(event: React.FormEvent) {
    event.preventDefault();
    if (
      !detail?.item.capabilities.canRequestConversion ||
      detail.item.conversionStatus !== 'none' ||
      !conversionTitle.trim() ||
      !conversionDescription.trim()
    )
      return;
    await mutateThread(
      () =>
        client.request(`/community/wishes/${detail.item.id}/conversion-requests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: conversionTitle.trim(),
            description: conversionDescription.trim(),
            organizationId: 'tuanwei',
            startsAt: null,
          }),
        }),
      () => setConversionOpen(false),
    );
  }

  async function approveConversion() {
    if (
      !detail?.item.capabilities.canApproveConversion ||
      detail.item.conversionStatus !== 'requested'
    )
      return;
    await mutateThread(() =>
      client.request(`/community/wishes/${detail.item.id}/conversion-requests/approve`, {
        method: 'POST',
      }),
    );
  }

  return (
    <section className="community-page" aria-labelledby="community-title">
      <header className="community-hero">
        <div>
          <p className="community-eyebrow">OPEN CAMPUS SQUARE</p>
          <h1 id="community-title">無界广场</h1>
          <p>聊聊校园里的小事，也让一个愿望慢慢长成真实活动。</p>
        </div>
        {channel === 'student_festival' ? (
          <a
            className="community-primary community-hero-action"
            href="/development/events/student-festival"
          >
            <CommunityIcon name="stage" />
            我要上电子系春晚
          </a>
        ) : channel === 'rights' ? (
          <a
            className="community-primary community-hero-action"
            href="/development/information/consultations"
          >
            <CommunityIcon name="lock" />
            提交生权反馈
          </a>
        ) : (
          <button
            className="community-primary"
            type="button"
            onClick={() => {
              const titleInput = composerRef.current?.querySelector<HTMLInputElement>(
                'input:not([type="radio"])',
              );
              titleInput?.focus({ preventScroll: true });
            }}
          >
            <CommunityIcon name="pen" />
            发布新内容
          </button>
        )}
      </header>
      <nav className="community-channels" role="tablist" aria-label="广场分区">
        {COMMUNITY_CHANNEL_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={channel === option.value}
            onClick={() => {
              setChannel(option.value);
              if (option.value === 'daily' || option.value === 'wishes')
                setComposerKind(option.value === 'wishes' ? 'wish' : 'daily');
            }}
          >
            {option.label}
          </button>
        ))}
      </nav>
      {error ? (
        <div className="community-alert" role="alert">
          {error}
          <button type="button" onClick={() => void loadFeed()}>
            重新加载
          </button>
        </div>
      ) : null}
      <div className="community-layout">
        <main className="community-feed" aria-live="polite">
          <div ref={composerRef} hidden={channel === 'student_festival' || channel === 'rights'}>
            <CommunityPostDialog
              inline
              initialKind={composerKind}
              onClose={() => undefined}
              onSubmit={createPost}
            />
          </div>
          {channel === 'student_festival' ? (
            <section className="community-channel-note">
              <CommunityIcon name="stage" />
              <div>
                <h2>把舞台留给你的热爱</h2>
                <p>在电子系春晚投稿页提交作品，确认公开展示意愿；审核通过后，作品会出现在这里。</p>
              </div>
            </section>
          ) : null}
          {channel === 'rights' ? (
            <section className="community-channel-note">
              <CommunityIcon name="lock" />
              <div>
                <h2>每一份反馈，都值得被认真回应</h2>
                <p>
                  通过咨询入口提交校园问题，跟进处理进度。个人反馈默认保密，公开范围可在咨询流程中选择。
                </p>
              </div>
            </section>
          ) : null}
          <div className="community-feed-heading">
            <h2>
              {COMMUNITY_CHANNEL_OPTIONS.find((option) => option.value === channel)?.label}动态
            </h2>
            <span>校园里的每一刻</span>
          </div>
          {channel === 'student_festival' ? <CommunityFestivalFeed client={client} /> : null}
          {loading && channel !== 'student_festival' ? (
            <p className="community-empty">正在收集广场上的新鲜事…</p>
          ) : null}
          {!loading &&
          items.length === 0 &&
          channel !== 'rights' &&
          channel !== 'student_festival' ? (
            <p className="community-empty">这个分区还没有内容，来写下第一条吧。</p>
          ) : null}
          {channel !== 'student_festival' &&
            items.map((item) => (
              <CommunityCard
                key={item.id}
                item={item}
                onOpen={() => void openThread(item)}
                onLike={() => void toggleLike(item)}
                likePending={likesPending.has(item.id)}
              />
            ))}
        </main>
        <aside className="community-aside">
          <section className="community-trending" aria-labelledby="community-trending-title">
            <div>
              <p className="community-eyebrow">NOW TRENDING</p>
              <h2 id="community-trending-title">
                <CommunityIcon name="fire" />
                实时热榜
              </h2>
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
            {trending?.items.length === 0 ? (
              <p className="community-trending-empty">新鲜话题正在酝酿，下一条可能就是你。</p>
            ) : null}
            <small>
              {trending
                ? `${new Date(trending.generatedAt).toLocaleTimeString('zh-CN')} 更新`
                : '正在计算热度…'}
            </small>
          </section>
          <section className="community-shortcuts" aria-labelledby="community-shortcuts-title">
            <h2 id="community-shortcuts-title">让想法有回音</h2>
            <a href="/development/events/student-festival">
              <CommunityIcon name="stage" />
              <span>
                <strong>电子系春晚</strong>
                <small>让大家看见你的热爱</small>
              </span>
              <CommunityIcon name="arrow" />
            </a>
            <a href="/development/information/consultations">
              <CommunityIcon name="lock" />
              <span>
                <strong>生权反馈</strong>
                <small>校园问题，认真回应</small>
              </span>
              <CommunityIcon name="arrow" />
            </a>
            <p>分享日常 · 交换想法 · 实现愿望</p>
          </section>
        </aside>
      </div>
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
              <button
                type="button"
                aria-label="关闭"
                disabled={mutationPending}
                onClick={() => {
                  threadRequest.current++;
                  setDetail(null);
                }}
              >
                ×
              </button>
            </header>
            {mutationError ? (
              <p className="community-form-error community-thread-error" role="alert">
                {mutationError}
              </p>
            ) : null}
            {mutationPending ? (
              <p className="community-thread-pending" role="status">
                正在保存…
              </p>
            ) : null}
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
                      disabled={mutationPending}
                      value={supplement}
                      maxLength={10_000}
                      onChange={(event) => setSupplement(event.target.value)}
                      required
                    />
                  </label>
                  <button type="submit" disabled={mutationPending}>
                    发布补充
                  </button>
                </form>
              ) : null}
              {detail.item.capabilities.canReport ? (
                <div className="community-report">
                  <button
                    type="button"
                    disabled={mutationPending}
                    onClick={() => setReportOpen((open) => !open)}
                  >
                    举报帖子
                  </button>
                  {reportOpen ? (
                    <form onSubmit={(event) => void submitReport(event)}>
                      <label>
                        举报理由
                        <textarea
                          disabled={mutationPending}
                          value={reportReason}
                          maxLength={500}
                          onChange={(event) => setReportReason(event.target.value)}
                          required
                        />
                      </label>
                      <button type="submit" disabled={mutationPending}>
                        提交举报
                      </button>
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
                        disabled={mutationPending}
                        value={officialResponse}
                        onChange={(event) => setOfficialResponse(event.target.value)}
                        required
                      />
                    </label>
                    <button type="submit" disabled={mutationPending}>
                      发布官方回应
                    </button>
                  </form>
                ) : null}
                {(detail.item.capabilities.canTransitionWish &&
                  detail.item.wishStatus === 'responded') ||
                (detail.item.capabilities.canTransitionWish &&
                  detail.item.capabilities.canApproveConversion &&
                  detail.item.wishStatus === 'planning') ? (
                  <div className="community-workflow__actions">
                    {detail.item.wishStatus === 'responded' ? (
                      <button
                        type="button"
                        disabled={mutationPending}
                        onClick={() => void transition('planning')}
                      >
                        进入筹备
                      </button>
                    ) : null}
                    {detail.item.wishStatus === 'planning' &&
                    detail.item.capabilities.canApproveConversion ? (
                      <button
                        type="button"
                        disabled={mutationPending}
                        onClick={() => void transition('realized')}
                      >
                        标记已实现
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {detail.item.capabilities.canRequestConversion &&
                detail.item.conversionStatus === 'none' ? (
                  <button
                    type="button"
                    disabled={mutationPending}
                    onClick={() => setConversionOpen(true)}
                  >
                    准备转为活动
                  </button>
                ) : null}
                {detail.item.capabilities.canApproveConversion &&
                detail.item.conversionStatus === 'requested' ? (
                  <button
                    className="community-primary"
                    disabled={mutationPending}
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
                        disabled={mutationPending}
                        value={conversionTitle}
                        onChange={(event) => setConversionTitle(event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      活动简介
                      <textarea
                        disabled={mutationPending}
                        value={conversionDescription}
                        onChange={(event) => setConversionDescription(event.target.value)}
                        required
                      />
                    </label>
                    <button type="submit" disabled={mutationPending}>
                      提交转换申请
                    </button>
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
                        disabled={mutationPending}
                        type="radio"
                        name="reply-mode"
                        checked={replyMode === 'named'}
                        onChange={() => setReplyMode('named')}
                      />
                      实名回复
                    </label>
                    <label>
                      <input
                        disabled={mutationPending}
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
                      disabled={mutationPending}
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      required
                    />
                  </label>
                  <button type="submit" disabled={mutationPending}>
                    发送回复
                  </button>
                </form>
              ) : null}
            </section>
          </section>
        </div>
      ) : null}
    </section>
  );
}
