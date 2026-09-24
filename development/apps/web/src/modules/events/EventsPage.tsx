import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import type { ScopeRef, UserContext } from '@freebbs-development/contracts';
import festivalStageCover from '../../assets/events/student-festival-stage.webp';
import { EditorDrawer } from '../../components/EditorDrawer.js';
import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import { createApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import { DailyDiscovery } from '../discovery/DailyDiscovery.js';
import { FreeBbsMapAction } from '../discovery/FreeBbsMapAction.js';

export interface DevelopmentApi {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

type ActivityStatus =
  'draft' | 'pending' | 'approved' | 'rejected' | 'published' | 'finished' | 'archived';
type TechnicalSupportStatus = 'not_requested' | 'requested' | 'confirmed';

interface ActivityRecord {
  id: string;
  title: string;
  description: string;
  status: ActivityStatus;
  startsAt: string | null;
  endsAt?: string | null;
  location?: string;
  registrationDeadline?: string | null;
  capacity?: number | null;
  contact?: string;
  organizationId?: string | null;
  standingActivity?: boolean;
  technicalSupportStatus: TechnicalSupportStatus;
  technicalSupportNote: string | null;
  ownerUid: string;
  scope: ScopeRef;
}
interface RegistrationRecord {
  id: string;
  activityId: string;
  participantUid: string;
  status: 'registered' | 'cancelled';
}
interface PagePolicy {
  action: string;
  resource: string;
  effect: 'allow' | 'deny';
  scope?: ScopeRef;
}
type PageUser = UserContext & { policies?: readonly PagePolicy[] };

export interface EventsPageProps {
  client?: DevelopmentApi;
  user?: PageUser | null;
}

const publicScope = { type: 'public', id: '*' } as const;
const statusLabels: Record<ActivityStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  approved: '已批准',
  rejected: '已驳回',
  published: '已发布',
  finished: '已结束',
  archived: '已归档',
};
const organizationLabels: Record<string, string> = {
  arts_center: '文艺中心',
  liaison_center: '联络中心',
  sports_center: '体育中心',
  rights_development_center: '权益发展中心',
  tuanwei: '团委',
  sast: '科协',
  tms: 'TMS',
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '未知错误';
}
function formatStart(value: string | null): string {
  if (value === null) return '时间待定';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
export function conciseActivitySummary(description: string, maxLength = 120): string {
  const characters = [...description.trim()];
  return characters.length <= maxLength
    ? characters.join('')
    : `${characters.slice(0, maxLength).join('')}…`;
}
export function utcInstantToLocalDateTimeInput(value: string | null): string {
  if (value === null) return '';
  const date = new Date(value);
  const padded = (part: number, width = 2) => String(part).padStart(width, '0');
  return `${date.getFullYear()}-${padded(date.getMonth() + 1)}-${padded(date.getDate())}T${padded(date.getHours())}:${padded(date.getMinutes())}:${padded(date.getSeconds())}.${padded(date.getMilliseconds(), 3)}`;
}
export function localDateTimeInputToUtcInstant(value: string): string | null {
  return value === '' ? null : new Date(value).toISOString();
}
function matches(pattern: string, value: string): boolean {
  return (
    pattern === '*' ||
    pattern === value ||
    (pattern.endsWith('.*') && value.startsWith(pattern.slice(0, -1)))
  );
}
function sameScope(left: ScopeRef | undefined, right: ScopeRef): boolean {
  return left === undefined || (left.type === right.type && left.id === right.id);
}
function permitted(
  user: PageUser | null,
  action: string,
  resource: 'activity' | 'activity_registration',
  scope: ScopeRef,
): boolean {
  if (user === null) return false;
  const policies = (user.policies ?? []).filter(
    (policy) =>
      matches(policy.action, action) &&
      matches(policy.resource, resource) &&
      sameScope(policy.scope, scope),
  );
  if (policies.some((policy) => policy.effect === 'deny')) return false;
  return policies.some((policy) => policy.effect === 'allow');
}

export function EventsPage({ client, user: suppliedUser }: EventsPageProps) {
  const defaultClient = useMemo(createApiClient, []);
  const activeClient = client ?? defaultClient;
  const auth = useOptionalAuth();
  const user =
    suppliedUser === undefined ? ((auth?.user as PageUser | null) ?? null) : suppliedUser;
  const [activities, setActivities] = useState<ActivityRecord[] | null>(null);
  const [registrations, setRegistrations] = useState<Record<string, RegistrationRecord | null>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyActivityId, setBusyActivityId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStartsAt, setEditStartsAt] = useState('');
  const [editEndsAt, setEditEndsAt] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editRegistrationDeadline, setEditRegistrationDeadline] = useState('');
  const [editCapacity, setEditCapacity] = useState('');
  const [editContact, setEditContact] = useState('');
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createStartsAt, setCreateStartsAt] = useState('');
  const [createEndsAt, setCreateEndsAt] = useState('');
  const [createLocation, setCreateLocation] = useState('');
  const [createRegistrationDeadline, setCreateRegistrationDeadline] = useState('');
  const [createCapacity, setCreateCapacity] = useState('');
  const [createContact, setCreateContact] = useState('');
  const [createOrganizationId, setCreateOrganizationId] = useState('');
  const [createStanding, setCreateStanding] = useState(false);
  const [supportNotes, setSupportNotes] = useState<Record<string, string>>({});
  const organizationOptions = (user?.tags ?? [])
    .map(({ key }) => (key.startsWith('social_org.') ? key.slice('social_org.'.length) : null))
    .filter((value): value is string => value !== null);

  const loadActivities = useCallback(async () => {
    setLoadError(null);
    try {
      const loaded = await activeClient.request<ActivityRecord[]>('/events/activities');
      const loadedRegistrations = await Promise.all(
        loaded.map(async (activity) => {
          const routeScope = { type: 'activity', id: activity.id } as const;
          if (
            activity.status !== 'published' ||
            !permitted(user, 'events.register', 'activity_registration', routeScope)
          ) {
            return [activity.id, null] as const;
          }
          const registration = await activeClient.request<RegistrationRecord | null>(
            `/events/activities/${encodeURIComponent(activity.id)}/registrations`,
          );
          return [activity.id, registration] as const;
        }),
      );
      setActivities(loaded);
      setRegistrations(Object.fromEntries(loadedRegistrations));
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [activeClient, user]);

  useEffect(() => {
    void loadActivities();
  }, [loadActivities]);

  async function runAction(
    activity: ActivityRecord,
    success: string,
    operation: () => Promise<unknown>,
  ) {
    setBusyActivityId(activity.id);
    setFeedback(null);
    setActionError(null);
    try {
      await operation();
      setFeedback(success);
      await loadActivities();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyActivityId(null);
    }
  }

  function beginEdit(activity: ActivityRecord) {
    setEditingId(activity.id);
    setEditTitle(activity.title);
    setEditDescription(activity.description);
    setEditStartsAt(utcInstantToLocalDateTimeInput(activity.startsAt));
    setEditEndsAt(utcInstantToLocalDateTimeInput(activity.endsAt ?? null));
    setEditLocation(activity.location ?? '');
    setEditRegistrationDeadline(
      utcInstantToLocalDateTimeInput(activity.registrationDeadline ?? null),
    );
    setEditCapacity(
      activity.capacity === null || activity.capacity === undefined
        ? ''
        : String(activity.capacity),
    );
    setEditContact(activity.contact ?? '');
  }

  async function saveEdit(activity: ActivityRecord, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = editTitle.trim();
    const description = editDescription.trim();
    if (!title || !description) {
      setActionError('活动名称和介绍不能为空');
      return;
    }
    await runAction(activity, '活动内容已保存', async () => {
      await activeClient.request('/events/activities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activity.id,
          title,
          description,
          startsAt: localDateTimeInputToUtcInstant(editStartsAt),
          endsAt: localDateTimeInputToUtcInstant(editEndsAt),
          location: editLocation.trim(),
          registrationDeadline: localDateTimeInputToUtcInstant(editRegistrationDeadline),
          capacity: editCapacity === '' ? null : Number(editCapacity),
          contact: editContact.trim(),
        }),
      });
      setEditingId(null);
    });
  }

  async function createActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = createTitle.trim();
    const description = createDescription.trim();
    if (!title || !description) {
      setActionError('活动名称和介绍不能为空');
      return;
    }
    setBusyActivityId('new');
    setActionError(null);
    try {
      await activeClient.request('/events/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          startsAt: localDateTimeInputToUtcInstant(createStartsAt),
          endsAt: localDateTimeInputToUtcInstant(createEndsAt),
          location: createLocation.trim(),
          registrationDeadline: localDateTimeInputToUtcInstant(createRegistrationDeadline),
          capacity: createCapacity === '' ? null : Number(createCapacity),
          contact: createContact.trim(),
          organizationId: createOrganizationId || organizationOptions[0] || null,
          standingActivity: createStanding,
          status: 'draft',
          scope: publicScope,
        }),
      });
      setCreateTitle('');
      setCreateDescription('');
      setCreateStartsAt('');
      setCreateEndsAt('');
      setCreateLocation('');
      setCreateRegistrationDeadline('');
      setCreateCapacity('');
      setCreateContact('');
      setCreateOrganizationId('');
      setCreateStanding(false);
      setCreateDrawerOpen(false);
      setFeedback('活动草稿已创建');
      await loadActivities();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyActivityId(null);
    }
  }

  async function transition(activity: ActivityRecord, to: ActivityStatus, success: string) {
    if ((to === 'rejected' || to === 'archived') && !window.confirm(`确定${success}吗？`)) return;
    await runAction(activity, success, () =>
      activeClient.request(`/events/activities/${encodeURIComponent(activity.id)}/transitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      }),
    );
  }

  async function updateSupport(activity: ActivityRecord, to: 'requested' | 'confirmed') {
    await runAction(activity, to === 'requested' ? '技术支持已申请' : '技术支持已确认', () =>
      activeClient.request(
        `/events/activities/${encodeURIComponent(activity.id)}/technical-support`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to,
            note: supportNotes[activity.id] ?? activity.technicalSupportNote ?? undefined,
          }),
        },
      ),
    );
  }

  async function register(activity: ActivityRecord) {
    await runAction(activity, '报名成功', () =>
      activeClient.request(`/events/activities/${encodeURIComponent(activity.id)}/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    );
  }

  async function cancel(activity: ActivityRecord) {
    if (!window.confirm(`确定取消“${activity.title}”的报名吗？`)) return;
    await runAction(activity, '报名已取消', () =>
      activeClient.request<void>(
        `/events/activities/${encodeURIComponent(activity.id)}/registrations`,
        { method: 'DELETE' },
      ),
    );
  }

  const canCreate = permitted(user, 'events.create', 'activity', publicScope);

  return (
    <section className="module-page" aria-label="無活动">
      <ModulePageHeader
        title="無活动"
        description="发现近期活动，查看安排与报名信息。"
        actions={
          <>
            <FreeBbsMapAction />
            {canCreate ? (
              <button type="button" onClick={() => setCreateDrawerOpen(true)}>
                创建活动
              </button>
            ) : null}
          </>
        }
      />

      <Link className="festival-entrance" to="/events/student-festival">
        <div className="festival-entrance-copy">
          <span className="festival-eyebrow">置顶 · 学生节特别企划</span>
          <strong>我要上学生节</strong>
          <p>分享你的节目与创意，让热爱走上舞台。</p>
        </div>
        <img
          className="festival-entrance-cover"
          src={festivalStageCover}
          alt="小羊在学生节舞台演唱，台下小羊观众正在观看"
        />
        <span className="festival-entrance-arrow" aria-hidden="true">
          ↗
        </span>
      </Link>

      <DailyDiscovery client={activeClient} uid={user?.uid ?? 'guest'} activities={activities} />

      {feedback !== null && <p role="status">{feedback}</p>}
      {actionError !== null && <p role="alert">{actionError}</p>}
      {activities === null && loadError === null && <p role="status">正在加载活动…</p>}
      {loadError !== null && <p role="alert">活动加载失败：{loadError}</p>}
      {activities?.length === 0 && <p>暂无活动</p>}

      {activities !== null && activities.length > 0 ? (
        <div className="workbench-grid">
          {activities.map((activity) => {
            const canUpdate = permitted(user, 'events.update', 'activity', activity.scope);
            const canCreateOwn =
              activity.ownerUid === user?.uid &&
              permitted(user, 'events.create', 'activity', activity.scope);
            const canManageCreatorEdge = canUpdate || canCreateOwn;
            const canApprove = permitted(user, 'events.approve', 'activity', activity.scope);
            const canSupport = permitted(
              user,
              'events.technical_support',
              'activity',
              activity.scope,
            );
            const registrationScope = { type: 'activity', id: activity.id } as const;
            const canRegister = permitted(
              user,
              'events.register',
              'activity_registration',
              registrationScope,
            );
            const canCancel = permitted(
              user,
              'events.cancel_registration',
              'activity_registration',
              registrationScope,
            );
            const registration = registrations[activity.id];
            const registered = registration?.status === 'registered';
            const busy = busyActivityId === activity.id;
            const headingId = `activity-${activity.id}-title`;

            return (
              <article
                className="workbench-card event-card"
                aria-labelledby={headingId}
                key={activity.id}
              >
                <header className="event-card-top">
                  <time
                    className="event-date-stamp"
                    dateTime={activity.startsAt ?? undefined}
                    aria-label={formatStart(activity.startsAt)}
                  >
                    <span>
                      {activity.startsAt
                        ? new Date(activity.startsAt).getMonth() + 1 + '月'
                        : '日期'}
                    </span>
                    <strong>
                      {activity.startsAt
                        ? String(new Date(activity.startsAt).getDate()).padStart(2, '0')
                        : '待定'}
                    </strong>
                  </time>
                  <div className="event-card-heading">
                    <div className="event-card-labels">
                      <span
                        className="status-badge"
                        data-status={activity.status === 'published' ? 'success' : 'warning'}
                      >
                        {statusLabels[activity.status]}
                      </span>
                      {activity.standingActivity ? (
                        <span className="event-standing-label">常设活动</span>
                      ) : null}
                    </div>
                    <h3 id={headingId}>
                      <Link to={'/events/' + encodeURIComponent(activity.id)}>
                        {activity.title}
                      </Link>
                    </h3>
                  </div>
                </header>
                <p
                  className="activity-summary"
                  aria-label={'完整活动介绍：' + activity.description}
                >
                  {conciseActivitySummary(activity.description)}
                </p>
                <div className="event-card-facts">
                  <p>开始时间：{formatStart(activity.startsAt)}</p>
                  <p>地点：{activity.location || '待定'}</p>
                  <p>
                    主办：
                    {activity.organizationId
                      ? (organizationLabels[activity.organizationId] ?? activity.organizationId)
                      : '平台'}
                  </p>
                </div>
                <details className="event-card-disclosure">
                  <summary>报名与联系信息</summary>
                  <div className="event-card-extra">
                    <p>结束时间：{formatStart(activity.endsAt ?? null)}</p>
                    <p>报名截止：{formatStart(activity.registrationDeadline ?? null)}</p>
                    <p>
                      容量：
                      {activity.capacity === null || activity.capacity === undefined
                        ? '不限'
                        : activity.capacity + ' 人'}
                    </p>
                    <p>联系人：{activity.contact || '待公布'}</p>
                  </div>
                </details>
                <footer className="event-card-footer">
                  <Link
                    className="event-detail-link"
                    to={'/events/' + encodeURIComponent(activity.id)}
                  >
                    查看详情与时间线 <span aria-hidden="true">↗</span>
                  </Link>
                  {registered ? <span className="event-registration-state">已报名</span> : null}
                  {activity.status === 'published' && canRegister ? (
                    registered && canCancel ? (
                      <button type="button" disabled={busy} onClick={() => void cancel(activity)}>
                        取消报名
                      </button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => void register(activity)}>
                        报名活动
                      </button>
                    )
                  ) : null}
                </footer>
                {canManageCreatorEdge || canApprove || canSupport ? (
                  <details className="event-card-disclosure event-card-management">
                    <summary>管理活动</summary>
                    <div className="event-management-body">
                      {canManageCreatorEdge &&
                      (activity.status === 'draft' || activity.status === 'rejected') ? (
                        <button
                          type="button"
                          aria-label={`编辑${activity.title}`}
                          onClick={() => beginEdit(activity)}
                        >
                          编辑
                        </button>
                      ) : null}

                      <div className="action-row">
                        {canManageCreatorEdge && activity.status === 'draft' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void transition(activity, 'pending', '活动已提交审核')}
                          >
                            提交审核
                          </button>
                        ) : null}
                        {canApprove && activity.status === 'pending' ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void transition(activity, 'approved', '活动已批准')}
                            >
                              批准活动
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void transition(activity, 'rejected', '驳回活动')}
                            >
                              驳回活动
                            </button>
                          </>
                        ) : null}
                        {canManageCreatorEdge && activity.status === 'rejected' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void transition(activity, 'draft', '活动已转回草稿')}
                          >
                            修订为草稿
                          </button>
                        ) : null}
                        {canUpdate && activity.status === 'approved' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void transition(activity, 'published', '活动已发布')}
                          >
                            发布活动
                          </button>
                        ) : null}
                        {canUpdate && activity.status === 'published' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void transition(activity, 'finished', '活动已结束')}
                          >
                            结束活动
                          </button>
                        ) : null}
                        {canUpdate && activity.status === 'finished' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void transition(activity, 'archived', '归档活动')}
                          >
                            归档活动
                          </button>
                        ) : null}
                      </div>

                      {canUpdate || canSupport ? (
                        <section aria-label={`${activity.title}技术支持`}>
                          <h4>技术支持</h4>
                          <p>
                            {activity.technicalSupportStatus === 'not_requested'
                              ? '尚未申请'
                              : activity.technicalSupportStatus === 'requested'
                                ? '等待确认'
                                : '已确认'}
                          </p>
                          {activity.technicalSupportStatus !== 'confirmed' ? (
                            <label>
                              支持说明
                              <input
                                value={
                                  supportNotes[activity.id] ?? activity.technicalSupportNote ?? ''
                                }
                                onChange={(event) =>
                                  setSupportNotes((current) => ({
                                    ...current,
                                    [activity.id]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                          ) : null}
                          {canUpdate && activity.technicalSupportStatus === 'not_requested' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void updateSupport(activity, 'requested')}
                            >
                              申请技术支持
                            </button>
                          ) : null}
                          {canSupport && activity.technicalSupportStatus === 'requested' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void updateSupport(activity, 'confirmed')}
                            >
                              确认技术支持
                            </button>
                          ) : null}
                        </section>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      <EditorDrawer
        open={editingId !== null || createDrawerOpen}
        title={editingId === null ? '创建活动草稿' : '编辑活动'}
        description="活动资料在保存前会保留在此编辑器中。"
        onClose={() => {
          setEditingId(null);
          setCreateDrawerOpen(false);
        }}
      >
        {editingId !== null ? (
          <form
            onSubmit={(event) => {
              const activity = activities?.find(({ id }) => id === editingId);
              if (activity !== undefined) void saveEdit(activity, event);
            }}
          >
            <label>
              活动名称
              <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
            </label>
            <label>
              活动介绍
              <textarea
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
              />
            </label>
            <label>
              开始时间（可选）
              <input
                type="datetime-local"
                step="0.001"
                value={editStartsAt}
                onChange={(event) => setEditStartsAt(event.target.value)}
              />
            </label>
            <label>
              结束时间（可选）
              <input
                type="datetime-local"
                step="0.001"
                value={editEndsAt}
                onChange={(event) => setEditEndsAt(event.target.value)}
              />
            </label>
            <label>
              报名截止（可选）
              <input
                type="datetime-local"
                step="0.001"
                value={editRegistrationDeadline}
                onChange={(event) => setEditRegistrationDeadline(event.target.value)}
              />
            </label>
            <label>
              地点
              <input
                value={editLocation}
                onChange={(event) => setEditLocation(event.target.value)}
              />
            </label>
            <label>
              容量（可选）
              <input
                type="number"
                min="1"
                value={editCapacity}
                onChange={(event) => setEditCapacity(event.target.value)}
              />
            </label>
            <label>
              联系人
              <input value={editContact} onChange={(event) => setEditContact(event.target.value)} />
            </label>
            <button type="submit" disabled={busyActivityId === editingId}>
              保存活动
            </button>
          </form>
        ) : (
          <form onSubmit={createActivity}>
            <label>
              新活动名称
              <input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} />
            </label>
            <label>
              新活动介绍
              <textarea
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
              />
            </label>
            <label>
              开始时间（可选）
              <input
                type="datetime-local"
                step="0.001"
                value={createStartsAt}
                onChange={(event) => setCreateStartsAt(event.target.value)}
              />
            </label>
            <label>
              结束时间（可选）
              <input
                type="datetime-local"
                step="0.001"
                value={createEndsAt}
                onChange={(event) => setCreateEndsAt(event.target.value)}
              />
            </label>
            <label>
              报名截止（可选）
              <input
                type="datetime-local"
                step="0.001"
                value={createRegistrationDeadline}
                onChange={(event) => setCreateRegistrationDeadline(event.target.value)}
              />
            </label>
            <label>
              地点
              <input
                value={createLocation}
                onChange={(event) => setCreateLocation(event.target.value)}
              />
            </label>
            <label>
              容量（可选）
              <input
                type="number"
                min="1"
                value={createCapacity}
                onChange={(event) => setCreateCapacity(event.target.value)}
              />
            </label>
            <label>
              联系人
              <input
                value={createContact}
                onChange={(event) => setCreateContact(event.target.value)}
              />
            </label>
            {organizationOptions.length > 1 ? (
              <label>
                主办组织
                <select
                  value={createOrganizationId}
                  onChange={(event) => setCreateOrganizationId(event.target.value)}
                >
                  <option value="">选择主办组织</option>
                  {organizationOptions.map((organizationId) => (
                    <option value={organizationId} key={organizationId}>
                      {organizationLabels[organizationId] ?? organizationId}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              <input
                type="checkbox"
                checked={createStanding}
                onChange={(event) => setCreateStanding(event.target.checked)}
              />
              常设活动
            </label>
            <button type="submit" disabled={busyActivityId === 'new'}>
              保存草稿
            </button>
          </form>
        )}
      </EditorDrawer>
    </section>
  );
}
