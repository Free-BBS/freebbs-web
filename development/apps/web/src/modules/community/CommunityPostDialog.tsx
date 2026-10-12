import { useEffect, useId, useRef, useState } from 'react';

import type { CreateCommunityPostInput } from '@freebbs-development/contracts';
import { CommunityIcon } from './CommunityIcon.js';

interface CommunityPostDialogProps {
  initialKind: 'daily' | 'wish';
  onClose: () => void;
  onSubmit: (input: CreateCommunityPostInput) => Promise<void>;
  inline?: boolean;
}

export function CommunityPostDialog({
  initialKind,
  onClose,
  onSubmit,
  inline = false,
}: CommunityPostDialogProps) {
  const [kind, setKind] = useState<'daily' | 'wish'>(initialKind);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [displayMode, setDisplayMode] = useState<'named' | 'anonymous'>('named');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [published, setPublished] = useState(false);
  const submitting = useRef(false);
  const headingId = useId();
  useEffect(() => setKind(initialKind), [initialKind]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!title.trim() || !body.trim()) {
      setError('请填写标题和内容。');
      return;
    }
    submitting.current = true;
    setPending(true);
    setError('');
    setPublished(false);
    try {
      await onSubmit({ kind, title: title.trim(), body: body.trim(), tags: [], displayMode });
      onClose();
      if (inline) {
        setTitle('');
        setBody('');
        setPublished(true);
      }
    } catch {
      setError('发布失败，草稿已保留，请稍后重试。');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <div
      className={inline ? 'community-inline-wrap' : 'community-dialog-backdrop'}
      role={inline ? undefined : 'presentation'}
    >
      <section
        className={inline ? 'community-composer' : 'community-dialog'}
        role={inline ? 'region' : 'dialog'}
        aria-modal={inline ? undefined : true}
        aria-labelledby={headingId}
      >
        <header>
          <div>
            {!inline ? <p className="community-eyebrow">NEW STORY</p> : null}
            <h2 id={headingId}>{inline ? '分享校园新鲜事' : '写点什么'}</h2>
          </div>
          {!inline ? (
            <button type="button" aria-label="关闭" disabled={pending} onClick={onClose}>
              ×
            </button>
          ) : (
            <CommunityIcon name="pen" />
          )}
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset className="community-compose-kind" disabled={pending}>
            <legend>内容类型</legend>
            <label>
              <input
                type="radio"
                name="kind"
                checked={kind === 'daily'}
                onChange={() => setKind('daily')}
              />{' '}
              校园日常
            </label>
            <label>
              <input
                type="radio"
                name="kind"
                checked={kind === 'wish'}
                onChange={() => setKind('wish')}
              />{' '}
              新生许愿
            </label>
          </fieldset>
          <label>
            标题
            <input
              value={title}
              maxLength={200}
              disabled={pending}
              placeholder="给这条新鲜事起个标题"
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </label>
          <label>
            内容
            <textarea
              value={body}
              maxLength={20000}
              rows={inline ? 3 : 7}
              disabled={pending}
              placeholder={
                kind === 'wish' ? '你想在校园里实现什么愿望？' : '今天有什么想和大家分享的？'
              }
              onChange={(event) => setBody(event.target.value)}
              required
            />
          </label>
          <fieldset className="community-compose-identity" disabled={pending}>
            <legend>展示身份</legend>
            <label>
              <input
                type="radio"
                name="display"
                checked={displayMode === 'named'}
                onChange={() => setDisplayMode('named')}
              />{' '}
              实名展示
            </label>
            <label>
              <input
                type="radio"
                name="display"
                checked={displayMode === 'anonymous'}
                onChange={() => setDisplayMode('anonymous')}
              />{' '}
              匿名展示
            </label>
          </fieldset>
          <p className="community-privacy-note">匿名仅隐藏前台身份，后台仍保留账号用于内容治理。</p>
          {error ? (
            <p className="community-form-error" role="alert">
              {error}
            </p>
          ) : null}
          {published ? (
            <p className="community-form-success" role="status">
              已发布，去广场看看大家的回应吧。
            </p>
          ) : null}
          <footer>
            {inline ? (
              <span className="community-composer-count">
                {body.length.toLocaleString()} / 20,000
              </span>
            ) : (
              <button type="button" disabled={pending} onClick={onClose}>
                取消
              </button>
            )}
            <button className="community-primary" type="submit" disabled={pending}>
              <CommunityIcon name="pen" />
              {pending ? '正在发布…' : '确认发布'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
