import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import type { ScopeRef, UserContext } from '@freebbs-development/contracts';
import { ApiError, createApiClient, type ApiClient } from '../../core/api/client.js';
import { ProposalPool } from './ProposalPool.js';

type AnnouncementStatus = 'draft' | 'published' | 'archived';
type ConsultationStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
type InformationUser = UserContext & {
  policies?: readonly { action: string; effect?: 'allow' | 'deny'; scope?: ScopeRef }[];
};

interface Announcement {
  id: string;
  title: string;
  body: string;
  status: AnnouncementStatus;
  ownerUid: string;
  scope: ScopeRef;
  createdAt: string;
  updatedAt: string;
}

interface Consultation {
  dueAt: string | null;
  id: string;
  title: string;
  body: string;
  status: ConsultationStatus;
  requesterUid: string;
  assigneeUid: string | null;
  reply: string | null;
  ownerUid: string;
  scope: ScopeRef;
  createdAt: string;
  updatedAt: string;
}

export interface InformationPageProps {
  client?: Pick<ApiClient, 'request'>;
  user?: InformationUser | null;
  view?: 'announcements' | 'consultations' | 'triage';
}

const announcementStatusLabels: Record<AnnouncementStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};
const consultationStatusLabels: Record<ConsultationStatus, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

function matches(pattern: string, permission: string): boolean {
  return (
    pattern === '*' ||
    pattern === permission ||
    (pattern.endsWith('.*') && permission.startsWith(pattern.slice(0, -1)))
  );
}

function hasPermission(
  user: InformationUser | null | undefined,
  permission: string,
  scope: ScopeRef,
): boolean {
  if (!user) return false;
  const policies = (user.policies ?? []).filter(
    (policy) =>
      matches(policy.action, permission) &&
      (policy.scope === undefined ||
        (policy.scope.type === scope.type && policy.scope.id === scope.id)),
  );
  return (
    !policies.some((policy) => policy.effect === 'deny') &&
    policies.some((policy) => policy.effect !== 'deny')
  );
}

function hasAnyPermission(user: InformationUser | null | undefined, permission: string): boolean {
  return (user?.policies ?? []).some(
    (policy) => matches(policy.action, permission) && policy.effect !== 'deny',
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function InformationPage({ client, user, view }: InformationPageProps) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const hasTriageQueue = hasAnyPermission(user, 'information.consultation.triage');
  const showAnnouncements = view === undefined || view === 'announcements';
  const showConsultations =
    view === undefined || view === 'consultations' || (view === 'triage' && hasTriageQueue);
  const mayTriage = hasTriageQueue && (view === undefined || view === 'triage');
  const canCreatePublicAnnouncement = hasPermission(user, 'information.announcement.create', {
    type: 'public',
    id: '*',
  });
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);
  const [editAnnouncementTitle, setEditAnnouncementTitle] = useState('');
  const [editAnnouncementBody, setEditAnnouncementBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [handlingId, setHandlingId] = useState<string | null>(null);
  const [assigneeUid, setAssigneeUid] = useState('');
  const [reply, setReply] = useState('');
  const [consultationDueAt, setConsultationDueAt] = useState('');

  const loadInformation = useCallback(
    async (announceLoading = true) => {
      if (announceLoading) setLoading(true);
      setLoadError(false);
      try {
        const [loadedAnnouncements, loadedConsultations] = await Promise.all([
          showAnnouncements
            ? api.request<Announcement[]>('/information/announcements')
            : Promise.resolve([]),
          showConsultations
            ? api.request<Consultation[]>('/information/consultations')
            : Promise.resolve([]),
        ]);
        setAnnouncements(loadedAnnouncements);
        setConsultations(loadedConsultations);
      } catch {
        setLoadError(true);
      } finally {
        if (announceLoading) setLoading(false);
      }
    },
    [api, showAnnouncements, showConsultations],
  );

  useEffect(() => {
    void loadInformation();
  }, [loadInformation]);

  async function submitConsultation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setOperationError(null);
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle) {
      setFormError('咨询标题不能为空');
      return;
    }
    if (!cleanBody) {
      setFormError('咨询内容不能为空');
      return;
    }
    setFormError(null);
    setPending(true);
    try {
      await api.request<Consultation>('/information/consultations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: cleanTitle, body: cleanBody }),
      });
      setTitle('');
      setBody('');
      setFeedback('咨询已提交');
      await loadInformation(false);
    } catch (error) {
      setFormError(errorMessage(error, '咨询提交失败，请稍后重试'));
    } finally {
      setPending(false);
    }
  }

  function beginConsultationEdit(item: Consultation) {
    setOperationError(null);
    setFeedback(null);
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditBody(item.body);
  }

  async function saveConsultationEdit(event: FormEvent<HTMLFormElement>, item: Consultation) {
    event.preventDefault();
    const cleanTitle = editTitle.trim();
    const cleanBody = editBody.trim();
    if (!cleanTitle || !cleanBody) {
      setOperationError('咨询标题和内容不能为空');
      return;
    }
    setPending(true);
    setOperationError(null);
    setFeedback(null);
    try {
      await api.request<Consultation>('/information/consultations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, title: cleanTitle, body: cleanBody }),
      });
      setEditingId(null);
      setFeedback('咨询修改已保存');
      await loadInformation(false);
    } catch (error) {
      setOperationError(errorMessage(error, '咨询修改失败，请稍后重试'));
    } finally {
      setPending(false);
    }
  }

  async function createAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = announcementTitle.trim();
    const cleanBody = announcementBody.trim();
    if (!cleanTitle || !cleanBody) {
      setOperationError('公告标题和正文不能为空');
      return;
    }
    setPending(true);
    setOperationError(null);
    setFeedback(null);
    try {
      await api.request<Announcement>('/information/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: cleanTitle,
          body: cleanBody,
          status: 'draft',
          scope: { type: 'public', id: '*' },
        }),
      });
      setAnnouncementTitle('');
      setAnnouncementBody('');
      setFeedback('公告草稿已创建');
      await loadInformation(false);
    } catch (error) {
      setOperationError(errorMessage(error, '公告草稿保存失败，请稍后重试'));
    } finally {
      setPending(false);
    }
  }

  function beginAnnouncementEdit(item: Announcement) {
    setOperationError(null);
    setFeedback(null);
    setEditingAnnouncementId(item.id);
    setEditAnnouncementTitle(item.title);
    setEditAnnouncementBody(item.body);
  }

  async function saveAnnouncementEdit(event: FormEvent<HTMLFormElement>, item: Announcement) {
    event.preventDefault();
    const cleanTitle = editAnnouncementTitle.trim();
    const cleanBody = editAnnouncementBody.trim();
    if (!cleanTitle || !cleanBody) {
      setOperationError('公告标题和正文不能为空');
      return;
    }
    setPending(true);
    setOperationError(null);
    setFeedback(null);
    try {
      await api.request<Announcement>('/information/announcements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          title: cleanTitle,
          body: cleanBody,
          scope: item.scope,
        }),
      });
      setEditingAnnouncementId(null);
      setFeedback('公告修改已保存');
      await loadInformation(false);
    } catch (error) {
      setOperationError(errorMessage(error, '公告修改保存失败，请稍后重试'));
    } finally {
      setPending(false);
    }
  }
  async function transitionAnnouncement(item: Announcement, to: AnnouncementStatus, label: string) {
    if (!globalThis.confirm(`确认${label}“${item.title}”吗？`)) return;
    setPending(true);
    setOperationError(null);
    setFeedback(null);
    try {
      await api.request<Announcement>(`/information/announcements/${item.id}/transitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      setFeedback(`公告已${label}`);
      await loadInformation(false);
    } catch (error) {
      setOperationError(errorMessage(error, `${label}失败，请检查权限后重试`));
    } finally {
      setPending(false);
    }
  }

  function beginHandling(item: Consultation) {
    setOperationError(null);
    setFeedback(null);
    setHandlingId(item.id);
    setAssigneeUid(item.assigneeUid ?? '');
    setReply(item.reply ?? '');
    const due = item.dueAt === null ? null : new Date(item.dueAt);
    setConsultationDueAt(
      due === null || Number.isNaN(due.getTime())
        ? ''
        : `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}T${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`,
    );
  }

  async function saveHandling(event: FormEvent<HTMLFormElement>, item: Consultation) {
    event.preventDefault();
    if (!globalThis.confirm(`确认保存“${item.title}”的处理信息吗？`)) return;
    setPending(true);
    setOperationError(null);
    setFeedback(null);
    try {
      await api.request<Consultation>(`/information/consultations/${item.id}/handling`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigneeUid: assigneeUid.trim() || null,
          reply: reply.trim() || null,
          dueAt: consultationDueAt ? new Date(consultationDueAt).toISOString() : null,
        }),
      });
      setHandlingId(null);
      setFeedback('处理信息已保存');
      await loadInformation(false);
    } catch (error) {
      setOperationError(errorMessage(error, '处理信息保存失败，请稍后重试'));
    } finally {
      setPending(false);
    }
  }

  async function transitionConsultation(item: Consultation, to: ConsultationStatus, label: string) {
    if (!globalThis.confirm(`确认${label}“${item.title}”吗？`)) return;
    setPending(true);
    setOperationError(null);
    setFeedback(null);
    try {
      await api.request<Consultation>(`/information/consultations/${item.id}/transitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      setFeedback(`咨询已${label}`);
      await loadInformation(false);
    } catch (error) {
      setOperationError(errorMessage(error, `${label}失败，请检查状态后重试`));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="module-page">
      {loading ? <p role="status">正在加载信息与咨询…</p> : null}
      {!loading && view === 'triage' && !hasTriageQueue ? (
        <section role="alert">
          <h2>无权处理咨询</h2>
          <p>仅获授权的分诊成员可以查看和处理咨询队列。</p>
        </section>
      ) : null}
      {!loading && loadError ? (
        <section role="alert">
          <h2>暂时无法加载信息与咨询</h2>
          <button type="button" onClick={() => void loadInformation()}>
            重试
          </button>
        </section>
      ) : null}
      {!loading && !loadError ? (
        <>
          {operationError ? <p role="alert">{operationError}</p> : null}
          {feedback ? <p role="status">{feedback}</p> : null}
          {showAnnouncements ? (
            <>
              <section aria-labelledby="announcements-heading">
                <header className="page-section-header">
                  <div>
                    <h2 id="announcements-heading">公开信息</h2>
                    <p>集中查看面向同学发布的通知与说明。</p>
                  </div>
                </header>
                {announcements.length === 0 ? (
                  <section>
                    <h3>目前没有公开信息</h3>
                  </section>
                ) : (
                  <ul className="record-list" aria-label="公开信息列表">
                    {announcements.map((item) => (
                      <li key={item.id} className="record-card">
                        <article>
                          <header>
                            <h3>{item.title}</h3>
                            <span
                              className="status-badge"
                              data-status={item.status === 'published' ? 'success' : 'warning'}
                            >
                              {announcementStatusLabels[item.status]}
                            </span>
                          </header>
                          {editingAnnouncementId === item.id ? (
                            <form
                              onSubmit={(event) => void saveAnnouncementEdit(event, item)}
                              noValidate
                            >
                              <label>
                                编辑公告标题
                                <input
                                  value={editAnnouncementTitle}
                                  maxLength={200}
                                  onChange={(event) => setEditAnnouncementTitle(event.target.value)}
                                />
                              </label>
                              <label>
                                编辑公告正文
                                <textarea
                                  value={editAnnouncementBody}
                                  maxLength={20000}
                                  onChange={(event) => setEditAnnouncementBody(event.target.value)}
                                />
                              </label>
                              <button type="submit" disabled={pending}>
                                保存公告修改
                              </button>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => setEditingAnnouncementId(null)}
                              >
                                取消
                              </button>
                            </form>
                          ) : (
                            <>
                              <p>{item.body}</p>
                              {hasPermission(user, 'information.announcement.create', item.scope) &&
                              item.status !== 'archived' &&
                              (item.status !== 'published' ||
                                hasPermission(
                                  user,
                                  'information.announcement.publish',
                                  item.scope,
                                )) ? (
                                <button
                                  type="button"
                                  disabled={pending}
                                  aria-label={`编辑 ${item.title}`}
                                  onClick={() => beginAnnouncementEdit(item)}
                                >
                                  编辑
                                </button>
                              ) : null}
                              {hasPermission(
                                user,
                                'information.announcement.publish',
                                item.scope,
                              ) && item.status === 'draft' ? (
                                <button
                                  type="button"
                                  disabled={pending}
                                  aria-label={`发布 ${item.title}`}
                                  onClick={() =>
                                    void transitionAnnouncement(item, 'published', '发布')
                                  }
                                >
                                  发布
                                </button>
                              ) : null}
                              {hasPermission(
                                user,
                                'information.announcement.publish',
                                item.scope,
                              ) && item.status === 'published' ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={pending}
                                    aria-label={`撤回 ${item.title}`}
                                    onClick={() =>
                                      void transitionAnnouncement(item, 'draft', '撤回')
                                    }
                                  >
                                    撤回
                                  </button>
                                  <button
                                    type="button"
                                    disabled={pending}
                                    aria-label={`归档 ${item.title}`}
                                    onClick={() =>
                                      void transitionAnnouncement(item, 'archived', '归档')
                                    }
                                  >
                                    归档
                                  </button>
                                </>
                              ) : null}
                            </>
                          )}
                        </article>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {canCreatePublicAnnouncement ? (
                <section aria-labelledby="announcement-create-heading">
                  <h2 id="announcement-create-heading">创建公告草稿</h2>
                  <form onSubmit={createAnnouncement} noValidate>
                    <label>
                      公告标题
                      <input
                        value={announcementTitle}
                        maxLength={200}
                        onChange={(event) => setAnnouncementTitle(event.target.value)}
                      />
                    </label>
                    <label>
                      公告正文
                      <textarea
                        value={announcementBody}
                        maxLength={20000}
                        onChange={(event) => setAnnouncementBody(event.target.value)}
                      />
                    </label>
                    <button type="submit" disabled={pending}>
                      保存公告草稿
                    </button>
                  </form>
                </section>
              ) : null}
            </>
          ) : null}

          {view === undefined ? <ProposalPool client={api} user={user} /> : null}

          {showConsultations && view !== 'triage' ? (
            <section aria-labelledby="consultation-form-heading">
              <h2 id="consultation-form-heading">提交咨询</h2>
              <p>问题将由对应负责同学跟进，身份与个人范围由服务端确定。</p>
              <form onSubmit={submitConsultation} noValidate>
                <label>
                  咨询标题
                  <input
                    value={title}
                    maxLength={200}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label>
                  咨询内容
                  <textarea
                    value={body}
                    maxLength={20000}
                    onChange={(event) => setBody(event.target.value)}
                  />
                </label>
                {formError ? <p role="alert">{formError}</p> : null}
                <button type="submit" disabled={pending}>
                  {pending ? '正在提交…' : '提交咨询'}
                </button>
              </form>
            </section>
          ) : null}

          {showConsultations ? (
            <section aria-labelledby="consultations-heading">
              <h2 id="consultations-heading">{mayTriage ? '咨询处理队列' : '我的咨询'}</h2>
              {consultations.length === 0 ? (
                <p>{mayTriage ? '当前没有待处理咨询。' : '你还没有提交咨询。'}</p>
              ) : (
                <ul
                  className="record-list"
                  aria-label={mayTriage ? '咨询处理队列列表' : '我的咨询列表'}
                >
                  {consultations.map((item) => (
                    <li key={item.id} className="record-card">
                      <article>
                        <header>
                          <h3>{item.title}</h3>
                          <span
                            className="status-badge"
                            data-status={item.status === 'closed' ? 'success' : 'warning'}
                          >
                            {consultationStatusLabels[item.status]}
                          </span>
                        </header>
                        {editingId === item.id ? (
                          <form
                            onSubmit={(event) => void saveConsultationEdit(event, item)}
                            noValidate
                          >
                            <label>
                              编辑咨询标题
                              <input
                                value={editTitle}
                                maxLength={200}
                                onChange={(event) => setEditTitle(event.target.value)}
                              />
                            </label>
                            <label>
                              编辑咨询内容
                              <textarea
                                value={editBody}
                                maxLength={20000}
                                onChange={(event) => setEditBody(event.target.value)}
                              />
                            </label>
                            <button type="submit" disabled={pending}>
                              保存咨询修改
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => setEditingId(null)}
                            >
                              取消
                            </button>
                          </form>
                        ) : (
                          <>
                            <p>{item.body}</p>
                            {item.requesterUid === user?.uid && item.status === 'open' ? (
                              <button
                                type="button"
                                disabled={pending}
                                aria-label={`编辑 ${item.title}`}
                                onClick={() => beginConsultationEdit(item)}
                              >
                                编辑
                              </button>
                            ) : null}
                          </>
                        )}
                        {mayTriage &&
                        hasPermission(user, 'information.consultation.triage', item.scope) ? (
                          <>
                            {item.assigneeUid ? <p>负责人：{item.assigneeUid}</p> : null}
                            {item.reply ? <p>{item.reply}</p> : null}
                            {item.dueAt ? (
                              <p>计划完成：{new Date(item.dueAt).toLocaleString('zh-CN')}</p>
                            ) : null}
                            {handlingId === item.id ? (
                              <form onSubmit={(event) => void saveHandling(event, item)}>
                                <label>
                                  负责人 UID
                                  <input
                                    value={assigneeUid}
                                    maxLength={128}
                                    onChange={(event) => setAssigneeUid(event.target.value)}
                                  />
                                </label>
                                <label>
                                  咨询回复
                                  <textarea
                                    value={reply}
                                    maxLength={20000}
                                    onChange={(event) => setReply(event.target.value)}
                                  />
                                </label>
                                <label>
                                  计划完成时间
                                  <input
                                    type="datetime-local"
                                    value={consultationDueAt}
                                    onChange={(event) => setConsultationDueAt(event.target.value)}
                                  />
                                </label>
                                <button type="submit" disabled={pending}>
                                  保存处理信息
                                </button>
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => setHandlingId(null)}
                                >
                                  取消
                                </button>
                              </form>
                            ) : (
                              <button
                                type="button"
                                disabled={pending}
                                aria-label={`处理 ${item.title}`}
                                onClick={() => beginHandling(item)}
                              >
                                处理
                              </button>
                            )}
                            {item.status === 'open' ? (
                              <button
                                type="button"
                                disabled={pending}
                                aria-label={`开始处理 ${item.title}`}
                                onClick={() =>
                                  void transitionConsultation(item, 'in_progress', '开始处理')
                                }
                              >
                                开始处理
                              </button>
                            ) : null}
                            {item.status === 'in_progress' ? (
                              <button
                                type="button"
                                disabled={pending}
                                aria-label={`标记解决 ${item.title}`}
                                onClick={() =>
                                  void transitionConsultation(item, 'resolved', '标记解决')
                                }
                              >
                                标记解决
                              </button>
                            ) : null}
                            {item.status === 'resolved' ? (
                              <>
                                <button
                                  type="button"
                                  disabled={pending}
                                  aria-label={`重新处理 ${item.title}`}
                                  onClick={() =>
                                    void transitionConsultation(item, 'in_progress', '重新处理')
                                  }
                                >
                                  重新处理
                                </button>
                                <button
                                  type="button"
                                  disabled={pending}
                                  aria-label={`关闭 ${item.title}`}
                                  onClick={() =>
                                    void transitionConsultation(item, 'closed', '关闭')
                                  }
                                >
                                  关闭
                                </button>
                              </>
                            ) : null}
                          </>
                        ) : null}
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
