import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ActivityContentBlock,
  ActivityRecap,
  ActivityUpdate,
  ActivityWorkspace,
  ActivityWorkspaceAsset,
  RegistrationSource,
} from '@freebbs-development/contracts';
import { ApiError, createApiClient, type ApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import { ActivityBlockContent } from './ActivityBlockContent.js';
import { ActivityBlockEditor } from './ActivityBlockEditor.js';
import { activityDate, activityState, localDateTime, timelineDate } from './activity-lifecycle.js';
import { LearningSurveyRegistration } from './LearningSurveyRegistration.js';
import { RegistrationGallery } from './RegistrationGallery.js';
import { sourceLabels } from './source-adapters.js';
import '../../styles/activity-workspace.css';

export interface ActivityPageProps {
  source: RegistrationSource;
  activityId?: string;
  id?: string;
  client?: Pick<ApiClient, 'request' | 'download'>;
}
interface UpdateDraft {
  id: string | null;
  label: string;
  date: string;
  description: string;
}
interface RecapDraft {
  id: string | null;
  title: string;
  blocks: ActivityContentBlock[];
}
interface ScheduleDraft {
  start: string;
  end: string;
  finished: boolean;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : '暂时无法完成，请重试。';
function notify() {
  window.dispatchEvent(new Event('freebbs-development-notifications-changed'));
}

export function ActivityPage({ source, activityId, id, client }: ActivityPageProps) {
  const defaultClient = useMemo(createApiClient, []);
  const auth = useOptionalAuth();
  const api = client ?? auth?.client ?? defaultClient;
  const identity = auth?.user?.uid ?? '';
  const path = `/events/workspaces/${source}/${encodeURIComponent(activityId ?? id ?? '')}`;
  const [workspace, setWorkspace] = useState<ActivityWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [introDraft, setIntroDraft] = useState<ActivityContentBlock[] | null>(null);
  const [updateDraft, setUpdateDraft] = useState<UpdateDraft | null>(null);
  const [recapDraft, setRecapDraft] = useState<RecapDraft | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const introRef = useRef<HTMLElement>(null);
  const timelineRef = useRef<HTMLElement>(null);
  const recapRef = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setWorkspace(null);
    setIntroDraft(null);
    setUpdateDraft(null);
    setRecapDraft(null);
    setScheduleDraft(null);
    setFeedback(null);
    setConflict(false);
    setBusy(false);
  }, [path, identity, api]);
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    setLoading(true);
    setError(null);
    api.request<ActivityWorkspace>(path).then(
      (value) => {
        if (active && current === generation.current) {
          setWorkspace(value);
          setLoading(false);
          setConflict(false);
        }
      },
      (caught) => {
        if (active && current === generation.current) {
          setLoading(false);
          setError(message(caught));
        }
      },
    );
    return () => {
      active = false;
      generation.current++;
    };
  }, [api, path, identity, reload]);

  async function mutate(
    suffix: string,
    method: string,
    payload: Record<string, unknown>,
    published = false,
  ): Promise<boolean> {
    if (!workspace || busy) return false;
    const current = generation.current;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const value = await api.request<ActivityWorkspace>(`${path}${suffix}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: workspace.revision, ...payload }),
      });
      if (current !== generation.current) return false;
      setWorkspace(value);
      setConflict(false);
      setFeedback('已保存。');
      if (published) notify();
      return true;
    } catch (caught) {
      if (current === generation.current) {
        setError(message(caught));
        setConflict(
          caught instanceof ApiError &&
            caught.status === 409 &&
            caught.code === 'revision_conflict',
        );
      }
      return false;
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function upload(file: File): Promise<ActivityWorkspaceAsset> {
    const current = generation.current;
    const body = new FormData();
    body.append('file', file);
    const asset = await api.request<ActivityWorkspaceAsset>(`${path}/assets`, {
      method: 'POST',
      body,
    });
    if (current !== generation.current) throw new Error('活动已切换，请重新上传。');
    setWorkspace((value) => (value ? { ...value, assets: [...value.assets, asset] } : value));
    return asset;
  }
  async function follow() {
    if (!workspace || busy) return;
    const current = generation.current;
    setBusy(true);
    setError(null);
    try {
      const value = await api.request<{ following: boolean }>(`${path}/following`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ following: !workspace.following }),
      });
      if (current === generation.current)
        setWorkspace((w) => (w ? { ...w, following: value.following } : w));
    } catch (caught) {
      if (current === generation.current) setError(message(caught));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  function editUpdate(update?: ActivityUpdate) {
    if (busy) return;
    if (updateDraft && !window.confirm('切换动态会放弃当前未保存的内容，继续吗？')) return;
    setUpdateDraft({
      id: update?.id ?? null,
      label: update?.label ?? '',
      date: localDateTime(update?.occursAt ?? new Date().toISOString()),
      description: update?.description ?? '',
    });
    setError(null);
    timelineRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
  function editRecap(recap?: ActivityRecap) {
    if (busy) return;
    if (recapDraft && !window.confirm('切换复盘会放弃当前未保存的内容，继续吗？')) return;
    setRecapDraft({
      id: recap?.id ?? null,
      title: recap?.title ?? '',
      blocks: recap?.blocks ?? [],
    });
    setError(null);
    recapRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
  function editIntroduction() {
    if (!workspace || busy) return;
    setIntroDraft((draft) => draft ?? workspace.intro);
    introRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
  async function saveUpdate() {
    if (!updateDraft) return;
    const date = new Date(updateDraft.date);
    if (!updateDraft.label.trim() || Number.isNaN(date.getTime())) {
      setError('请填写动态名称和有效日期。');
      return;
    }
    if (
      await mutate(
        `/updates${updateDraft.id ? `/${encodeURIComponent(updateDraft.id)}` : ''}`,
        updateDraft.id ? 'PATCH' : 'POST',
        {
          label: updateDraft.label.trim(),
          occursAt: date.toISOString(),
          description: updateDraft.description,
        },
        true,
      )
    )
      setUpdateDraft(null);
  }
  async function saveRecap() {
    if (!recapDraft) return;
    if (
      await mutate(
        `/recaps${recapDraft.id ? `/${encodeURIComponent(recapDraft.id)}` : ''}`,
        recapDraft.id ? 'PUT' : 'POST',
        { title: recapDraft.title.trim(), blocks: recapDraft.blocks },
        true,
      )
    )
      setRecapDraft(null);
  }
  async function saveSchedule() {
    if (!scheduleDraft) return;
    const startsAt = scheduleDraft.start ? new Date(scheduleDraft.start).toISOString() : null;
    const endsAt = scheduleDraft.end ? new Date(scheduleDraft.end).toISOString() : null;
    if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
      setError('活动结束时间不能早于开始时间。');
      return;
    }
    if (await mutate('/schedule', 'PUT', { startsAt, endsAt, finished: scheduleDraft.finished }))
      setScheduleDraft(null);
  }

  const state = workspace ? activityState(workspace.activity) : null;
  return (
    <main className="activity-workspace collections-page">
      <Link className="activity-back" to="/collections/activities">
        ← 全部活动
      </Link>
      {error ? (
        <div className="activity-error" role="alert">
          <p>{error}</p>
          {conflict ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setFeedback('已保留草稿，请对照最新内容再保存。');
                setReload((n) => n + 1);
              }}
            >
              加载最新内容并保留草稿
            </button>
          ) : !workspace ? (
            <button type="button" onClick={() => setReload((n) => n + 1)}>
              重新加载
            </button>
          ) : null}
        </div>
      ) : null}
      {feedback ? (
        <p className="activity-feedback" role="status">
          {feedback}
        </p>
      ) : null}
      {loading && !workspace ? (
        <p className="activity-empty" role="status">
          正在打开活动…
        </p>
      ) : null}
      {workspace ? (
        <>
          <header className="activity-hero">
            <div className="activity-hero-meta">
              <span>{sourceLabels[source]}</span>
              <span className={`activity-status is-${workspace.ended ? 'ended' : state?.key}`}>
                {workspace.ended ? '活动已结束' : state?.label}
              </span>
            </div>
            <div className="activity-hero-title">
              <h1>{workspace.activity.title}</h1>
              <div className="activity-hero-actions">
                {workspace.canEdit ? (
                  <button
                    type="button"
                    className="activity-primary"
                    disabled={busy}
                    onClick={editIntroduction}
                  >
                    编辑活动
                  </button>
                ) : null}
                <button
                  className={`activity-bookmark${workspace.following ? ' is-following' : ''}`}
                  type="button"
                  aria-label={workspace.following ? '已关注活动' : '关注活动'}
                  aria-pressed={workspace.following}
                  disabled={busy}
                  onClick={() => void follow()}
                >
                  <Bookmark filled={workspace.following} />
                  <span>{workspace.following ? '已关注' : '关注活动'}</span>
                </button>
              </div>
            </div>
            <p className="activity-hero-description">{workspace.activity.description}</p>
            <dl className="activity-facts">
              <div>
                <dt>发起</dt>
                <dd>{workspace.activity.organizer || '待公布'}</dd>
              </div>
              <div>
                <dt>{workspace.activity.startsAt ? '活动时间' : '报名开放'}</dt>
                <dd>{activityDate(workspace.activity.startsAt || workspace.activity.opensAt)}</dd>
              </div>
              <div>
                <dt>报名截止</dt>
                <dd>{activityDate(workspace.activity.closesAt)}</dd>
              </div>
              {workspace.activity.endsAt ? (
                <div>
                  <dt>活动结束</dt>
                  <dd>{activityDate(workspace.activity.endsAt)}</dd>
                </div>
              ) : null}
              {workspace.activity.location ? (
                <div>
                  <dt>地点</dt>
                  <dd>{workspace.activity.location}</dd>
                </div>
              ) : null}
            </dl>
            <p className="activity-follow-hint">关注后，活动的新动态和复盘会出现在站内通知中。</p>
            {workspace.canEdit || workspace.canRecap ? (
              <nav className="activity-edit-shortcuts" aria-label="活动编辑快捷入口">
                <span>管理活动</span>
                {workspace.canEdit ? (
                  <>
                    <button type="button" disabled={busy} onClick={editIntroduction}>
                      介绍与排版
                    </button>
                    <button type="button" disabled={busy} onClick={() => editUpdate()}>
                      发布新动态
                    </button>
                  </>
                ) : null}
                {workspace.canRecap ? (
                  <button type="button" disabled={busy} onClick={() => editRecap()}>
                    撰写复盘
                  </button>
                ) : null}
              </nav>
            ) : null}
            {workspace.canEdit ? (
              <div className="activity-schedule-control">
                {scheduleDraft ? (
                  <form
                    className="activity-update-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveSchedule();
                    }}
                  >
                    <fieldset disabled={busy}>
                      <label>
                        <span>活动开始时间</span>
                        <input
                          type="datetime-local"
                          value={scheduleDraft.start}
                          onChange={(event) =>
                            setScheduleDraft({ ...scheduleDraft, start: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        <span>活动结束时间</span>
                        <input
                          type="datetime-local"
                          value={scheduleDraft.end}
                          onChange={(event) =>
                            setScheduleDraft({ ...scheduleDraft, end: event.target.value })
                          }
                        />
                      </label>
                      <label className="activity-completion-check">
                        <input
                          type="checkbox"
                          checked={scheduleDraft.finished}
                          onChange={(event) =>
                            setScheduleDraft({ ...scheduleDraft, finished: event.target.checked })
                          }
                        />
                        <span>活动已结束</span>
                      </label>
                      <p className="activity-muted">填写实际活动时间。活动结束后即可发布复盘。</p>
                      <div className="activity-editor-footer">
                        <button className="activity-primary" type="submit" disabled={loading}>
                          保存活动安排
                        </button>
                        <button type="button" onClick={() => setScheduleDraft(null)}>
                          取消编辑
                        </button>
                      </div>
                    </fieldset>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setScheduleDraft({
                        start: localDateTime(
                          workspace.schedule?.startsAt ?? workspace.activity.startsAt ?? '',
                        ),
                        end: localDateTime(
                          workspace.schedule?.endsAt ?? workspace.activity.endsAt ?? '',
                        ),
                        finished: workspace.schedule?.finished ?? false,
                      })
                    }
                  >
                    编辑活动安排
                  </button>
                )}
              </div>
            ) : null}
          </header>
          <div className="activity-columns">
            <div className="activity-main-column">
              <section
                ref={introRef}
                className="activity-section"
                aria-labelledby="activity-intro-title"
              >
                <div className="activity-section-heading">
                  <div>
                    <p className="activity-eyebrow">ABOUT THIS ACTIVITY</p>
                    <h2 id="activity-intro-title">活动介绍</h2>
                  </div>
                  {workspace.canEdit && introDraft === null ? (
                    <button type="button" disabled={busy} onClick={editIntroduction}>
                      编辑介绍
                    </button>
                  ) : null}
                </div>
                {introDraft !== null && workspace.canEdit ? (
                  <>
                    <ActivityBlockEditor
                      blocks={introDraft}
                      assets={workspace.assets}
                      onChange={setIntroDraft}
                      onUpload={upload}
                      disabled={busy}
                    />
                    <div className="activity-editor-footer">
                      <button
                        className="activity-primary"
                        disabled={busy || loading}
                        type="button"
                        onClick={() =>
                          void mutate('/intro', 'PUT', { blocks: introDraft }).then((ok) => {
                            if (ok) setIntroDraft(null);
                          })
                        }
                      >
                        保存介绍
                      </button>
                      <button disabled={busy} type="button" onClick={() => setIntroDraft(null)}>
                        取消编辑
                      </button>
                    </div>
                  </>
                ) : workspace.intro.length ? (
                  <ActivityBlockContent
                    blocks={workspace.intro}
                    assets={workspace.assets}
                    client={api}
                  />
                ) : (
                  <p className="activity-muted">
                    {workspace.activity.description || '更多活动信息即将补充。'}
                  </p>
                )}
              </section>
              <section
                className="activity-section activity-registration"
                aria-labelledby="activity-registration-title"
              >
                <div className="activity-section-heading">
                  <div>
                    <p className="activity-eyebrow">TAKE PART</p>
                    <h2 id="activity-registration-title">参与活动</h2>
                  </div>
                </div>
                {source === 'learning_survey' ? (
                  <LearningSurveyRegistration surveyId={workspace.activityId} />
                ) : (
                  <RegistrationGallery
                    key={`${source}:${workspace.activityId}`}
                    client={api}
                    focusedItem={workspace.activity}
                    embedded
                  />
                )}
              </section>
              <section
                ref={recapRef}
                className="activity-section"
                aria-labelledby="activity-recap-title"
              >
                <div className="activity-section-heading">
                  <div>
                    <p className="activity-eyebrow">AFTER THE EVENT</p>
                    <h2 id="activity-recap-title">活动复盘</h2>
                  </div>
                  {workspace.canRecap && !recapDraft ? (
                    <button
                      type="button"
                      className="activity-primary"
                      disabled={busy}
                      onClick={() => editRecap()}
                    >
                      写复盘
                    </button>
                  ) : null}
                </div>
                {recapDraft ? (
                  <p className="activity-editor-hint">
                    用段落、图片和视频记录精彩瞬间，内容块可以调整顺序。保存后仍可编辑。
                  </p>
                ) : null}
                {recapDraft && workspace.canRecap ? (
                  <form
                    className="activity-recap-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveRecap();
                    }}
                  >
                    <label>
                      <span>复盘标题</span>
                      <input
                        required
                        maxLength={200}
                        value={recapDraft.title}
                        disabled={busy}
                        onChange={(event) =>
                          setRecapDraft({ ...recapDraft, title: event.target.value })
                        }
                      />
                    </label>
                    <ActivityBlockEditor
                      blocks={recapDraft.blocks}
                      assets={workspace.assets}
                      onChange={(blocks) => setRecapDraft({ ...recapDraft, blocks })}
                      onUpload={upload}
                      disabled={busy}
                    />
                    <div className="activity-editor-footer">
                      <button className="activity-primary" disabled={busy || loading} type="submit">
                        {recapDraft.id ? '保存复盘' : '发布复盘'}
                      </button>
                      <button disabled={busy} type="button" onClick={() => setRecapDraft(null)}>
                        取消编辑
                      </button>
                    </div>
                  </form>
                ) : null}
                {!workspace.recaps.length && !recapDraft ? (
                  <p className="activity-muted">
                    {workspace.ended
                      ? '活动已经结束，期待在这里留下精彩的回顾。'
                      : '活动结束后，这里会展示图文和视频复盘。'}
                  </p>
                ) : null}
                {workspace.recaps.map((recap) => (
                  <article className="activity-recap" key={recap.id}>
                    <div className="activity-recap-heading">
                      <h3>{recap.title}</h3>
                      {workspace.canRecap ? (
                        <button type="button" disabled={busy} onClick={() => editRecap(recap)}>
                          编辑复盘
                        </button>
                      ) : null}
                    </div>
                    <time dateTime={recap.updatedAt}>{activityDate(recap.updatedAt)}</time>
                    <ActivityBlockContent
                      blocks={recap.blocks}
                      assets={workspace.assets}
                      client={api}
                    />
                  </article>
                ))}
              </section>
            </div>
            <aside
              ref={timelineRef}
              className="activity-timeline activity-section"
              aria-labelledby="activity-timeline-title"
            >
              <div className="activity-section-heading">
                <div>
                  <p className="activity-eyebrow">LATEST UPDATES</p>
                  <h2 id="activity-timeline-title">活动动态</h2>
                </div>
                {workspace.canEdit ? (
                  <button
                    type="button"
                    className="activity-primary"
                    disabled={busy || updateDraft !== null}
                    onClick={() => editUpdate()}
                  >
                    添加动态
                  </button>
                ) : null}
              </div>
              {updateDraft && workspace.canEdit ? (
                <form
                  className="activity-update-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveUpdate();
                  }}
                >
                  <fieldset disabled={busy}>
                    <div className="activity-update-editor-heading">
                      <strong>{updateDraft.id ? '编辑这条动态' : '记录新的进展'}</strong>
                      <p>选择常用状态或自定义名称，设置发生时间。</p>
                    </div>
                    <div className="activity-status-presets" role="group" aria-label="常用动态名称">
                      {['预告', '开放报名', '报名截止', '初赛', '复赛', '已结束'].map((label) => (
                        <button
                          type="button"
                          key={label}
                          aria-pressed={updateDraft.label === label}
                          onClick={() => setUpdateDraft({ ...updateDraft, label })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label>
                      <span>动态名称</span>
                      <input
                        required
                        maxLength={80}
                        placeholder="例如：开放报名、决赛、集合时间调整"
                        value={updateDraft.label}
                        onChange={(event) =>
                          setUpdateDraft({ ...updateDraft, label: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>日期与时间</span>
                      <input
                        required
                        type="datetime-local"
                        value={updateDraft.date}
                        onChange={(event) =>
                          setUpdateDraft({ ...updateDraft, date: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>动态说明</span>
                      <textarea
                        rows={3}
                        maxLength={4000}
                        placeholder="补充地点、参与方式或本次调整的说明（可选）"
                        value={updateDraft.description}
                        onChange={(event) =>
                          setUpdateDraft({ ...updateDraft, description: event.target.value })
                        }
                      />
                    </label>
                    <p className="activity-editor-hint">
                      保存后会通知关注活动的同学。动态日期不改变实际活动时间和报名截止。
                    </p>
                    <div className="activity-editor-footer">
                      <button className="activity-primary" disabled={loading} type="submit">
                        {updateDraft.id ? '保存动态' : '发布动态'}
                      </button>
                      <button type="button" onClick={() => setUpdateDraft(null)}>
                        取消编辑
                      </button>
                    </div>
                  </fieldset>
                </form>
              ) : null}
              {!workspace.updates.length && !updateDraft ? (
                <p className="activity-muted">新的安排会在这里更新。</p>
              ) : null}
              <ol className="activity-timeline-list">
                {[...workspace.updates]
                  .sort((a, b) => Date.parse(a.occursAt) - Date.parse(b.occursAt))
                  .map((update) => (
                    <li key={update.id}>
                      <time dateTime={update.occursAt}>{timelineDate(update.occursAt)}</time>
                      <h3>{update.label}</h3>
                      {update.description ? <p>{update.description}</p> : null}
                      {workspace.canEdit ? (
                        <div className="activity-timeline-actions">
                          <button
                            disabled={busy}
                            type="button"
                            aria-label={`编辑动态：${update.label}`}
                            onClick={() => editUpdate(update)}
                          >
                            编辑
                          </button>
                          <button
                            disabled={busy}
                            type="button"
                            aria-label={`删除动态：${update.label}`}
                            onClick={() =>
                              void mutate(`/updates/${encodeURIComponent(update.id)}`, 'DELETE', {})
                            }
                          >
                            删除
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
              </ol>
            </aside>
          </div>
        </>
      ) : null}
    </main>
  );
}
export function Bookmark({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4V4Z" />
    </svg>
  );
}
