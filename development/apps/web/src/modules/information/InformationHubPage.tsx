import { useEffect, useMemo, useState } from 'react';

import type {
  InformationFeedFilter,
  InformationFeedItem,
  InformationReply,
  UserContext,
} from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { InformationFeedCard } from './InformationFeedCard.js';
import { InformationDetailDialog } from './InformationDetailDialog.js';

const filters: Array<{ value: InformationFeedFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'official', label: '官方发布' },
  { value: 'public_feedback', label: '公开反馈' },
  { value: 'mine', label: '我的咨询' },
  { value: 'in_progress', label: '处理中' },
  { value: 'resolved', label: '已解决' },
];

export interface InformationHubPageProps {
  client: ApiClient;
  user: UserContext | null;
}

function canPublish(user: UserContext | null): boolean {
  if (!user) return false;
  if (user.roles.includes('platform.super_admin')) return true;
  return (
    (
      user as UserContext & { policies?: Array<{ action: string; effect?: string }> }
    ).policies?.some(
      (policy) =>
        policy.effect !== 'deny' &&
        (policy.action === '*' || policy.action === 'information.announcement.create'),
    ) ?? false
  );
}

export function InformationHubPage({ client, user }: InformationHubPageProps) {
  const [filter, setFilter] = useState<InformationFeedFilter>('all');
  const [items, setItems] = useState<InformationFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<'feedback' | 'announcement'>('feedback');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [detail, setDetail] = useState<{
    item: InformationFeedItem;
    replies: InformationReply[];
  } | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void client
      .request<InformationFeedItem[]>(`/information/feed?filter=${filter}`)
      .then((result) => {
        if (current) setItems(result);
      })
      .catch(() => {
        if (current) setError('信息暂时无法加载，请稍后重试。');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [client, filter]);

  const counts = useMemo(
    () => ({
      open: items.filter((item) => item.kind === 'consultation' && item.status === 'open').length,
      progress: items.filter(
        (item) => item.kind === 'consultation' && item.status === 'in_progress',
      ).length,
      resolved: items.filter(
        (item) => item.kind === 'consultation' && ['resolved', 'closed'].includes(item.status),
      ).length,
    }),
    [items],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setPending(true);
    setError('');
    try {
      if (composerMode === 'announcement') {
        const created = await client.request<{ id: string }>('/information/announcements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            body: body.trim(),
            status: 'draft',
            scope: { type: 'public', id: '*' },
          }),
        });
        await client.request(`/information/announcements/${created.id}/transitions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'published' }),
        });
      } else {
        await client.request('/information/consultations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), body: body.trim(), visibility }),
        });
      }
      const next = await client.request<InformationFeedItem[]>(
        `/information/feed?filter=${filter}`,
      );
      setItems(next);
      setTitle('');
      setBody('');
      setVisibility('private');
      setComposerOpen(false);
    } catch {
      setError('提交失败，请检查内容后重试。');
    } finally {
      setPending(false);
    }
  }

  async function toggleLike(item: InformationFeedItem) {
    const nextLiked = !item.likedByViewer;
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id && candidate.kind === item.kind
          ? {
              ...candidate,
              likedByViewer: nextLiked,
              likeCount: candidate.likeCount + (nextLiked ? 1 : -1),
            }
          : candidate,
      ),
    );
    try {
      await client.request(`/information/feed/${item.kind}/${item.id}/like`, {
        method: nextLiked ? 'PUT' : 'DELETE',
      });
    } catch {
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id && candidate.kind === item.kind ? item : candidate,
        ),
      );
      setError('赞同状态未能保存，请重试。');
    }
  }

  async function openDetail(item: InformationFeedItem) {
    try {
      setDetail(
        await client.request<{ item: InformationFeedItem; replies: InformationReply[] }>(
          `/information/feed/${item.kind}/${item.id}`,
        ),
      );
    } catch {
      setError('详情暂时无法打开，请重试。');
    }
  }

  return (
    <section className="information-hub" aria-labelledby="information-hub-title">
      <header className="information-hero">
        <div>
          <p className="information-eyebrow">CAMPUS DESK · 校园信息台</p>
          <h2 id="information-hub-title">信息与咨询</h2>
          <p>查看正式通知，也让每一条反馈都获得清晰回应。</p>
        </div>
        <div className="information-hero__actions">
          <button
            className="information-primary-action"
            type="button"
            onClick={() => {
              setComposerMode('feedback');
              setComposerOpen(true);
            }}
          >
            提交反馈
          </button>
          {canPublish(user) ? (
            <button
              type="button"
              onClick={() => {
                setComposerMode('announcement');
                setComposerOpen(true);
              }}
            >
              发布信息
            </button>
          ) : null}
        </div>
      </header>

      <nav className="information-filters" aria-label="信息筛选" role="tablist">
        {filters.map((option) => (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
        <a href="/development/information/proposals">提案池 ↗</a>
      </nav>

      {error ? (
        <p className="information-alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="information-layout">
        <main className="information-feed" aria-live="polite">
          {loading ? <p className="information-empty">正在整理信息…</p> : null}
          {!loading && items.length === 0 ? (
            <p className="information-empty">这个分类暂时还没有内容。</p>
          ) : null}
          {items.map((item) => (
            <InformationFeedCard
              key={`${item.kind}-${item.id}`}
              item={item}
              onOpen={(target) => void openDetail(target)}
              onToggleLike={(target) => void toggleLike(target)}
            />
          ))}
        </main>
        <aside className="information-status-rail" aria-label="反馈处理概览">
          <div>
            <span>待回应</span>
            <strong>{counts.open}</strong>
          </div>
          <div>
            <span>处理中</span>
            <strong>{counts.progress}</strong>
          </div>
          <div>
            <span>已解决</span>
            <strong>{counts.resolved}</strong>
          </div>
          <p>状态由负责同学持续更新。私密咨询不会出现在其他同学的信息流中。</p>
        </aside>
      </div>

      {composerOpen ? (
        <div
          className="information-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setComposerOpen(false);
          }}
        >
          <section
            className="information-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-dialog-title"
          >
            <header>
              <div>
                <p className="information-eyebrow">
                  {composerMode === 'announcement' ? 'OFFICIAL POST' : 'NEW MESSAGE'}
                </p>
                <h3 id="feedback-dialog-title">
                  {composerMode === 'announcement' ? '发布官方信息' : '提交反馈或咨询'}
                </h3>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setComposerOpen(false)}>
                ×
              </button>
            </header>
            <form onSubmit={(event) => void submit(event)}>
              {composerMode === 'feedback' ? (
                <>
                  <fieldset>
                    <legend>谁可以看到</legend>
                    <label>
                      <input
                        type="radio"
                        name="visibility"
                        checked={visibility === 'private'}
                        onChange={() => setVisibility('private')}
                      />{' '}
                      私密咨询
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="visibility"
                        checked={visibility === 'public'}
                        onChange={() => setVisibility('public')}
                      />{' '}
                      公开反馈
                    </label>
                  </fieldset>
                  <p className="information-privacy-hint">
                    {visibility === 'private'
                      ? '🔒 仅你与负责处理的同学可见'
                      : '公开后，其他同学可以回复和赞同。'}
                  </p>
                </>
              ) : (
                <p className="information-privacy-hint">
                  发布后将以官方信息样式出现在所有同学的信息流中。
                </p>
              )}
              <label>
                标题
                <input
                  value={title}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                />
              </label>
              <label>
                内容
                <textarea
                  value={body}
                  maxLength={20000}
                  rows={7}
                  onChange={(event) => setBody(event.target.value)}
                  required
                />
              </label>
              <footer>
                <button type="button" onClick={() => setComposerOpen(false)}>
                  取消
                </button>
                <button className="information-primary-action" type="submit" disabled={pending}>
                  {pending
                    ? '正在提交…'
                    : composerMode === 'announcement'
                      ? '确认发布'
                      : '发布反馈'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
      {detail ? (
        <InformationDetailDialog
          client={client}
          item={detail.item}
          initialReplies={detail.replies}
          user={user}
          onClose={() => setDetail(null)}
          onReplyCreated={() => {
            setItems((current) =>
              current.map((candidate) =>
                candidate.id === detail.item.id && candidate.kind === detail.item.kind
                  ? { ...candidate, replyCount: candidate.replyCount + 1 }
                  : candidate,
              ),
            );
          }}
        />
      ) : null}
    </section>
  );
}
