import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import {
  organizationForRole,
  type ScopeRef,
  type UserContext,
} from '@freebbs-development/contracts';
import { EditorDrawer } from '../../components/EditorDrawer.js';
import { createApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';

export interface DevelopmentApi {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

interface MilestoneRecord {
  id: string;
  occursAt: string;
  title: string;
  type: string;
  description: string;
  completed: boolean;
  displayOrder: number;
}

interface FixtureRecord {
  id: string;
  round: string;
  participantA: string;
  participantB: string;
  scheduledAt: string;
  location: string;
  score: string | null;
}

interface ActivityDetail {
  id: string;
  title: string;
  description: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  location: string;
  registrationDeadline: string | null;
  capacity: number | null;
  registrationCount: number;
  contact: string;
  organizationId: string | null;
  standingActivity: boolean;
  clubId: string | null;
  ownerUid: string;
  scope: ScopeRef;
  milestones: MilestoneRecord[];
  fixtures: FixtureRecord[];
  progress: { completed: number; total: number; percentage: number } | null;
}

interface RegistrationRecord {
  status: 'registered' | 'cancelled';
}

interface PagePolicy {
  action: string;
  resource: string;
  effect: 'allow' | 'deny';
  scope?: ScopeRef;
}

type PageUser = UserContext & { policies?: readonly PagePolicy[] };

export interface ActivityDetailPageProps {
  activityId: string;
  client?: DevelopmentApi;
  user?: PageUser | null;
}

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

function formatDateTime(value: string | null): string {
  if (value === null) return '待定';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function localDateTimeToInstant(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function utcInstantToLocalDateTimeInput(value: string): string {
  const date = new Date(value);
  const padded = (part: number, width = 2) => String(part).padStart(width, '0');
  return `${date.getFullYear()}-${padded(date.getMonth() + 1)}-${padded(date.getDate())}T${padded(date.getHours())}:${padded(date.getMinutes())}:${padded(date.getSeconds())}.${padded(date.getMilliseconds(), 3)}`;
}

function canUpdateOrganization(user: PageUser | null, organizationId: string | null): boolean {
  if (organizationId === null) return true;
  return Boolean(
    user?.roles.includes('platform.super_admin') ||
    user?.roles.some((role) => {
      const membership = organizationForRole(role);
      return (
        membership?.organizationId === organizationId &&
        (membership.level === 'director' || membership.level === 'lead')
      );
    }),
  );
}

function matches(pattern: string, value: string): boolean {
  return (
    pattern === '*' ||
    pattern === value ||
    (pattern.endsWith('.*') && value.startsWith(pattern.slice(0, -1)))
  );
}

function permitted(
  user: PageUser | null,
  action: string,
  resource: string,
  scope: ScopeRef,
): boolean {
  if (user === null) return false;
  const policies = (user.policies ?? []).filter(
    (policy) =>
      matches(policy.action, action) &&
      matches(policy.resource, resource) &&
      (policy.scope === undefined ||
        (policy.scope.type === scope.type && policy.scope.id === scope.id)),
  );
  return (
    !policies.some(({ effect }) => effect === 'deny') &&
    policies.some(({ effect }) => effect === 'allow')
  );
}

export function ActivityDetailPage({
  activityId,
  client,
  user: suppliedUser,
}: ActivityDetailPageProps) {
  const defaultClient = useMemo(createApiClient, []);
  const activeClient = client ?? defaultClient;
  const auth = useOptionalAuth();
  const user =
    suppliedUser === undefined ? ((auth?.user as PageUser | null) ?? null) : suppliedUser;
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [registration, setRegistration] = useState<RegistrationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDescription, setMilestoneDescription] = useState('');
  const [milestoneAt, setMilestoneAt] = useState('');
  const [fixtureRound, setFixtureRound] = useState('');
  const [fixtureA, setFixtureA] = useState('');
  const [fixtureB, setFixtureB] = useState('');
  const [fixtureAt, setFixtureAt] = useState('');
  const [fixtureLocation, setFixtureLocation] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await activeClient.request<ActivityDetail>(
        `/events/activities/${encodeURIComponent(activityId)}`,
      );
      setDetail(loaded);
      const registrationScope = { type: 'activity', id: activityId } as const;
      if (
        loaded.status === 'published' &&
        permitted(user, 'events.register', 'activity_registration', registrationScope)
      ) {
        setRegistration(
          await activeClient.request<RegistrationRecord | null>(
            `/events/activities/${encodeURIComponent(activityId)}/registrations`,
          ),
        );
      } else {
        setRegistration(null);
      }
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [activeClient, activityId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateRegistration(method: 'POST' | 'DELETE') {
    setBusy(true);
    setFeedback(null);
    setError(null);
    try {
      await activeClient.request(
        `/events/activities/${encodeURIComponent(activityId)}/registrations`,
        method === 'POST'
          ? {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            }
          : { method },
      );
      setFeedback(method === 'POST' ? '报名成功' : '报名已取消');
      await load();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(false);
    }
  }

  async function addMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!milestoneTitle.trim() || !milestoneDescription.trim() || !milestoneAt) {
      setError('请填写节点名称、节点说明和发生时间');
      return;
    }
    const occursAt = localDateTimeToInstant(milestoneAt);
    if (occursAt === null) {
      setError('请输入有效的发生时间');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await activeClient.request(
        `/events/activities/${encodeURIComponent(activityId)}/milestones`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            occursAt,
            title: milestoneTitle.trim(),
            type: 'workflow',
            description: milestoneDescription.trim(),
            completed: false,
            displayOrder:
              (detail?.milestones.reduce(
                (highest, milestone) => Math.max(highest, milestone.displayOrder),
                -1,
              ) ?? -1) + 1,
          }),
        },
      );
      setMilestoneTitle('');
      setMilestoneDescription('');
      setMilestoneAt('');
      setFeedback('活动节点已添加');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function addFixture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !fixtureRound.trim() ||
      !fixtureA.trim() ||
      !fixtureB.trim() ||
      !fixtureAt ||
      !fixtureLocation.trim()
    ) {
      setError('请填写轮次、参赛双方、比赛时间和比赛地点');
      return;
    }
    const scheduledAt = localDateTimeToInstant(fixtureAt);
    if (scheduledAt === null) {
      setError('请输入有效的比赛时间');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await activeClient.request(`/events/activities/${encodeURIComponent(activityId)}/fixtures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round: fixtureRound.trim(),
          participantA: fixtureA.trim(),
          participantB: fixtureB.trim(),
          scheduledAt,
          location: fixtureLocation.trim(),
          score: null,
        }),
      });
      setFixtureRound('');
      setFixtureA('');
      setFixtureB('');
      setFixtureAt('');
      setFixtureLocation('');
      setFeedback('赛程已添加');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function updateMilestone(milestoneId: string, patch: Partial<MilestoneRecord>) {
    setBusy(true);
    setError(null);
    try {
      await activeClient.request(
        `/events/activities/${encodeURIComponent(activityId)}/milestones/${encodeURIComponent(milestoneId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
      );
      setFeedback('活动节点已更新');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function deleteMilestone(milestoneId: string) {
    setBusy(true);
    setError(null);
    try {
      await activeClient.request(
        `/events/activities/${encodeURIComponent(activityId)}/milestones/${encodeURIComponent(milestoneId)}`,
        { method: 'DELETE' },
      );
      setFeedback('活动节点已删除');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function updateFixture(fixtureId: string, patch: Partial<FixtureRecord>) {
    setBusy(true);
    setError(null);
    try {
      await activeClient.request(
        `/events/activities/${encodeURIComponent(activityId)}/fixtures/${encodeURIComponent(fixtureId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
      );
      setFeedback('赛程已更新');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function deleteFixture(fixtureId: string) {
    setBusy(true);
    setError(null);
    try {
      await activeClient.request(
        `/events/activities/${encodeURIComponent(activityId)}/fixtures/${encodeURIComponent(fixtureId)}`,
        { method: 'DELETE' },
      );
      setFeedback('赛程已删除');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">正在加载活动详情…</p>;
  if (error !== null && detail === null) return <p role="alert">活动详情加载失败：{error}</p>;
  if (detail === null) return null;

  const registrationScope = { type: 'activity', id: activityId } as const;
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
  const canMaintain =
    (permitted(user, 'events.update', 'activity', detail.scope) &&
      canUpdateOrganization(user, detail.organizationId)) ||
    (detail.ownerUid === user?.uid &&
      permitted(user, 'events.create', 'activity', detail.scope) &&
      (detail.status === 'draft' || detail.status === 'rejected'));
  const milestones = [...detail.milestones].sort(
    (left, right) =>
      left.displayOrder - right.displayOrder || left.occursAt.localeCompare(right.occursAt),
  );
  const completed = milestones.filter((milestone) => milestone.completed).length;
  const registrationCount = detail.registrationCount ?? 0;
  const progress =
    milestones.length === 0 ? null : Math.round((completed / milestones.length) * 100);
  const registrationState =
    user === null
      ? '请登录后查看报名状态'
      : registration?.status === 'registered'
        ? '已报名'
        : detail.status !== 'published'
          ? '报名尚未开放'
          : !canRegister
            ? '当前不可报名'
            : detail.registrationDeadline !== null &&
                Date.parse(detail.registrationDeadline) <= Date.now()
              ? '报名已截止'
              : detail.capacity !== null && registrationCount >= detail.capacity
                ? '名额已满'
                : '未报名';
  const registrationUnavailable =
    (detail.registrationDeadline !== null &&
      Date.parse(detail.registrationDeadline) <= Date.now()) ||
    (detail.capacity !== null && registrationCount >= detail.capacity);

  return (
    <section className="module-page" aria-labelledby="activity-detail-title">
      <Link to="/events">← 返回活动列表</Link>
      <header className="page-section-header">
        <div>
          <p className="eyebrow">{detail.standingActivity ? '常设活动' : '活动详情'}</p>
          <h2 id="activity-detail-title">{detail.title}</h2>
          <p>{detail.description}</p>
        </div>
      </header>

      {feedback !== null ? <p role="status">{feedback}</p> : null}
      {error !== null ? <p role="alert">{error}</p> : null}

      <dl>
        <div>
          <dt>时间</dt>
          <dd>
            {formatDateTime(detail.startsAt)} — {formatDateTime(detail.endsAt)}
          </dd>
        </div>
        <div>
          <dt>地点</dt>
          <dd>{detail.location || '待定'}</dd>
        </div>
        <div>
          <dt>报名截止</dt>
          <dd>{formatDateTime(detail.registrationDeadline)}</dd>
        </div>
        <div>
          <dt>容量</dt>
          <dd>{detail.capacity === null ? '不限' : `${detail.capacity} 人`}</dd>
        </div>
        {detail.capacity !== null ? (
          <div>
            <dt>报名人数</dt>
            <dd>
              {registrationCount >= detail.capacity
                ? `名额已满（${registrationCount} / ${detail.capacity}）`
                : `${registrationCount} / ${detail.capacity}`}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>联系人</dt>
          <dd>{detail.contact || '待公布'}</dd>
        </div>
        <div>
          <dt>主办组织</dt>
          <dd>
            {detail.organizationId === null
              ? '平台'
              : (organizationLabels[detail.organizationId] ?? detail.organizationId)}
          </dd>
        </div>
      </dl>

      {progress !== null ? (
        <section aria-labelledby="activity-progress-title">
          <h3 id="activity-progress-title">筹备进度</h3>
          <div
            role="progressbar"
            aria-label="活动筹备进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <p>
            已完成 {completed} / {milestones.length} 项（{progress}%）
          </p>
        </section>
      ) : null}

      <section aria-labelledby="activity-timeline-title">
        <h3 id="activity-timeline-title">活动时间线</h3>
        {milestones.length === 0 ? (
          <p>尚未发布流程</p>
        ) : (
          <ol aria-label="活动时间线">
            {milestones.map((milestone) => (
              <li key={milestone.id}>
                <time dateTime={milestone.occursAt}>{formatDateTime(milestone.occursAt)}</time>
                <strong>{milestone.title}</strong>
                <span>{milestone.completed ? '已完成' : '待进行'}</span>
                <p>{milestone.description}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {detail.fixtures.length > 0 ? (
        <section aria-labelledby="competition-preview-title">
          <h3 id="competition-preview-title">比赛预览</h3>
          <table aria-label="比赛预览">
            <thead>
              <tr>
                <th>轮次</th>
                <th>对阵</th>
                <th>时间</th>
                <th>地点</th>
                <th>比分</th>
              </tr>
            </thead>
            <tbody>
              {detail.fixtures.map((fixture) => (
                <tr key={fixture.id}>
                  <td>{fixture.round}</td>
                  <td>
                    {fixture.participantA} vs {fixture.participantB}
                  </td>
                  <td>{formatDateTime(fixture.scheduledAt)}</td>
                  <td>{fixture.location}</td>
                  <td>{fixture.score ?? '未开始'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {detail.status === 'published' && canRegister ? (
        registration?.status === 'registered' && canCancel ? (
          <button type="button" disabled={busy} onClick={() => void updateRegistration('DELETE')}>
            取消报名
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || registrationUnavailable}
            onClick={() => void updateRegistration('POST')}
          >
            报名活动
          </button>
        )
      ) : null}
      <p aria-label="报名状态">报名状态：{registrationState}</p>

      {canMaintain ? (
        <button type="button" onClick={() => setMaintenanceOpen(true)}>
          维护活动流程
        </button>
      ) : null}

      {canMaintain ? (
        <EditorDrawer
          open={maintenanceOpen}
          title="维护活动流程"
          description="在当前活动中维护筹备节点和比赛赛程。"
          onClose={() => setMaintenanceOpen(false)}
        >
          <section aria-labelledby="add-milestone-title">
            <h3 id="add-milestone-title">添加筹备节点</h3>
            <form onSubmit={(event) => void addMilestone(event)}>
              <label>
                节点名称
                <input
                  value={milestoneTitle}
                  onChange={(event) => setMilestoneTitle(event.target.value)}
                />
              </label>
              <label>
                节点说明
                <textarea
                  value={milestoneDescription}
                  onChange={(event) => setMilestoneDescription(event.target.value)}
                />
              </label>
              <label>
                发生时间
                <input
                  type="datetime-local"
                  step="0.001"
                  value={milestoneAt}
                  onChange={(event) => setMilestoneAt(event.target.value)}
                />
              </label>
              <button type="submit" disabled={busy}>
                添加节点
              </button>
            </form>
            {milestones.length > 0 ? (
              <ul aria-label="维护活动节点">
                {milestones.map((milestone) => (
                  <li key={milestone.id}>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const values = new FormData(event.currentTarget);
                        const title = String(values.get('title')).trim();
                        const description = String(values.get('description')).trim();
                        const occursAt = localDateTimeToInstant(String(values.get('occursAt')));
                        const displayOrder = Number(values.get('displayOrder'));
                        if (
                          !title ||
                          !description ||
                          occursAt === null ||
                          !Number.isInteger(displayOrder) ||
                          displayOrder < 0
                        ) {
                          setError('请填写节点名称、节点说明、有效发生时间和显示顺序');
                          return;
                        }
                        void updateMilestone(milestone.id, {
                          title,
                          description,
                          occursAt,
                          displayOrder,
                          completed: values.get('completed') === 'on',
                        });
                      }}
                    >
                      <label>
                        节点名称
                        <input name="title" required defaultValue={milestone.title} />
                      </label>
                      <label>
                        节点说明
                        <textarea
                          name="description"
                          required
                          defaultValue={milestone.description}
                        />
                      </label>
                      <label>
                        发生时间
                        <input
                          name="occursAt"
                          type="datetime-local"
                          step="0.001"
                          required
                          defaultValue={utcInstantToLocalDateTimeInput(milestone.occursAt)}
                        />
                      </label>
                      <label>
                        显示顺序
                        <input
                          name="displayOrder"
                          type="number"
                          min="0"
                          required
                          defaultValue={milestone.displayOrder}
                        />
                      </label>
                      <label>
                        <input
                          name="completed"
                          type="checkbox"
                          defaultChecked={milestone.completed}
                        />
                        已完成
                      </label>
                      <button type="submit" disabled={busy}>
                        保存节点：{milestone.title}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void updateMilestone(milestone.id, { completed: !milestone.completed })
                        }
                      >
                        标记{milestone.completed ? '未完成' : '已完成'}：{milestone.title}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteMilestone(milestone.id)}
                      >
                        删除节点：{milestone.title}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <section aria-labelledby="add-fixture-title">
            <h3 id="add-fixture-title">添加比赛赛程</h3>
            <form onSubmit={(event) => void addFixture(event)}>
              <label>
                轮次
                <input
                  value={fixtureRound}
                  onChange={(event) => setFixtureRound(event.target.value)}
                />
              </label>
              <label>
                参赛方 A
                <input value={fixtureA} onChange={(event) => setFixtureA(event.target.value)} />
              </label>
              <label>
                参赛方 B
                <input value={fixtureB} onChange={(event) => setFixtureB(event.target.value)} />
              </label>
              <label>
                比赛时间
                <input
                  type="datetime-local"
                  step="0.001"
                  value={fixtureAt}
                  onChange={(event) => setFixtureAt(event.target.value)}
                />
              </label>
              <label>
                比赛地点
                <input
                  value={fixtureLocation}
                  onChange={(event) => setFixtureLocation(event.target.value)}
                />
              </label>
              <button type="submit" disabled={busy}>
                添加赛程
              </button>
            </form>
            {detail.fixtures.length > 0 ? (
              <ul aria-label="维护比赛赛程">
                {detail.fixtures.map((fixture) => (
                  <li key={fixture.id}>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const values = new FormData(event.currentTarget);
                        const round = String(values.get('round')).trim();
                        const participantA = String(values.get('participantA')).trim();
                        const participantB = String(values.get('participantB')).trim();
                        const scheduledAt = localDateTimeToInstant(
                          String(values.get('scheduledAt')),
                        );
                        const location = String(values.get('location')).trim();
                        if (
                          !round ||
                          !participantA ||
                          !participantB ||
                          scheduledAt === null ||
                          !location
                        ) {
                          setError('请填写轮次、参赛双方、有效比赛时间和比赛地点');
                          return;
                        }
                        void updateFixture(fixture.id, {
                          round,
                          participantA,
                          participantB,
                          scheduledAt,
                          location,
                          score: String(values.get('score')).trim() || null,
                        });
                      }}
                    >
                      <label>
                        轮次
                        <input name="round" required defaultValue={fixture.round} />
                      </label>
                      <label>
                        参赛方 A
                        <input name="participantA" required defaultValue={fixture.participantA} />
                      </label>
                      <label>
                        参赛方 B
                        <input name="participantB" required defaultValue={fixture.participantB} />
                      </label>
                      <label>
                        比赛时间
                        <input
                          name="scheduledAt"
                          type="datetime-local"
                          step="0.001"
                          required
                          defaultValue={utcInstantToLocalDateTimeInput(fixture.scheduledAt)}
                        />
                      </label>
                      <label>
                        比赛地点
                        <input name="location" required defaultValue={fixture.location} />
                      </label>
                      <label>
                        比分
                        <input name="score" defaultValue={fixture.score ?? ''} />
                      </label>
                      <button type="submit" disabled={busy}>
                        保存赛程：{fixture.round}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteFixture(fixture.id)}
                      >
                        删除赛程：{fixture.round}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </EditorDrawer>
      ) : null}
    </section>
  );
}
