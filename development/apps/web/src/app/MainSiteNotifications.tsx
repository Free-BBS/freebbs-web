import { useEffect, useRef, useState } from 'react';

import type { AuthMode } from '../core/api/client.js';
import { mainSiteHref, requestMainSite } from './main-site-api.js';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
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

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : '通知加载失败，请稍后重试。';
}

export function MainSiteNotifications({
  authMode,
  userUid,
}: {
  authMode: AuthMode;
  userUid: string;
}) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    setOpen(false);
    setUnreadCount(0);
    setItems([]);
    if (authMode !== 'main') return;
    let alive = true;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const payload = await requestMainSite<{ unreadCount: number }>(
          '/notifications/unread-count',
        );
        if (alive) setUnreadCount(payload.unreadCount);
      } catch {
        // The bell remains usable; opening it shows the actionable error.
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [authMode, userUid]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        event.preventDefault();
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  async function loadInbox(append = false) {
    if (authMode !== 'main' || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage('正在加载…');
    try {
      const query = append && cursor ? `?before=${encodeURIComponent(cursor)}` : '';
      const payload = await requestMainSite<NotificationInbox>(`/notifications${query}`);
      setItems((current) =>
        append ? [...current, ...payload.notifications] : payload.notifications,
      );
      setCursor(payload.nextCursor);
      setUnreadCount(payload.unreadCount);
      setMessage(payload.notifications.length || append ? '' : '暂时没有通知');
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function markRead(item: NotificationItem) {
    const link = safeLink(item.link);
    try {
      if (!item.readAt) {
        await requestMainSite(`/notifications/${encodeURIComponent(item.id)}/read`, {
          method: 'POST',
        });
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry,
          ),
        );
        setUnreadCount((count) => Math.max(0, count - 1));
      }
      if (link) window.location.assign(mainSiteHref(link));
    } catch (error) {
      setMessage(messageFrom(error));
    }
  }

  async function markAllRead() {
    if (!unreadCount) return;
    setBusy(true);
    try {
      await requestMainSite('/notifications/read-all', { method: 'POST' });
      setItems((current) =>
        current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
      );
      setUnreadCount(0);
      setMessage('');
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  const label =
    authMode === 'main' ? (unreadCount ? `通知，${unreadCount} 条未读` : '通知，无未读') : '通知';

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
          if (authMode === 'main') void loadInbox();
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
            {authMode === 'main' ? (
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
          {authMode === 'demo' ? (
            <p className="main-site-notification-message">请登录主站账号后查看通知。</p>
          ) : (
            <>
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
                      key={item.id}
                    >
                      <button type="button" onClick={() => void markRead(item)}>
                        <strong>{item.title}</strong>
                        <span>{item.body}</span>
                        <time
                          dateTime={Number.isNaN(date.getTime()) ? undefined : date.toISOString()}
                        >
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
              {cursor ? (
                <button
                  className="main-site-notification-more"
                  type="button"
                  disabled={busy}
                  onClick={() => void loadInbox(true)}
                >
                  加载更多
                </button>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
