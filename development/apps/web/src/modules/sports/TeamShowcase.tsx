import { Fragment, useEffect, useState } from 'react';

import type { SportsTeamShowcase } from '@freebbs-development/contracts';
import type { DevelopmentApi } from './SportsPage.js';

function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return parts.map((part, index) => {
    const strong = /^\*\*(.+)\*\*$/.exec(part);
    if (strong) return <strong key={index}>{strong[1]}</strong>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
    if (link)
      return (
        <a key={index} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function ShowcaseMarkdown({ source }: { source: string }) {
  return (
    <div className="showcase-content">
      {source.split('\n').map((line, index) => {
        const image =
          /^!\[([^\]]*)\]\((\/api\/development\/v1\/sports\/media\/images\/[0-9a-f.-]+)\)$/.exec(
            line.trim(),
          );
        if (image)
          return (
            <figure key={index}>
              <img src={image[2]} alt={image[1]} />
              {image[1] && <figcaption>{image[1]}</figcaption>}
            </figure>
          );
        if (line.startsWith('### ')) return <h4 key={index}>{inline(line.slice(4))}</h4>;
        if (line.startsWith('## ')) return <h3 key={index}>{inline(line.slice(3))}</h3>;
        if (line.startsWith('# ')) return <h2 key={index}>{inline(line.slice(2))}</h2>;
        if (line.startsWith('> '))
          return <blockquote key={index}>{inline(line.slice(2))}</blockquote>;
        if (/^[-*] /.test(line)) return <li key={index}>{inline(line.slice(2))}</li>;
        if (line.trim() === '---') return <hr key={index} />;
        return line.trim() ? <p key={index}>{inline(line)}</p> : <br key={index} />;
      })}
    </div>
  );
}

export function TeamShowcase({
  client,
  teamId,
  canEdit,
}: {
  client: DevelopmentApi;
  teamId: string;
  canEdit: boolean;
}) {
  const [showcase, setShowcase] = useState<SportsTeamShowcase | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    Promise.resolve()
      .then(() =>
        client.request<SportsTeamShowcase | null>(
          `/sports/teams/${encodeURIComponent(teamId)}/showcase`,
        ),
      )
      .then((value) => {
        setShowcase(value);
        setDraft(value?.markdown ?? '');
      })
      .catch(() => setMessage('风采内容暂时无法加载'));
  }, [client, teamId]);
  const wrap = (before: string, after = before) => {
    const area = document.querySelector<HTMLTextAreaElement>('#showcase-editor');
    if (!area) return;
    const start = area.selectionStart,
      end = area.selectionEnd;
    setDraft(draft.slice(0, start) + before + draft.slice(start, end) + after + draft.slice(end));
  };
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('image', file);
      const result = await client.request<{ url: string }>('/sports/media/images', {
        method: 'POST',
        body,
      });
      setDraft((value) => `${value}\n![代表队风采图片](${result.url})\n`);
      setMessage('图片已插入正文');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };
  const save = async () => {
    try {
      const value = await client.request<SportsTeamShowcase>(
        `/sports/teams/${encodeURIComponent(teamId)}/showcase`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: draft }),
        },
      );
      setShowcase(value);
      setEditing(false);
      setMessage('代表队风采已更新');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，草稿已保留');
    }
  };
  return (
    <section className="team-showcase" aria-labelledby="showcase-title">
      <div className="showcase-heading">
        <div>
          <p className="eyebrow">队伍故事</p>
          <h3 id="showcase-title">代表队风采</h3>
        </div>
        {canEdit && (
          <button className="button secondary" onClick={() => setEditing(!editing)}>
            {editing ? '取消编辑' : '编辑风采'}
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      {editing ? (
        <div className="showcase-editor-shell">
          <div className="editor-intro">
            <div>
              <span className="form-step">队长编辑台</span>
              <h4>编排代表队故事</h4>
            </div>
            <p>用标题、段落和图片讲清队伍的训练、比赛与成员故事。</p>
          </div>
          <div className="editor-tools" role="toolbar" aria-label="图文排版工具">
            <button onClick={() => wrap('## ', '')} type="button">
              标题
            </button>
            <button onClick={() => wrap('**')} type="button">
              粗体
            </button>
            <button onClick={() => wrap('> ', '')} type="button">
              引用
            </button>
            <button onClick={() => wrap('- ', '')} type="button">
              列表
            </button>
            <button onClick={() => wrap('[链接文字](https://example.com)', '')} type="button">
              链接
            </button>
            <button onClick={() => wrap('\n---\n', '')} type="button">
              分隔线
            </button>
          </div>
          <label
            className={`showcase-dropzone ${uploading ? 'is-uploading' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) void upload(file);
            }}
          >
            <input
              aria-label="上传代表队风采图片"
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <span className="upload-mark" aria-hidden="true">
              ＋
            </span>
            <span>
              <strong>{uploading ? '正在上传…' : '添加图像'}</strong>
              <small>点击选择或拖放图片，上传后自动插入正文</small>
            </span>
          </label>
          <div className="editor-panes">
            <section className="editor-pane" aria-label="风采正文编辑">
              <header>
                <b>正文</b>
                <span>{draft.length.toLocaleString()} / 100,000</span>
              </header>
              <textarea
                id="showcase-editor"
                aria-label="代表队风采正文"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={100000}
                placeholder="从队伍介绍、训练日常或一次难忘的比赛开始……"
              />
            </section>
            <section className="editor-pane showcase-preview" aria-label="实时预览">
              <header>
                <b>实时预览</b>
                <span>发布效果</span>
              </header>
              <ShowcaseMarkdown source={draft} />
            </section>
          </div>
          <div className="showcase-actions">
            <button className="button secondary" onClick={() => setEditing(false)}>
              退出编辑
            </button>
            <button className="button primary" onClick={() => void save()}>
              保存并发布
            </button>
          </div>
        </div>
      ) : showcase?.markdown ? (
        <ShowcaseMarkdown source={showcase.markdown} />
      ) : (
        <p className="showcase-empty">这支代表队还没有发布风采内容。</p>
      )}
    </section>
  );
}
