import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import bartenderSheep from '../../assets/liaison/sheep-bartender.webp';
import { FilterBar } from '../../components/FilterBar.js';
import { StatusBadge } from '../../components/StatusBadge.js';
import { ApiError, createApiClient, type ApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import { ProblemEditorDrawer, type ProblemInput } from './ProblemEditorDrawer.js';
import {
  conciseText,
  formatLiaisonDate,
  hasLiaisonPermission,
  problemScope,
  problemStatusLabels,
  sourceTypeLabels,
  statusTone,
  type LiaisonProblem,
  type LiaisonProblemStatus,
  type LiaisonUser,
  type ProblemPage,
} from './model.js';

interface BoardProblem extends LiaisonProblem {
  teamCount: number;
}

export interface LiaisonPageProps {
  client?: Pick<ApiClient, 'request'>;
  user?: LiaisonUser | null;
}

const statusOptions: Array<{ value: '' | LiaisonProblemStatus; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'open', label: '进行中' },
  { value: 'paused', label: '已暂停' },
  { value: 'closed', label: '已结项' },
  { value: 'pending_review', label: '待审核' },
  { value: 'draft', label: '草稿' },
  { value: 'rejected', label: '待修改' },
];

const noticeboardExamples = [
  { source: '课题组', title: '校园创新课题', status: '示例委托' },
  { source: '企业', title: '公益技术协作', status: '示例委托' },
] as const;

function apiMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message.trim() ? error.message : fallback;
}

export function LiaisonPage({ client, user: suppliedUser }: LiaisonPageProps) {
  const defaultClient = useMemo(createApiClient, []);
  const api = client ?? defaultClient;
  const auth = useOptionalAuth();
  const user =
    suppliedUser === undefined ? ((auth?.user as LiaisonUser | null) ?? null) : suppliedUser;
  const [problems, setProblems] = useState<BoardProblem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | LiaisonProblemStatus>('');
  const [filters, setFilters] = useState({ query: '', status: '' as '' | LiaisonProblemStatus });
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ page: 1, pageSize: 20, total: 0 });
  const [editorOpen, setEditorOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeProblemId, setActiveProblemId] = useState<string | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const requestGeneration = useRef(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  const load = useCallback(
    async (successMessage?: string) => {
      const generation = ++requestGeneration.current;
      setState('loading');
      setFeedback(null);
      setActionError(null);
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (filters.query) params.set('query', filters.query);
      if (filters.status) params.set('status', filters.status);
      try {
        const result = await api.request<ProblemPage>(`/liaison/problems?${params.toString()}`);
        if (generation !== requestGeneration.current) return;
        setProblems(result.items);
        setActiveProblemId((current) =>
          result.items.some(({ id }) => id === current) ? current : (result.items[0]?.id ?? null),
        );
        setPageInfo({ page: result.page, pageSize: result.pageSize, total: result.total });
        setState('ready');
        if (successMessage) setFeedback(successMessage);
      } catch {
        if (generation === requestGeneration.current) setState('error');
      }
    },
    [api, filters, page],
  );

  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [load, user?.uid]);

  useEffect(() => {
    if (!boardOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBoardOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [boardOpen]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setFilters({ query: query.trim(), status });
  }

  async function createProblem(input: ProblemInput) {
    const generation = requestGeneration.current;
    setPending('create');
    setEditorError(null);
    setFeedback(null);
    try {
      await api.request<LiaisonProblem>('/liaison/problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (generation !== requestGeneration.current) return;
      setEditorOpen(false);
      setPending(null);
      await load('问题草稿已保存');
    } catch (error) {
      if (generation === requestGeneration.current) {
        setEditorError(apiMessage(error, '保存失败，请稍后重试'));
      }
    } finally {
      if (generation === requestGeneration.current) setPending(null);
    }
  }

  async function review(problem: LiaisonProblem, decision: 'approve' | 'reject') {
    const generation = requestGeneration.current;
    setPending(`review:${problem.id}`);
    setFeedback(null);
    setActionError(null);
    try {
      const updated = await api.request<LiaisonProblem>(
        `/liaison/problems/${encodeURIComponent(problem.id)}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, note: null }),
        },
      );
      if (generation !== requestGeneration.current) return;
      setProblems((current) =>
        current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
      );
      setFeedback(decision === 'approve' ? '课题已批准发布' : '课题已驳回修改');
    } catch (error) {
      if (generation === requestGeneration.current) {
        setActionError(apiMessage(error, '审核失败，请重试'));
      }
    } finally {
      if (generation === requestGeneration.current) setPending(null);
    }
  }

  const canCreate = hasLiaisonPermission(user, 'liaison.problem.create', 'liaison_problem', [
    { type: 'public', id: '*' },
  ]);
  const activeIndex = problems.findIndex(({ id }) => id === activeProblemId);
  const activeProblem = activeIndex >= 0 ? problems[activeIndex] : null;

  function centerProblem(problemId: string) {
    setActiveProblemId(problemId);
    const carousel = carouselRef.current;
    const card = cardRefs.current.get(problemId);
    if (!carousel || !card) return;
    const left = card.offsetLeft - (carousel.clientWidth - card.offsetWidth) / 2;
    carousel.scrollTo?.({ behavior: 'smooth', left });
  }

  function moveCard(direction: -1 | 1) {
    if (problems.length === 0) return;
    const nextIndex = Math.min(
      problems.length - 1,
      Math.max(0, (activeIndex < 0 ? 0 : activeIndex) + direction),
    );
    centerProblem(problems[nextIndex].id);
  }

  function syncCenteredCard() {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const center = carousel.getBoundingClientRect().left + carousel.clientWidth / 2;
    let nearest: { id: string; distance: number } | null = null;
    for (const problem of problems) {
      const card = cardRefs.current.get(problem.id);
      if (!card) continue;
      const rect = card.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - center);
      if (nearest === null || distance < nearest.distance) nearest = { id: problem.id, distance };
    }
    if (nearest) setActiveProblemId(nearest.id);
  }

  return (
    <section className="module-page liaison-board" aria-label="無限机会">
      <section
        className={`tavern-room ${boardOpen ? 'is-obscured' : ''}`}
        aria-hidden={boardOpen ? true : undefined}
      >
        <header className="tavern-room-heading">
          <p className="tavern-kicker">FREE-BBS · 机会委托酒馆</p>
          <h2>無限机会</h2>
          <p>酒保整理了今天的机会。去告示板前看看，有没有适合你的委托。</p>
        </header>
        <div className="tavern-room-scene">
          <figure className="tavern-keeper">
            <img src={bartenderSheep} alt="無限机会酒馆的小羊酒保" />
            <figcaption>“新的委托已经钉上去了。”</figcaption>
          </figure>
          <button
            className="noticeboard-preview"
            type="button"
            aria-label="查看委托"
            onClick={() => setBoardOpen(true)}
          >
            <span className="noticeboard-paper-grid" aria-hidden="true">
              {noticeboardExamples.map((example, index) => (
                <span
                  className={`noticeboard-paper noticeboard-paper-${index + 1}`}
                  key={example.title}
                >
                  <small>{example.source}</small>
                  <strong>{example.title}</strong>
                  <i>{example.status}</i>
                </span>
              ))}
              <span className="noticeboard-paper noticeboard-placeholder noticeboard-paper-3" />
              <span className="noticeboard-paper noticeboard-placeholder noticeboard-paper-4" />
            </span>
            <span className="noticeboard-preview-footer">点击查看全部委托</span>
          </button>
        </div>
      </section>

      {boardOpen ? (
        <div
          className="noticeboard-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setBoardOpen(false);
          }}
        >
          <section
            className="noticeboard-panel"
            role="dialog"
            aria-modal="true"
            aria-label="委托卡牌"
          >
            <header className="noticeboard-panel-header">
              <p>翻阅告示，选中的委托会自动回到中央。</p>
              <div className="noticeboard-admin-tools">
                {canCreate ? (
                  <button
                    className="noticeboard-create"
                    type="button"
                    onClick={() => {
                      setEditorError(null);
                      setEditorOpen(true);
                    }}
                  >
                    新增委托
                  </button>
                ) : null}
                <button
                  className="noticeboard-close"
                  type="button"
                  aria-label="关闭委托卡牌"
                  autoFocus
                  onClick={() => setBoardOpen(false)}
                >
                  ×
                </button>
              </div>
            </header>

            <FilterBar className="tavern-filter" ariaLabel="筛选机会委托" onSubmit={applyFilters}>
              <label>
                搜索问题
                <input
                  value={query}
                  placeholder="标题、来源或方向"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label>
                状态
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as '' | LiaisonProblemStatus)}
                >
                  {statusOptions.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary-action" type="submit">
                寻找委托
              </button>
            </FilterBar>

            <section className="opportunity-deck" aria-labelledby="opportunity-deck-title">
              <header className="opportunity-deck-heading">
                <div>
                  <p className="tavern-kicker">选择你的下一份委托</p>
                  <h3 id="opportunity-deck-title">机会卡牌</h3>
                </div>
                <div className="opportunity-deck-controls" aria-label="切换机会卡牌">
                  <button
                    type="button"
                    aria-label="上一张机会卡牌"
                    disabled={activeIndex <= 0}
                    onClick={() => moveCard(-1)}
                  >
                    ←
                  </button>
                  <span>
                    {problems.length === 0 ? '0 / 0' : `${activeIndex + 1} / ${problems.length}`}
                  </span>
                  <button
                    type="button"
                    aria-label="下一张机会卡牌"
                    disabled={activeIndex < 0 || activeIndex >= problems.length - 1}
                    onClick={() => moveCard(1)}
                  >
                    →
                  </button>
                </div>
              </header>

              {state === 'loading' ? <p role="status">酒保正在整理今日委托…</p> : null}
              {state === 'error' ? <p role="alert">机会委托暂时无法加载</p> : null}
              {state === 'ready' && problems.length === 0 ? (
                <div className="opportunity-empty">
                  <strong>暂时没有符合条件的委托</strong>
                  <span>可以调整筛选条件，稍后再来看看。</span>
                </div>
              ) : null}
              {problems.length > 0 ? (
                <div className="opportunity-carousel-shell">
                  <div
                    className="opportunity-carousel"
                    role="region"
                    aria-label="机会委托卡牌"
                    ref={carouselRef}
                    onScroll={syncCenteredCard}
                  >
                    {problems.map((problem, index) => (
                      <article
                        className={`liaison-problem-card opportunity-card ${problem.id === activeProblemId ? 'is-active' : ''}`}
                        aria-label={problem.title}
                        key={problem.id}
                        data-opportunity-id={problem.id}
                        ref={(node) => {
                          if (node) cardRefs.current.set(problem.id, node);
                          else cardRefs.current.delete(problem.id);
                        }}
                      >
                        <button
                          className="opportunity-card-button"
                          type="button"
                          aria-label={`展开${problem.title}`}
                          aria-pressed={problem.id === activeProblemId}
                          onClick={() => centerProblem(problem.id)}
                        >
                          <span className="opportunity-card-number">
                            委托 {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="opportunity-card-status">
                            <StatusBadge status={statusTone(problem.status)}>
                              {problemStatusLabels[problem.status]}
                            </StatusBadge>
                          </span>
                          <span className="opportunity-card-source">
                            {sourceTypeLabels[problem.sourceType]} · {problem.sourceName}
                          </span>
                          <span className="opportunity-card-emblem" aria-hidden="true">
                            <b>{sourceTypeLabels[problem.sourceType].slice(0, 1)}</b>
                            <i>FREE-BBS</i>
                          </span>
                          <strong>{problem.title}</strong>
                          <span className="opportunity-card-summary">{problem.summary}</span>
                          <span className="opportunity-card-tags" aria-label="领域标签">
                            {problem.tags.slice(0, 3).map((tag) => (
                              <i key={tag}>{tag}</i>
                            ))}
                          </span>
                          <span className="opportunity-card-facts">
                            <span>
                              <small>截止时间</small>
                              <b>{formatLiaisonDate(problem.deadline)}</b>
                            </span>
                            <span>
                              <small>已接取</small>
                              <b>{problem.teamCount} 个参与团队</b>
                            </span>
                          </span>
                          <span className="opportunity-card-hint">点击展开委托</span>
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeProblem
                ? (() => {
                    const problem = activeProblem;
                    const canReview =
                      problem.status === 'pending_review' &&
                      hasLiaisonPermission(user, 'liaison.problem.review', 'liaison_problem', [
                        problemScope(problem.id),
                      ]);
                    const canUpdate = hasLiaisonPermission(
                      user,
                      'liaison.problem.update',
                      'liaison_problem',
                      [problemScope(problem.id)],
                    );
                    return (
                      <article
                        className="opportunity-detail"
                        role="region"
                        aria-label={`${problem.title}委托详情`}
                      >
                        <header>
                          <div>
                            <p className="tavern-kicker">
                              {sourceTypeLabels[problem.sourceType]} · {problem.sourceName}
                            </p>
                            <h3>{problem.title}</h3>
                          </div>
                          <StatusBadge status={statusTone(problem.status)}>
                            {problemStatusLabels[problem.status]}
                          </StatusBadge>
                        </header>
                        <p className="opportunity-detail-summary">{problem.summary}</p>
                        <ul className="liaison-tag-list" aria-label="完整领域标签">
                          {problem.tags.map((tag) => (
                            <li key={tag}>{tag}</li>
                          ))}
                        </ul>
                        <dl className="opportunity-detail-facts">
                          <div>
                            <dt>背景</dt>
                            <dd>{conciseText(problem.background, 260)}</dd>
                          </div>
                          <div>
                            <dt>预期成果</dt>
                            <dd>{conciseText(problem.expectedOutcome, 260)}</dd>
                          </div>
                          <div>
                            <dt>委托信息</dt>
                            <dd>
                              {formatLiaisonDate(problem.deadline)} · {problem.teamCount} 个参与团队
                            </dd>
                          </div>
                        </dl>
                        <div className="liaison-card-actions">
                          <Link
                            className="primary-opportunity-link"
                            to={`/liaison/problems/${problem.id}`}
                          >
                            查看完整委托
                          </Link>
                          {canUpdate ? (
                            <Link
                              className="secondary-action-link"
                              to={`/liaison/problems/${problem.id}`}
                            >
                              编辑当前委托
                            </Link>
                          ) : null}
                          {canReview ? (
                            <>
                              <button
                                className="secondary-action"
                                type="button"
                                disabled={pending !== null}
                                onClick={() => void review(problem, 'approve')}
                              >
                                批准发布
                              </button>
                              <button
                                className="secondary-action"
                                type="button"
                                disabled={pending !== null}
                                onClick={() => void review(problem, 'reject')}
                              >
                                驳回修改
                              </button>
                            </>
                          ) : null}
                        </div>
                      </article>
                    );
                  })()
                : null}
            </section>
            {pageInfo.total > pageInfo.pageSize ? (
              <nav aria-label="问题榜分页" className="pagination-controls">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={pageInfo.page <= 1 || state === 'loading'}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  上一页
                </button>
                <span>
                  第 {pageInfo.page} / {Math.ceil(pageInfo.total / pageInfo.pageSize)} 页
                </span>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={
                    pageInfo.page >= Math.ceil(pageInfo.total / pageInfo.pageSize) ||
                    state === 'loading'
                  }
                  onClick={() => setPage((current) => current + 1)}
                >
                  下一页
                </button>
              </nav>
            ) : null}
            {state === 'error' ? (
              <button
                type="button"
                className="secondary-action"
                onClick={() => void load('问题榜已刷新')}
              >
                重新加载问题榜
              </button>
            ) : null}
            {feedback ? <p role="status">{feedback}</p> : null}
            {actionError ? <p role="alert">{actionError}</p> : null}
          </section>
        </div>
      ) : null}

      {canCreate ? (
        <ProblemEditorDrawer
          open={editorOpen}
          pending={pending === 'create'}
          error={editorError}
          onClose={() => setEditorOpen(false)}
          onSubmit={createProblem}
        />
      ) : null}
    </section>
  );
}
