import { useState } from 'react';

import type { CreateCommunityPostInput } from '@freebbs-development/contracts';

interface CommunityPostDialogProps {
  initialKind: 'daily' | 'wish';
  onClose: () => void;
  onSubmit: (input: CreateCommunityPostInput) => Promise<void>;
}

export function CommunityPostDialog({ initialKind, onClose, onSubmit }: CommunityPostDialogProps) {
  const [kind, setKind] = useState<'daily' | 'wish'>(initialKind);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [displayMode, setDisplayMode] = useState<'named' | 'anonymous'>('named');
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await onSubmit({ kind, title: title.trim(), body: body.trim(), tags: [], displayMode });
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="community-dialog-backdrop" role="presentation">
      <section
        className="community-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="community-compose-title"
      >
        <header>
          <div>
            <p className="community-eyebrow">NEW STORY</p>
            <h2 id="community-compose-title">写点什么</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset>
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
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </label>
          <label>
            内容
            <textarea
              value={body}
              maxLength={20000}
              rows={7}
              onChange={(event) => setBody(event.target.value)}
              required
            />
          </label>
          <fieldset>
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
          <footer>
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button className="community-primary" type="submit" disabled={pending}>
              {pending ? '正在发布…' : '确认发布'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
