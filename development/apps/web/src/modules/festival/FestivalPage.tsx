import type { FestivalSubmission, FestivalSubmissionList } from '@freebbs-development/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import type { ApiClient } from '../../core/api/client.js';

type FestivalClient = Pick<ApiClient, 'request' | 'download'>;
type FestivalView = 'showcase' | 'mine' | 'review';
type ReviewDecision = 'approve' | 'reject' | 'unpublish' | 'reapprove';
const base = '/events/festival/submissions';
const statusLabels: Record<FestivalSubmission['status'], string> = {
  private: '私密投稿',
  pending: '待审核',
  approved: '展示中',
  rejected: '未展示',
};
const viewLabels: Record<FestivalView, string> = {
  showcase: '作品展示',
  mine: '我的投稿',
  review: '投稿审核',
};
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请重试';
}
function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${Number((bytes / (1024 * 1024)).toFixed(1))} MiB`
    : `${bytes} 字节`;
}

function FestivalVideo({ item, client }: { item: FestivalSubmission; client: FestivalClient }) {
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resource = useRef<{ controller: AbortController | null; url: string | null }>({
    controller: null,
    url: null,
  });

  useEffect(() => {
    const current = resource.current;
    return () => {
      current.controller?.abort();
      if (current.url) URL.revokeObjectURL(current.url);
    };
  }, []);

  async function loadVideo() {
    resource.current.controller?.abort();
    if (resource.current.url) {
      URL.revokeObjectURL(resource.current.url);
      resource.current.url = null;
    }
    const controller = new AbortController();
    resource.current.controller = controller;
    setSource(null);
    setLoading(true);
    setError(null);
    try {
      const blob = await client.download(`${base}/${encodeURIComponent(item.id)}/media`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      resource.current.url = url;
      setSource(url);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <div className="festival-media">
      {source && !error ? (
        <video
          src={source}
          controls
          preload="none"
          playsInline
          aria-label={`作品视频：${item.title}`}
          onError={() => setError('浏览器暂时无法播放此视频，建议使用 MP4 格式。')}
        />
      ) : (
        <button
          className="festival-video-load"
          type="button"
          disabled={loading}
          onClick={() => void loadVideo()}
          aria-label={`${error ? '重试视频' : '加载视频'}：${item.title}`}
        >
          <span className="festival-play-symbol" aria-hidden="true">
            ▷
          </span>
          <span>
            {loading ? '正在加载视频…' : error ? '重试视频' : '点击加载视频'}
            <small>
              {formatSize(item.sizeBytes)} ·{' '}
              {item.mimeType === 'video/quicktime'
                ? 'MOV'
                : item.mimeType.split('/')[1]?.toUpperCase()}
            </small>
          </span>
        </button>
      )}
      {error && <p role="alert">视频加载失败：{error}</p>}
    </div>
  );
}

function FestivalPost({
  item,
  client,
  review,
  onReviewed,
}: {
  item: FestivalSubmission;
  client: FestivalClient;
  review: boolean;
  onReviewed: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canDecide = review && item.displayConsent && item.status === 'pending';
  const canReapprove = review && item.displayConsent && item.status === 'rejected';
  const canUnpublish = review && item.status === 'approved';

  async function decide(decision: ReviewDecision) {
    setBusy(true);
    setError(null);
    try {
      await client.request(`${base}/${encodeURIComponent(item.id)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: note.trim() }),
      });
      onReviewed();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="festival-post" aria-label={item.title}>
      <header className="festival-post-meta">
        <span className="festival-avatar" aria-hidden="true">
          {item.authorName.slice(0, 1)}
        </span>
        <div>
          <strong>{item.authorName}</strong>
          <time dateTime={item.createdAt}>
            {new Date(item.createdAt).toLocaleString('zh-CN', {
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </div>
        <span className={`festival-status festival-status-${item.status}`}>
          {statusLabels[item.status]}
        </span>
      </header>
      <h4>{item.title}</h4>
      <p className="festival-post-description">{item.description}</p>
      {item.canViewMedia ? (
        <FestivalVideo key={`${item.id}:${item.updatedAt}`} item={item} client={client} />
      ) : (
        <p className="festival-private-note">
          此处仅提供投稿回执；未展示的视频仅授权审核人员可查看。
        </p>
      )}
      {item.reviewNote && <p className="festival-review-note">审核说明：{item.reviewNote}</p>}
      {review && !item.displayConsent && (
        <p className="festival-private-note">作者未同意展示，此作品不可公开展示。</p>
      )}
      {canDecide || canReapprove || canUnpublish ? (
        <div className="festival-review-controls">
          <label>
            审核说明
            <input
              value={note}
              maxLength={1000}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
              placeholder="可填写审核意见"
            />
          </label>
          <div className="festival-action-row">
            {canReapprove && (
              <button type="button" disabled={busy} onClick={() => void decide('reapprove')}>
                重新审核并展示
              </button>
            )}
            {canDecide && (
              <>
                <button type="button" disabled={busy} onClick={() => void decide('approve')}>
                  通过并展示
                </button>
                <button
                  className="festival-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void decide('reject')}
                >
                  不予展示
                </button>
              </>
            )}
            {canUnpublish && (
              <button
                className="festival-secondary"
                type="button"
                disabled={busy}
                onClick={() => void decide('unpublish')}
              >
                撤下展示
              </button>
            )}
            {busy && <span role="status">正在保存审核结果…</span>}
          </div>
        </div>
      ) : null}
      {error && <p role="alert">审核未完成：{error}，请重试。</p>}
    </article>
  );
}

export function FestivalPage({ client }: { client: FestivalClient }) {
  const [view, setView] = useState<FestivalView>('showcase');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<FestivalSubmissionList | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [maxUploadBytes, setMaxUploadBytes] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [displayConsent, setDisplayConsent] = useState(false);
  const [video, setVideo] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const reviewSection = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    setData(null);
    void client
      .request<FestivalSubmissionList>(`${base}?view=${view}&page=${page}`, {
        signal: controller.signal,
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setCanReview(result.canReview);
        setMaxUploadBytes(result.maxUploadBytes);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      });
    return () => controller.abort();
  }, [client, view, page, revision]);

  function reload() {
    setData(null);
    setLoadError(null);
    setRevision((value) => value + 1);
  }
  function changeView(next: FestivalView) {
    if (next === view && page === 1) return;
    setData(null);
    setLoadError(null);
    setPage(1);
    setView(next);
  }
  function changePage(next: number) {
    setData(null);
    setLoadError(null);
    setPage(next);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setFeedback(null);
    if (!title.trim() || !description.trim()) {
      setSubmitError('请填写作品名称和介绍');
      return;
    }
    if (!video || video.size === 0) {
      setSubmitError('请选择一个非空视频文件');
      return;
    }
    if (
      !/\.(mp4|webm|mov)$/i.test(video.name) ||
      (video.type && !['video/mp4', 'video/webm', 'video/quicktime'].includes(video.type))
    ) {
      setSubmitError('请选择 MP4、WebM 或 MOV 视频');
      return;
    }
    if (maxUploadBytes === null) {
      setSubmitError('请先重新加载页面，获取上传限制');
      return;
    }
    if (video.size > maxUploadBytes) {
      setSubmitError(`视频超过 ${formatSize(maxUploadBytes)} 的上传限制`);
      return;
    }
    const body = new FormData();
    body.set('title', title.trim());
    body.set('description', description.trim());
    body.set('displayConsent', String(displayConsent));
    body.set('video', video);
    setSubmitting(true);
    try {
      const result = await client.request<FestivalSubmission>(base, { method: 'POST', body });
      setFeedback(
        result.status === 'private'
          ? '投稿成功，作品已私密收存。可在「我的投稿」查看回执。'
          : '投稿成功，审核通过后展示。可在「我的投稿」查看进度。',
      );
      setTitle('');
      setDescription('');
      setVideo(null);
      setDisplayConsent(false);
      if (fileInput.current) fileInput.current.value = '';
      reload();
    } catch (error) {
      setSubmitError(`投稿未完成：${errorMessage(error)}。请重试提交。`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="module-page festival-page">
      <ModulePageHeader
        title="我要上学生节"
        kicker="STUDENT FESTIVAL · 特别栏目"
        description="把你的热爱，带上我们的舞台。"
        actions={
          <div className="festival-header-actions">
            <Link className="festival-back" to="/events">
              返回活动
            </Link>
            {canReview && (
              <button
                type="button"
                onClick={() => {
                  changeView('review');
                  reviewSection.current?.focus({ preventScroll: true });
                  reviewSection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
                }}
              >
                审核投稿
              </button>
            )}
          </div>
        }
      />
      <p className="festival-access-hint">
        {canReview
          ? '你已获得投稿审核及私密作品查看权限。'
          : '投稿审核由文艺中心部员、部长、负责人，团委负责人及平台管理员负责。'}
      </p>
      <section className="festival-submission" aria-labelledby="festival-submit-heading">
        <div className="festival-form-intro">
          <span className="festival-eyebrow">舞台，等你加入</span>
          <h3 id="festival-submit-heading">分享你的作品</h3>
          <p>一段歌声、一支舞，或一个有趣的创意。上传视频，让我们看到你的精彩。</p>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={submitting}>
            <section
              className="festival-form-stage"
              role="group"
              aria-labelledby="festival-details-heading"
            >
              <header className="festival-stage-heading">
                <span aria-hidden="true">01</span>
                <div>
                  <h4 id="festival-details-heading">作品信息</h4>
                  <p>先向观众介绍这份作品。</p>
                </div>
              </header>
              <div className="festival-stage-fields">
                <label>
                  作品名称
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={120}
                    required
                    placeholder="给你的作品起个名字"
                  />
                </label>
                <label>
                  作品介绍
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={2000}
                    rows={3}
                    required
                    placeholder="说说你的节目、创作想法或参与伙伴…"
                  />
                </label>
              </div>
            </section>

            <section
              className="festival-form-stage"
              role="group"
              aria-labelledby="festival-media-heading"
            >
              <header className="festival-stage-heading">
                <span aria-hidden="true">02</span>
                <div>
                  <h4 id="festival-media-heading">视频与展示</h4>
                  <p>选择视频，并决定它是否进入公开展示审核。</p>
                </div>
              </header>
              <div className="festival-stage-fields">
                <label className="festival-file-label">
                  <span className="festival-field-label">投稿视频</span>
                  <span className="festival-file-control">
                    <span className="festival-upload-mark" aria-hidden="true">
                      ↑
                    </span>
                    <span className="festival-file-copy">
                      <strong>{video?.name ?? '选择一个视频文件'}</strong>
                      <small>{video ? formatSize(video.size) : '尚未选择视频'}</small>
                    </span>
                    <span className="festival-file-action">{video ? '重新选择' : '浏览文件'}</span>
                  </span>
                  <input
                    ref={fileInput}
                    type="file"
                    aria-label="投稿视频"
                    accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime"
                    onChange={(event) => {
                      setVideo(event.target.files?.[0] ?? null);
                      setSubmitError(null);
                    }}
                    aria-describedby="festival-upload-hint"
                  />
                </label>
                <p id="festival-upload-hint" className="festival-hint">
                  MP4 / WebM / MOV · 最大 {formatSize(maxUploadBytes ?? 100 * 1024 * 1024)} · 推荐
                  MP4，播放兼容性更好。
                </p>
                <div className={`festival-consent ${displayConsent ? 'is-selected' : ''}`}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label="我愿意即时展示"
                      checked={displayConsent}
                      onChange={(event) => setDisplayConsent(event.target.checked)}
                      aria-describedby="festival-consent-hint"
                    />
                    <span>
                      <strong>我愿意即时展示</strong>
                      <small>审核通过后展示，对站内登录用户可见</small>
                    </span>
                  </label>
                  <p id="festival-consent-hint">
                    未勾选时，视频只对授权审核人员开放；你仍可在「我的投稿」查看回执。
                  </p>
                </div>
              </div>
            </section>

            <footer className="festival-submit-footer">
              <p>
                <strong>准备好后提交</strong>
                投稿期间请保持页面打开，上传完成后会显示明确回执。
              </p>
              <button type="submit" disabled={submitting || maxUploadBytes === null}>
                {submitting ? '正在上传，请稍候…' : '提交作品'}
              </button>
            </footer>
          </fieldset>
        </form>
        {submitError && <p role="alert">{submitError}</p>}
        {feedback && (
          <p role="status" className="festival-feedback">
            {feedback}
          </p>
        )}
      </section>
      <section
        ref={reviewSection}
        tabIndex={-1}
        className="festival-feed"
        aria-labelledby="festival-feed-heading"
      >
        <div className="festival-feed-heading">
          <h3 id="festival-feed-heading">这里，有我们的舞台</h3>
          <p>发现同学们的热爱与闪光</p>
        </div>
        <div className="festival-tabs" role="tablist" aria-label="投稿栏目">
          {(['showcase', 'mine', ...(canReview ? ['review'] : [])] as FestivalView[]).map((key) => (
            <button
              key={key}
              id={`festival-tab-${key}`}
              role="tab"
              type="button"
              aria-selected={view === key}
              aria-controls="festival-posts"
              onClick={() => changeView(key)}
            >
              {viewLabels[key]}
            </button>
          ))}
        </div>
        <div id="festival-posts" role="tabpanel" aria-labelledby={`festival-tab-${view}`}>
          {view === 'review' && (
            <p className="festival-hint">
              审核区含私密投稿。已同意展示的作品可审核通过；退回或撤下的作品可重新审核并展示。未同意展示的作品仅供查看。
            </p>
          )}
          {data === null && !loadError && (
            <p role="status" className="festival-empty">
              正在加载投稿…
            </p>
          )}
          {loadError && (
            <div className="festival-empty">
              <p role="alert">投稿加载失败：{loadError}</p>
              <button type="button" onClick={reload}>
                重新加载
              </button>
            </div>
          )}
          {data?.items.length === 0 && (
            <p className="festival-empty">
              {view === 'showcase'
                ? '舞台已经就绪，期待第一份精彩作品。'
                : view === 'mine'
                  ? '还没有投稿，来分享你的第一个作品吧。'
                  : '暂时没有待查看的投稿。'}
            </p>
          )}
          {data?.items.map((item) => (
            <FestivalPost
              key={`${view}:${page}:${revision}:${item.id}:${item.updatedAt}`}
              item={item}
              client={client}
              review={data.canReview && view === 'review'}
              onReviewed={reload}
            />
          ))}
          {data && data.total > data.pageSize && (
            <nav className="festival-pagination" aria-label="投稿分页">
              <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)}>
                上一页
              </button>
              <span>
                第 {data.page} / {Math.ceil(data.total / data.pageSize)} 页 · 共 {data.total} 份
              </span>
              <button
                type="button"
                disabled={page * data.pageSize >= data.total}
                onClick={() => changePage(page + 1)}
              >
                下一页
              </button>
            </nav>
          )}
        </div>
      </section>
    </section>
  );
}
