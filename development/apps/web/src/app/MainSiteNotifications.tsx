import { useEffect, useRef, useState } from 'react';
import type {
  ActivityNotification,
  ActivityNotificationInbox,
} from '@freebbs-development/contracts';
import type { AuthMode, ApiClient } from '../core/api/client.js';
import { mainSiteHref, requestMainSite } from './main-site-api.js';
interface NotificationItem {
  id: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
  channel?: 'development';
  source?: ActivityNotification['source'];
  activityId?: string;
}
interface NotificationInbox {
  notifications: NotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
}
function safeLink(link: string): string {
  if (!link.startsWith('/') || link.startsWith('//') || /[\\\s]/.test(link)) return '';
  return new URL(link, window.location.origin).origin === window.location.origin ? link : '';
}
function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '通知加载失败，请稍后重试。';
}
function sorted(items: NotificationItem[]) {
  return [...new Map(items.map((n) => [`${n.channel ?? 'main'}:${n.id}`, n])).values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
}
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
  const [cursor, setCursor] = useState<string | null>(null);
  const [developmentCursor, setDevelopmentCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const counts = useRef({ main: 0, development: 0 });
  useEffect(() => {
    const activeGeneration = ++generation.current;
    let alive = true;
    setOpen(false);
    setUnreadCount(0);
    setItems([]);
    setCursor(null);
    setDevelopmentCursor(null);
    setMessage('');
    setBusy(false);
    busyRef.current = false;
    counts.current = { main: 0, development: 0 };
    const refresh = async () => {
      if (document.hidden) return;
      const results = await Promise.allSettled([
        authMode === 'main'
          ? requestMainSite<{ unreadCount: number }>('/notifications/unread-count')
          : Promise.resolve(null),
        client
          ? client.request<ActivityNotificationInbox>('/events/notifications')
          : Promise.resolve(null),
      ]);
      if (!alive || generation.current !== activeGeneration) return;
      const [main, development] = results;
      if (main.status === 'fulfilled' && main.value && Number.isFinite(main.value.unreadCount))
        counts.current.main = main.value.unreadCount;
      if (
        development.status === 'fulfilled' &&
        development.value &&
        Array.isArray(development.value.notifications)
      ) {
        counts.current.development = development.value.unreadCount;
        setItems((current) =>
          sorted([
            ...current.filter((n) => n.channel !== 'development'),
            ...development.value!.notifications.map((n) => ({
              ...n,
              channel: 'development' as const,
            })),
          ]),
        );
        setDevelopmentCursor(development.value.nextCursor);
      }
      setUnreadCount(counts.current.main + counts.current.development);
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('freebbs-development-notifications-changed', refresh);
    return () => {
      alive = false;
      generation.current++;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('freebbs-development-notifications-changed', refresh);
    };
  }, [authMode, userUid, client]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const outside = (e: MouseEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        e.preventDefault();
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
    if (busyRef.current) return;
    const activeGeneration = generation.current;
    busyRef.current = true;
    setBusy(true);
    setMessage('正在加载…');
    const results = await Promise.allSettled([
      authMode === 'main' && (!append || cursor)
        ? requestMainSite<NotificationInbox>(
            `/notifications${append && cursor ? '?before=' + encodeURIComponent(cursor) : ''}`,
          )
        : Promise.resolve(null),
      client && (!append || developmentCursor)
        ? client.request<ActivityNotificationInbox>(
            `/events/notifications${append && developmentCursor ? '?before=' + encodeURIComponent(developmentCursor) : ''}`,
          )
        : Promise.resolve(null),
    ]);
    if (generation.current !== activeGeneration) return;
    const loaded: NotificationItem[] = [];
    const errors: string[] = [];
    const [main, development] = results;
    if (main.status === 'fulfilled' && main.value && Array.isArray(main.value.notifications)) {
      loaded.push(...main.value.notifications);
      setCursor(main.value.nextCursor);
      counts.current.main = main.value.unreadCount;
    } else if (main.status === 'rejected') errors.push(messageFrom(main.reason));
    if (
      development.status === 'fulfilled' &&
      development.value &&
      Array.isArray(development.value.notifications)
    ) {
      loaded.push(
        ...development.value.notifications.map((n) => ({ ...n, channel: 'development' as const })),
      );
      setDevelopmentCursor(development.value.nextCursor);
      counts.current.development = development.value.unreadCount;
    } else if (development.status === 'rejected') errors.push(messageFrom(development.reason));
    const failedMain = main.status === 'rejected';
    const failedDevelopment = development.status === 'rejected';
    setItems((current) =>
      sorted(
        append
          ? [...current, ...loaded]
          : [
              ...current.filter((n) =>
                n.channel === 'development' ? failedDevelopment : failedMain,
              ),
              ...loaded,
            ],
      ),
    );
    setUnreadCount(counts.current.main + counts.current.development);
    setMessage(errors.join('；') || (loaded.length || append ? '' : '暂时没有通知'));
    busyRef.current = false;
    setBusy(false);
  }
  async function markRead(item: NotificationItem) {
    const activeGeneration = generation.current;
    const link = safeLink(item.link);
    const channel = item.channel === 'development' ? 'development' : 'main';
    try {
      if (!item.readAt) {
        if (channel === 'development')
          await client?.request(
            `/events/notifications/${item.source}/${encodeURIComponent(item.activityId ?? '')}/${encodeURIComponent(item.id)}/read`,
            { method: 'POST' },
          );
        else
          await requestMainSite(`/notifications/${encodeURIComponent(item.id)}/read`, {
            method: 'POST',
          });
        if (generation.current !== activeGeneration) return;
        setItems((current) =>
          current.map((n) =>
            n.id === item.id && n.channel === item.channel
              ? { ...n, readAt: new Date().toISOString() }
              : n,
          ),
        );
        counts.current[channel] = Math.max(0, counts.current[channel] - 1);
        setUnreadCount(counts.current.main + counts.current.development);
      }
      if (generation.current !== activeGeneration) return;
      if (link) window.location.assign(channel === 'development' ? link : mainSiteHref(link));
    } catch (error) {
      if (generation.current === activeGeneration) setMessage(messageFrom(error));
    }
  }
  async function markAllRead() {
    if (!unreadCount || busyRef.current) return;
    const activeGeneration = generation.current;
    setBusy(true);
    busyRef.current = true;
    const results = await Promise.allSettled([
      authMode === 'main'
        ? requestMainSite('/notifications/read-all', { method: 'POST' })
        : Promise.resolve(null),
      client
        ? client.request('/events/notifications/read-all', { method: 'POST' })
        : Promise.resolve(null),
    ]);
    if (generation.current !== activeGeneration) return;
    const succeeded = {
      main: results[0].status === 'fulfilled',
      development: results[1].status === 'fulfilled',
    };
    const now = new Date().toISOString();
    setItems((current) =>
      current.map((n) =>
        succeeded[n.channel === 'development' ? 'development' : 'main']
          ? { ...n, readAt: n.readAt ?? now }
          : n,
      ),
    );
    if (succeeded.main) counts.current.main = 0;
    if (succeeded.development) counts.current.development = 0;
    setUnreadCount(counts.current.main + counts.current.development);
    setMessage(
      results
        .filter((r) => r.status === 'rejected')
        .map((r) => messageFrom(r.reason))
        .join('；'),
    );
    setBusy(false);
    busyRef.current = false;
  }
  const label =
    authMode === 'main' || client
      ? unreadCount
        ? `通知，${unreadCount} 条未读`
        : '通知，无未读'
      : '通知';
  return (
    <div className="main-site-notifications" ref={rootRef}>
      <button
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
            {authMode === 'main' || client ? (
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
              onClick={() => setOpen(false)}
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
                  key={`${item.channel ?? 'main'}:${item.id}`}
                >
                  <button type="button" onClick={() => void markRead(item)}>
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
          {cursor || developmentCursor ? (
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
