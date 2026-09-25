import { useState } from 'react';

import type {
  InformationFeedItem,
  InformationReply,
  UserContext,
} from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';

export interface InformationDetailDialogProps {
  client: ApiClient;
  item: InformationFeedItem;
  initialReplies: InformationReply[];
  user: UserContext | null;
  onClose(): void;
  onReplyCreated(): void;
}

export function InformationDetailDialog({
  client,
  item,
  initialReplies,
  user,
  onClose,
  onReplyCreated,
}: InformationDetailDialogProps) {
  const [replies, setReplies] = useState(initialReplies);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const maySupplement = item.kind === 'consultation' && item.requesterUid === user?.uid;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setPending(true);
    setError('');
    try {
      const reply = await client.request<InformationReply>(
        `/information/feed/${item.kind}/${item.id}/replies`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: maySupplement ? 'supplement' : 'reply', body: body.trim() }),
        },
      );
      setReplies((current) => [...current, reply]);
      setBody('');
      onReplyCreated();
    } catch {
      setError('回复未能发送，请稍后重试。');
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="information-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="information-dialog information-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="information-detail-title"
      >
        <header>
          <div>
            <p className="information-eyebrow">
              {item.kind === 'announcement'
                ? '官方发布'
                : item.visibility === 'private'
                  ? '🔒 私密咨询'
                  : '公开反馈'}
            </p>
            <h3 id="information-detail-title">{item.title}</h3>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="information-detail__content">
          <p>{item.body}</p>
          <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-CN')}</time>
        </div>
        <section className="information-replies" aria-label="回复">
          <h4>
            {item.kind === 'consultation' && item.visibility === 'private'
              ? '处理记录'
              : `回复 · ${replies.length}`}
          </h4>
          {replies.length === 0 ? (
            <p className="information-replies__empty">还没有回复，你可以补充第一条信息。</p>
          ) : null}
          {replies.map((reply) => (
            <article key={reply.id}>
              <header>
                <strong>{reply.authorUid}</strong>
                {reply.kind === 'supplement' ? <span>发起人补充</span> : null}
              </header>
              <p>{reply.body}</p>
            </article>
          ))}
        </section>
        {item.canReply ? (
          <form className="information-reply-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="information-reply">{maySupplement ? '补充说明' : '写下回复'}</label>
            <textarea
              id="information-reply"
              aria-label="写下回复"
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
            />
            {error ? <p role="alert">{error}</p> : null}
            <button className="information-primary-action" type="submit" disabled={pending}>
              {pending ? '发送中…' : '发送回复'}
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
