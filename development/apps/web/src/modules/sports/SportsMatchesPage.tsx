import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import type { SportsMatch } from '@freebbs-development/contracts';
import type { DevelopmentApi, SportsUser } from './SportsPage.js';
import { permitted } from './SportsPage.js';

interface Props {
  client: DevelopmentApi;
  user: SportsUser | null;
}

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const labels = { upcoming: '即将开始', live: '正在进行', ended: '已结束' } as const;

export function SportsMatchesPage({ client, user }: Props) {
  const [selected, setSelected] = useState(dayKey(new Date()));
  const [matches, setMatches] = useState<SportsMatch[]>([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [editingResultId, setEditingResultId] = useState<string | null>(null);
  const [resultDraft, setResultDraft] = useState('');
  const [savingResult, setSavingResult] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const [linkError, setLinkError] = useState('');
  const [savingLink, setSavingLink] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const createPending = useRef(false);
  const resultPending = useRef(false);
  const linkPending = useRef(false);
  const todayKey = dayKey(new Date());
  const days = useMemo(() => {
    const dates = new Map<string, Date>();
    for (let index = -7; index <= 7; index++) {
      const date = new Date();
      date.setDate(date.getDate() + index);
      dates.set(dayKey(date), date);
    }
    matches.forEach((match) => {
      const date = new Date(match.startsAt);
      dates.set(dayKey(date), date);
    });
    return [...dates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, date]) => date);
  }, [matches, todayKey]);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const mayCreate = permitted(user, 'sports.match.create', 'sports_match');
  const mayUpdate = permitted(user, 'sports.match.update', 'sports_match');
  const managesAllMatches =
    user?.roles.some((role) =>
      ['platform.super_admin', 'domain.sports_lead', 'department.sports_director'].includes(role),
    ) ?? false;
  const selectedMatches = useMemo(
    () =>
      matches
        .filter((match) => dayKey(new Date(match.startsAt)) === selected)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [matches, selected],
  );

  const load = async () => {
    try {
      setMatches(await client.request<SportsMatch[]>('/sports/matches'));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '赛程加载失败');
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const selectedButton = selectedRef.current;
    if (typeof selectedButton?.scrollIntoView === 'function') {
      selectedButton.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
    }
  }, [selected]);
  useEffect(
    () => () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    },
    [coverPreview],
  );

  function closeForm() {
    if (createPending.current) return;
    setShowForm(false);
    setCoverPreview(null);
    setCreateError('');
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createPending.current) return;
    createPending.current = true;
    setCreating(true);
    setCreateError('');
    const data = new FormData(event.currentTarget);
    const local = (name: string) => new Date(String(data.get(name))).toISOString();
    try {
      const cover = data.get('cover');
      let coverUrl: string | null = null;
      if (cover instanceof File && cover.size > 0) {
        const uploadBody = new FormData();
        uploadBody.append('image', cover);
        const uploaded = await client.request<{ url: string }>('/sports/media/images', {
          method: 'POST',
          body: uploadBody,
        });
        coverUrl = uploaded.url;
      }
      await client.request('/sports/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.get('title'),
          startsAt: local('startsAt'),
          endsAt: local('endsAt'),
          location: data.get('location'),
          result: data.get('result') || null,
          coverUrl,
          liveUrl: data.get('liveUrl') || null,
          replayUrl: data.get('replayUrl') || null,
        }),
      });
      setShowForm(false);
      setCoverPreview(null);
      await load();
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : '比赛保存失败');
    } finally {
      createPending.current = false;
      setCreating(false);
    }
  }

  async function saveResult(event: React.FormEvent<HTMLFormElement>, match: SportsMatch) {
    event.preventDefault();
    if (resultPending.current) return;
    resultPending.current = true;
    setSavingResult(true);
    try {
      const updated = await client.request<SportsMatch>(
        `/sports/matches/${encodeURIComponent(match.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ result: resultDraft.trim() || null }),
        },
      );
      setMatches((current) =>
        current.map((item) =>
          item.id === updated.id
            ? {
                ...item,
                result: updated.result,
                updatedAt: item.updatedAt > updated.updatedAt ? item.updatedAt : updated.updatedAt,
              }
            : item,
        ),
      );
      setEditingResultId(null);
      setResultDraft('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '比赛结果保存失败');
    } finally {
      resultPending.current = false;
      setSavingResult(false);
    }
  }

  async function saveLink(event: React.FormEvent<HTMLFormElement>, match: SportsMatch) {
    event.preventDefault();
    if (linkPending.current) return;
    const liveUrl = linkDraft.trim();
    if (liveUrl && !/^https?:\/\//i.test(liveUrl)) {
      setLinkError('请填写 http 或 https 直播链接');
      return;
    }
    linkPending.current = true;
    setSavingLink(true);
    setLinkError('');
    try {
      const updated = await client.request<SportsMatch>(
        `/sports/matches/${encodeURIComponent(match.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ liveUrl: liveUrl || null }),
        },
      );
      setMatches((current) =>
        current.map((item) =>
          item.id === updated.id
            ? {
                ...item,
                liveUrl: updated.liveUrl,
                updatedAt: item.updatedAt > updated.updatedAt ? item.updatedAt : updated.updatedAt,
              }
            : item,
        ),
      );
      setEditingLinkId(null);
      setLinkDraft('');
    } catch (reason) {
      setLinkError(reason instanceof Error ? reason.message : '直播链接保存失败');
    } finally {
      linkPending.current = false;
      setSavingLink(false);
    }
  }

  return (
    <section className="module-page sports-matches" aria-labelledby="matches-title">
      <header className="page-section-header">
        <div>
          <p className="eyebrow">無体育 · 首发栏目</p>
          <h2 id="matches-title">懂無帝</h2>
          <p>校园赛场，每一分都值得关注。查看赛程、直播与赛果。</p>
        </div>
        <div className="page-actions">
          <Link className="button secondary" to="/sports">
            返回無体育
          </Link>
          {mayCreate && (
            <button
              className="button primary"
              disabled={creating}
              onClick={() => (showForm ? closeForm() : setShowForm(true))}
            >
              添加比赛
            </button>
          )}
        </div>
      </header>
      {showForm && (
        <form className="match-form" onSubmit={submit} aria-busy={creating}>
          <div className="match-form-heading">
            <div>
              <span className="form-step">新比赛</span>
              <h3>发布马杯赛程</h3>
              <p>添加赛程、直播和回放，让同学们一起关注比赛。</p>
            </div>
            <button
              className="form-close"
              type="button"
              aria-label="关闭添加比赛"
              disabled={creating}
              onClick={closeForm}
            >
              ×
            </button>
          </div>
          <div className="match-form-grid">
            <div className="match-form-fields">
              <fieldset>
                <legend>
                  <span>01</span> 比赛信息
                </legend>
                <label>
                  比赛名称
                  <input name="title" required maxLength={200} placeholder="例如：马杯篮球小组赛" />
                </label>
                <label>
                  比赛结果 <small>选填，可赛后补充</small>
                  <input name="result" maxLength={200} placeholder="例如：电院 72–68 自动化" />
                </label>
              </fieldset>
              <fieldset>
                <legend>
                  <span>02</span> 时间与地点
                </legend>
                <div className="field-row">
                  <label>
                    开始时间
                    <input name="startsAt" type="datetime-local" required />
                  </label>
                  <label>
                    结束时间
                    <input name="endsAt" type="datetime-local" required />
                  </label>
                </div>
                <label>
                  比赛地点
                  <input
                    name="location"
                    required
                    maxLength={300}
                    placeholder="场馆、校区或具体场地"
                  />
                </label>
              </fieldset>
              <fieldset>
                <legend>
                  <span>03</span> 媒体内容
                </legend>
                <label>
                  直播链接 <small>选填</small>
                  <input
                    name="liveUrl"
                    type="url"
                    pattern="https?://.*"
                    maxLength={2000}
                    placeholder="https://"
                  />
                </label>
                <label>
                  比赛回放 <small>选填</small>
                  <input
                    name="replayUrl"
                    type="url"
                    pattern="https?://.*"
                    maxLength={2000}
                    placeholder="https://"
                  />
                </label>
              </fieldset>
            </div>
            <label className="cover-dropzone">
              <input
                name="cover"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setCoverPreview(file ? URL.createObjectURL(file) : null);
                }}
              />
              {coverPreview ? (
                <img src={coverPreview} alt="比赛封面预览" />
              ) : (
                <span className="cover-placeholder">
                  <b>＋</b>
                  <strong>上传比赛封面</strong>
                  <small>JPEG、PNG 或 WebP，最大 5 MB</small>
                </span>
              )}
            </label>
          </div>
          {createError && (
            <p className="match-form-error" role="alert">
              {createError}
            </p>
          )}
          <div className="match-form-actions">
            <button
              className="button secondary"
              type="button"
              disabled={creating}
              onClick={closeForm}
            >
              取消
            </button>
            <button className="button primary" type="submit" disabled={creating}>
              {creating ? '发布中…' : '发布比赛'}
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="date-rail">
        <div className="date-strip" aria-label="比赛日期">
          {days.map((day) => {
            const key = dayKey(day);
            const isToday = key === todayKey;
            const className = [key === selected ? 'is-selected' : '', isToday ? 'is-today' : '']
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={key}
                ref={key === selected ? selectedRef : undefined}
                className={className}
                aria-pressed={key === selected}
                aria-label={day.toLocaleDateString('zh-CN', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
                onClick={() => setSelected(key)}
              >
                <small>
                  {isToday ? '今天' : day.toLocaleDateString('zh-CN', { weekday: 'short' })}
                </small>
                <strong>{day.getDate()}</strong>
                <span>{day.getMonth() + 1}月</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="match-schedule-heading">
        <h3>
          {new Date(`${selected}T00:00:00`).toLocaleDateString('zh-CN', {
            month: 'long',
            day: 'numeric',
            weekday: 'long',
          })}
          {selected === todayKey ? ' · 今天' : ''}
        </h3>
        <span>{selectedMatches.length} 场比赛</span>
      </div>
      <ol className="match-timeline" aria-label="所选日期的比赛时间线">
        {selectedMatches.length === 0 && (
          <li className="timeline-empty">这一天还没有比赛，去看看相邻日期吧。</li>
        )}
        {selectedMatches.map((match) => {
          const canEditResult = mayUpdate && (match.ownerUid === user?.uid || managesAllMatches);
          return (
            <li className="match-score-entry" key={match.id}>
              <article
                aria-label={match.title}
                className={`match-card ${match.matchStatus === 'live' ? 'is-live' : ''}`}
              >
                <div className="match-cover">
                  {match.coverUrl ? (
                    <img src={match.coverUrl} alt="" />
                  ) : (
                    <span aria-hidden="true">
                      無体育<span>校园赛场</span>
                    </span>
                  )}
                </div>
                <div className="match-card-top">
                  <time className="match-time" dateTime={match.startsAt}>
                    {new Date(match.startsAt).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  <span
                    className="status-badge"
                    data-status={match.matchStatus === 'live' ? 'success' : 'neutral'}
                  >
                    {match.matchStatus === 'live' && (
                      <i className="match-live-dot" aria-hidden="true" />
                    )}
                    {labels[match.matchStatus]}
                  </span>
                </div>
                <div className="match-card-details">
                  <h3>{match.title}</h3>
                  <p className="match-location">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    >
                      <path d="M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12Z" />
                      <circle cx="12" cy="9" r="2.5" />
                    </svg>{' '}
                    {match.location}
                  </p>
                </div>
                {match.matchStatus === 'ended' && (match.result || canEditResult) ? (
                  <div className="match-result">
                    <span>比赛结果</span>
                    {match.result ? <strong>{match.result}</strong> : <p>结果暂未录入</p>}
                    {canEditResult && editingResultId !== match.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingResultId(match.id);
                          setResultDraft(match.result ?? '');
                        }}
                      >
                        {match.result ? '修改赛果' : '补充赛果'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {editingResultId === match.id ? (
                  <form
                    className="match-result-form"
                    onSubmit={(event) => saveResult(event, match)}
                  >
                    <label>
                      比赛结果
                      <input
                        aria-label={`${match.title}比赛结果`}
                        value={resultDraft}
                        onChange={(event) => setResultDraft(event.target.value)}
                        maxLength={200}
                        placeholder="例如：电院 72–68 自动化"
                        autoFocus
                      />
                    </label>
                    <div>
                      <button
                        type="button"
                        disabled={savingResult}
                        onClick={() => setEditingResultId(null)}
                      >
                        取消
                      </button>
                      <button type="submit" disabled={savingResult}>
                        {savingResult ? '保存中…' : '保存赛果'}
                      </button>
                    </div>
                  </form>
                ) : null}
                <div className="match-links">
                  {match.liveUrl && (
                    <a href={match.liveUrl} target="_blank" rel="noreferrer">
                      观看直播
                    </a>
                  )}
                  {match.replayUrl && (
                    <a href={match.replayUrl} target="_blank" rel="noreferrer">
                      比赛回放
                    </a>
                  )}
                  {canEditResult && editingLinkId !== match.id && (
                    <button
                      type="button"
                      disabled={savingLink}
                      onClick={() => {
                        setEditingLinkId(match.id);
                        setLinkDraft(match.liveUrl ?? '');
                        setLinkError('');
                      }}
                    >
                      {match.liveUrl ? '修改直播链接' : '添加直播链接'}
                    </button>
                  )}
                </div>
                {editingLinkId === match.id && (
                  <form
                    className="match-link-form"
                    onSubmit={(event) => saveLink(event, match)}
                    aria-busy={savingLink}
                  >
                    <label>
                      直播链接
                      <input
                        aria-label={`${match.title}直播链接`}
                        type="url"
                        maxLength={2000}
                        value={linkDraft}
                        onChange={(event) => setLinkDraft(event.target.value)}
                        placeholder="https://"
                        disabled={savingLink}
                        autoFocus
                      />
                    </label>
                    <small>支持 http / https；留空可移除直播链接。</small>
                    {linkError && <p role="alert">{linkError}</p>}
                    <div>
                      <button
                        type="button"
                        disabled={savingLink}
                        onClick={() => {
                          setEditingLinkId(null);
                          setLinkError('');
                        }}
                      >
                        取消
                      </button>
                      <button type="submit" disabled={savingLink}>
                        {savingLink ? '保存中…' : '保存直播链接'}
                      </button>
                    </div>
                  </form>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
