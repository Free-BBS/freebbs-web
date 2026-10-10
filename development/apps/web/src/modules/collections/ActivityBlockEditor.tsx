import { useState } from 'react';
import type { ActivityContentBlock, ActivityWorkspaceAsset } from '@freebbs-development/contracts';

interface Props {
  blocks: ActivityContentBlock[];
  assets: ActivityWorkspaceAsset[];
  onChange: (blocks: ActivityContentBlock[]) => void;
  onUpload: (file: File) => Promise<ActivityWorkspaceAsset>;
  disabled?: boolean;
}
const kinds = { heading: '标题', paragraph: '段落', image: '图片', video: '视频' } as const;
export function ActivityBlockEditor({
  blocks,
  assets,
  onChange,
  onUpload,
  disabled = false,
}: Props) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  function patch(id: string, change: Partial<ActivityContentBlock>) {
    onChange(blocks.map((block) => (block.id === id ? { ...block, ...change } : block)));
  }
  function move(index: number, offset: number) {
    const next = [...blocks];
    const target = index + offset;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  async function upload(id: string, file: File) {
    setError(null);
    setUploading(id);
    try {
      const asset = await onUpload(file);
      patch(id, { assetId: asset.id });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '上传失败，请重试。');
    } finally {
      setUploading(null);
    }
  }
  return (
    <fieldset className="activity-block-editor" disabled={disabled || uploading !== null}>
      <div className="activity-editor-toolbar" aria-label="添加内容">
        {(Object.keys(kinds) as ActivityContentBlock['kind'][]).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() =>
              onChange([
                ...blocks,
                { id: crypto.randomUUID(), kind, text: '', assetId: null, caption: '' },
              ])
            }
          >
            ＋ {kinds[kind]}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="activity-error">
          {error}
        </p>
      ) : null}
      {blocks.length === 0 ? <p className="activity-muted">添加一个段落，开始记录活动。</p> : null}
      {blocks.map((block, index) => (
        <div className="activity-editor-block" key={block.id}>
          <div className="activity-editor-block-top">
            <strong>
              {index + 1} · {kinds[block.kind]}
            </strong>
            <div className="activity-editor-block-actions">
              <button
                type="button"
                aria-label={`上移内容 ${index + 1}`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`下移内容 ${index + 1}`}
                disabled={index === blocks.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`删除内容 ${index + 1}`}
                onClick={() => onChange(blocks.filter((item) => item.id !== block.id))}
              >
                删除
              </button>
            </div>
          </div>
          {block.kind === 'heading' || block.kind === 'paragraph' ? (
            <label>
              <span>
                {kinds[block.kind]}内容 {index + 1}
              </span>
              {block.kind === 'heading' ? (
                <input
                  value={block.text}
                  maxLength={20000}
                  onChange={(event) => patch(block.id, { text: event.target.value })}
                />
              ) : (
                <textarea
                  rows={4}
                  maxLength={20000}
                  value={block.text}
                  onChange={(event) => patch(block.id, { text: event.target.value })}
                />
              )}
            </label>
          ) : (
            <>
              <label>
                <span>
                  上传{kinds[block.kind]} {index + 1}
                </span>
                <input
                  type="file"
                  accept={block.kind === 'image' ? '.png,.jpg,.jpeg,.webp,.gif' : '.mp4,.webm,.mov'}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(block.id, file);
                    event.target.value = '';
                  }}
                />
              </label>
              <small>
                {uploading === block.id
                  ? '正在上传…'
                  : assets.find((asset) => asset.id === block.assetId)?.name ||
                    (block.kind === 'image' ? '图片最大 20 MiB' : '视频最大 100 MiB')}
              </small>
              <label>
                <span>媒体说明 {index + 1}</span>
                <input
                  maxLength={500}
                  value={block.caption}
                  onChange={(event) => patch(block.id, { caption: event.target.value })}
                />
              </label>
            </>
          )}
        </div>
      ))}
    </fieldset>
  );
}
