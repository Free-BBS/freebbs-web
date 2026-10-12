import { useEffect, useRef, useState } from 'react';
import type {
  ActivityNotification,
  ActivityNotificationInbox,
  DevelopmentNotification,
} from '@freebbs-development/contracts';
import type { AuthMode, ApiClient } from '../core/api/client.js';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
  channel: 'system' | 'activity';
  source?: ActivityNotification['source'];
  activityId?: string;
}
function safeLink(link: string): string {
  if (!/^\/development(?:\/|$)/.test(link) || /[\\\s]/.test(link)) return '';
  return new URL(link, window.location.origin).origin === window.location.origin ? link : '';
}
const messageFrom = (error: unknown) =>
  error instanceof Error ? error.message : '通知加载失败，请稍后重试。';
const itemKey = (item: NotificationItem) =>
  `${item.channel}:${item.source ?? ''}:${item.activityId ?? ''}:${item.id}`;
function sorted(items: NotificationItem[]) {
  return [...new Map(items.map((item) => [itemKey(item), item])).values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}
const systemItems = (items: DevelopmentNotification[]): NotificationItem[] =>
  items.map((item) => ({ ...item, link: item.link ?? '', channel: 'system' }));
const activityItems = (items: ActivityNotification[]): NotificationItem[] =>
  items.map((item) => ({ ...item, channel: 'activity' }));

export function MainSiteNotifications({
  authMode,
  userUid,
  client,
}: {
  authMode: AuthMode;
  userUid: string;
  client?: Pick<ApiClient, 'request'>;
}) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const reads = useRef(new Set<string>());
  const generation = useRef(0);
  const counts = useRef({ system: 0, activity: 0 });
  useEffect(() => {
    const currentGeneration = ++generation.current;
    let active = true;
    setOpen(false);
    setUnreadCount(0);
    setItems([]);
    setActivityCursor(null);
    setMessage('');
    setBusy(false);
    busyRef.current = false;
    reads.current.clear();
    counts.current = { system: 0, activity: 0 };
    const refresh = async () => {
      if (!client || document.hidden || busyRef.current || reads.current.size) return;
      const [system, activity] = await Promise.allSettled([
        client.request<{ unreadCount: number }>('/notifications/unread-count'),
        client.request<ActivityNotificationInbox>('/events/notifications'),
      ]);
      if (!active || generation.current !== currentGeneration) return;
      if (system.status === 'fulfilled' && Number.isFinite(system.value.unreadCount))
        counts.current.system = system.value.unreadCount;
      if (activity.status === 'fulfilled' && Array.isArray(activity.value.notifications)) {
        counts.current.activity = activity.value.unreadCount;
        setItems((current) => sorted([...current, ...activityItems(activity.value.notifications)]));
        setActivityCursor(activity.value.nextCursor);
      }
      setUnreadCount(counts.current.system + counts.current.activity);
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('freebbs-development-notifications-changed', refresh);
    return () => {
      active = false;
      generation.current++;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('freebbs-development-notifications-changed', refresh);
    };
  }, [authMode, userUid, client]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        bellRef.current?.focus();
        event.preventDefault();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  async function loadInbox(append = false) {
    if (!client || busyRef.current) return;
    const activeGeneration = generation.current;
    busyRef.current = true;
    setBusy(true);
    setMessage('正在加载…');
    const [system, activity] = await Promise.allSettled([
      !append ? client.request<DevelopmentNotification[]>('/notifications') : Promise.resolve(null),
      !append || activityCursor
        ? client.request<ActivityNotificationInbox>(
            `/events/notifications${append && activityCursor ? `?before=${encodeURIComponent(activityCursor)}` : ''}`,
          )
        : Promise.resolve(null),
    ]);
    if (activeGeneration !== generation.current) return;
    const loaded: NotificationItem[] = [];
    const errors: string[] = [];
    if (system.status === 'fulfilled' && Array.isArray(system.value)) {
      loaded.push(...systemItems(system.value));
      counts.current.system = system.value.filter((item) => !item.readAt).length;
    } else if (system.status === 'rejected') errors.push(messageFrom(system.reason));
    if (
      activity.status === 'fulfilled' &&
      activity.value &&
      Array.isArray(activity.value.notifications)
    ) {
      loaded.push(...activityItems(activity.value.notifications));
      counts.current.activity = activity.value.unreadCount;
      setActivityCursor(activity.value.nextCursor);
    } else if (activity.status === 'rejected') errors.push(messageFrom(activity.reason));
    setItems((current) =>
      sorted(
        append
          ? [...current, ...loaded]
          : [
              ...current.filter((item) =>
                item.channel === 'system'
                  ? system.status === 'rejected'
                  : activity.status === 'rejected',
              ),
              ...loaded,
            ],
      ),
    );
    setUnreadCount(counts.current.system + counts.current.activity);
    setMessage(errors.join('；') || (!loaded.length && !append ? '暂时没有通知' : ''));
    busyRef.current = false;
    setBusy(false);
  }
  async function markRead(item: NotificationItem) {
    if (!client || reads.current.has(itemKey(item)) || busyRef.current) return;
    const activeGeneration = generation.current;
    const key = itemKey(item);
    reads.current.add(key);
    try {
      if (!item.readAt) {
        const path =
          item.channel === 'system'
            ? `/notifications/${encodeURIComponent(item.id)}/read`
            : `/events/notifications/${item.source}/${encodeURIComponent(item.activityId ?? '')}/${encodeURIComponent(item.id)}/read`;
        await client.request(path, { method: 'POST' });
        if (activeGeneration !== generation.current) return;
        setItems((current) =>
          current.map((notice) =>
            itemKey(notice) === key ? { ...notice, readAt: new Date().toISOString() } : notice,
          ),
        );
        counts.current[item.channel] = Math.max(0, counts.current[item.channel] - 1);
        setUnreadCount(counts.current.system + counts.current.activity);
      }
      if (activeGeneration !== generation.current) return;
      const link = safeLink(item.link);
      if (link) window.location.assign(link);
    } catch (caught) {
      if (activeGeneration === generation.current) setMessage(messageFrom(caught));
    } finally {
      if (activeGeneration === generation.current) reads.current.delete(key);
    }
  }
  async function markAllRead() {
    if (!client || !unreadCount || busyRef.current || reads.current.size) return;
    const activeGeneration = generation.current;
    busyRef.current = true;
    setBusy(true);
    const results = await Promise.allSettled([
      client.request('/notifications/read-all', { method: 'POST' }),
      client.request('/events/notifications/read-all', { method: 'POST' }),
    ]);
    if (activeGeneration !== generation.current) return;
    const succeeded = {
      system: results[0].status === 'fulfilled',
      activity: results[1].status === 'fulfilled',
    };
    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) =>
        succeeded[item.channel] ? { ...item, readAt: item.readAt ?? now } : item,
      ),
    );
    if (succeeded.system) counts.current.system = 0;
    if (succeeded.activity) counts.current.activity = 0;
    setUnreadCount(counts.current.system + counts.current.activity);
    setMessage(
      results
        .filter((result) => result.status === 'rejected')
        .map((result) => messageFrom(result.reason))
        .join('；'),
    );
    setBusy(false);
    busyRef.current = false;
  }
  const label = client ? (unreadCount ? `通知，${unreadCount} 条未读` : '通知，无未读') : '通知';
  return (
    <div className="main-site-notifications" ref={rootRef}>
      <button
        ref={bellRef}
        className="main-site-notification-bell"
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls="main-site-notification-panel"
        title="通知"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setOpen(true);
          void loadInbox();
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
          <path d="M10 21h4M12 2V1" strokeLinecap="round" />
        </svg>
        {unreadCount > 0 ? (
          <span className="main-site-notification-badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <section
          className="main-site-notification-panel"
          id="main-site-notification-panel"
          role="dialog"
          aria-label="通知收件箱"
        >
          <header className="main-site-notification-panel-header">
            <h2>通知</h2>
            {client ? (
              <button
                type="button"
                disabled={!unreadCount || busy}
                onClick={() => void markAllRead()}
              >
                全部已读
              </button>
            ) : null}
            <button
              ref={closeRef}
              type="button"
              aria-label="关闭通知"
              onClick={() => {
                setOpen(false);
                bellRef.current?.focus();
              }}
            >
              ×
            </button>
          </header>
          {message ? (
            <p className="main-site-notification-message" role="status">
              {message}
            </p>
          ) : null}
          <div className="main-site-notification-list">
            {items.map((item) => {
              const date = new Date(item.createdAt);
              const link = safeLink(item.link);
              return (
                <article
                  className={`main-site-notification-item${item.readAt ? '' : ' is-unread'}`}
                  key={itemKey(item)}
                >
                  <button type="button" disabled={busy} onClick={() => void markRead(item)}>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                    <time dateTime={Number.isNaN(date.getTime()) ? undefined : date.toISOString()}>
                      {Number.isNaN(date.getTime())
                        ? ''
                        : date.toLocaleString('zh-CN', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                    </time>
                    <small>{link ? '查看详情 →' : item.readAt ? '已读' : '标为已读'}</small>
                  </button>
                </article>
              );
            })}
          </div>
          {activityCursor ? (
            <button
              className="main-site-notification-more"
              type="button"
              disabled={busy}
              onClick={() => void loadInbox(true)}
            >
              加载更多
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
