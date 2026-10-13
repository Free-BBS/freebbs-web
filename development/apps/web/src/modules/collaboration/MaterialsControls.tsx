import { useEffect, useRef, useState } from 'react';
import type { CollaborationEntry, CollaborationSpace } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { useAuth } from '../../core/auth/AuthProvider.js';
import './materials-controls.css';

// A new scope invalidates pending operations even when A switches to B and back to A.
function useFileOperations(client: ApiClient, spaceId: string, entryId = '', uid = '') {
  const scope = useRef({ client, spaceId, entryId, uid, active: true, pending: false });
  if (
    scope.current.client !== client ||
    scope.current.spaceId !== spaceId ||
    scope.current.entryId !== entryId ||
    scope.current.uid !== uid
  ) {
    scope.current = { client, spaceId, entryId, uid, active: true, pending: false };
  }
  const current = scope.current;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    current.active = true;
    setBusy(false);
    setError('');
    setMessage('');
    return () => {
      current.active = false;
    };
  }, [current]);
  function begin() {
    if (current.pending) return null;
    current.pending = true;
    setBusy(true);
    setError('');
    setMessage('');
    const isCurrent = () => current.active && scope.current === current;
    return {
      isCurrent,
      finish: () => {
        if (isCurrent()) {
          current.pending = false;
          setBusy(false);
        }
      },
    };
  }
  return { busy, error, message, setError, setMessage, begin };
}

function FileIcon({ download = false }: { download?: boolean }) {
  return (
    <svg
      className="collaboration-file-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {download ? (
        <>
          <path d="M12 3v12m-4-4 4 4 4-4" />
          <path d="M5 16v4h14v-4" />
        </>
      ) : (
        <>
          <path d="M14 3H6v18h12V7Z" />
          <path d="M14 3v5h4M9 12h6m-6 4h6" />
        </>
      )}
    </svg>
  );
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function EntryMaterials({
  space,
  entry,
  onUpdate,
}: {
  space: CollaborationSpace;
  entry: CollaborationEntry;
  onUpdate: () => Promise<void>;
}) {
  const { client, user } = useAuth();
  const operation = useFileOperations(client, space.id, entry.id, user?.uid);
  const input = useRef<HTMLInputElement>(null);
  const [retryFiles, setRetryFiles] = useState<File[]>([]);
  useEffect(() => {
    setRetryFiles([]);
    if (input.current) input.current.value = '';
  }, [client, space.id, entry.id, user?.uid]);
  const canUpload =
    (space.canManage || entry.uid === user?.uid) &&
    space.status === 'published' &&
    entry.reviewStatus !== 'approved' &&
    !(space.kind === 'review' && entry.reviewStatus === 'pending' && entry.stage > 0);

  async function upload(files: FileList | File[] | null) {
    if (!files?.length || !canUpload) return;
    const selected = Array.from(files);
    setRetryFiles([]);
    operation.setMessage('');
    if (selected.length > 4) {
      operation.setError('一次最多上传4个文件，请减少文件后重试。');
      return;
    }
    if (selected.some((file) => file.size > 25 * 1024 * 1024)) {
      operation.setError('每个文件不得超过25 MiB，请压缩文件后重试。');
      return;
    }
    const pending = operation.begin();
    if (!pending) return;
    let uploaded = false;
    try {
      const body = new FormData();
      body.append('revision', String(space.revision));
      for (const file of selected) body.append('files', file);
      await client.request(`/collaboration/${space.id}/entries/${entry.id}/files`, {
        method: 'POST',
        body,
      });
      if (!pending.isCurrent()) return;
      uploaded = true;
      if (input.current) input.current.value = '';
      await onUpdate();
      if (!pending.isCurrent()) return;
      operation.setMessage(`已上传${selected.length}个附件。`);
    } catch (cause) {
      if (pending.isCurrent()) {
        if (!uploaded) setRetryFiles(selected);
        operation.setError(
          `${uploaded ? '附件已上传，但列表刷新失败：' : ''}${cause instanceof Error ? cause.message : '上传失败，请重试。'}`,
        );
      }
    } finally {
      pending.finish();
    }
  }
  async function download(id: string, name: string) {
    const pending = operation.begin();
    if (!pending) return;
    try {
      const blob = await client.download(
        `/collaboration/${space.id}/entries/${entry.id}/files/${id}`,
      );
      if (pending.isCurrent()) {
        saveBlob(blob, name);
        operation.setMessage('附件已准备下载。');
      }
    } catch (cause) {
      if (pending.isCurrent())
        operation.setError(cause instanceof Error ? cause.message : '下载失败，请重试。');
    } finally {
      pending.finish();
    }
  }
  return (
    <div
      className="collaboration-attachments collaboration-files--refined"
      aria-busy={operation.busy}
    >
      <div className="collaboration-file-heading">
        <strong>附件</strong>
        <span>{entry.files.length}个文件</span>
      </div>
      {entry.files.length ? (
        <ul className="collaboration-file-list">
          {entry.files.map((file) => (
            <li className="collaboration-file-row" key={file.id}>
              <FileIcon />
              <div className="collaboration-file-meta">
                <span>{file.name}</span>
                <small>{fileSize(file.bytes)}</small>
              </div>
              <button
                className="collaboration-file-download"
                type="button"
                disabled={operation.busy}
                aria-label={`下载 ${file.name}`}
                onClick={() => void download(file.id, file.name)}
              >
                <FileIcon download />
                <span>下载</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="collaboration-file-help">这条记录暂无附件。</p>
      )}
      {canUpload && (
        <div className="collaboration-file-upload">
          <label>
            <span>补充附件</span>
            <input
              key={`${space.id}:${entry.id}:${user?.uid ?? ''}`}
              ref={input}
              type="file"
              aria-label="补充附件"
              multiple
              disabled={operation.busy}
              onChange={(event) => void upload(event.target.files)}
            />
          </label>
          <small>一次最多4个文件，每个不超过25 MiB。选择后立即上传。</small>
        </div>
      )}
      {operation.busy && (
        <p className="collaboration-file-feedback" role="status">
          正在处理附件，请稍候…
        </p>
      )}
      {operation.message && (
        <p className="collaboration-file-feedback" role="status">
          {operation.message}
        </p>
      )}
      {operation.error && (
        <p className="collaboration-file-error" role="alert">
          {operation.error}
        </p>
      )}
      {canUpload && retryFiles.length > 0 && (
        <button
          className="collaboration-file-retry"
          type="button"
          disabled={operation.busy}
          onClick={() => void upload(retryFiles)}
        >
          重试上传
        </button>
      )}
    </div>
  );
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function archivePreview(space: CollaborationSpace, pattern: string, folders: boolean) {
  const entry = space.entries.find((entry) => entry.files.length);
  if (!entry) return '';
  const file = entry.files[0];
  const dot = file.name.lastIndexOf('.');
  const basename = dot > 0 ? file.name.slice(0, dot) : file.name;
  const extension = dot > 0 ? file.name.slice(dot) : '';
  const name =
    pattern
      .replaceAll('{name}', basename)
      .replaceAll('{index}', '001')
      .replaceAll('{uid}', entry.uid)
      .replaceAll('{date}', entry.createdAt.slice(0, 10)) + extension;
  return `${folders ? `${entry.uid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}-${entry.id.slice(0, 8)}/` : ''}${name}`;
}

export function SpaceDownloads({ space }: { space: CollaborationSpace }) {
  const { client, user } = useAuth();
  const operation = useFileOperations(client, space.id, '', user?.uid);
  const [pattern, setPattern] = useState('{name}');
  const [folders, setFolders] = useState(true);
  const hasFiles = space.entries.some((entry) => entry.files.length);
  async function download(archive = false) {
    if (archive && (!hasFiles || !pattern.trim())) return;
    const pending = operation.begin();
    if (!pending) return;
    try {
      const blob = await client.download(
        archive
          ? `/collaboration/${space.id}/materials/archive`
          : `/collaboration/${space.id}/export`,
        archive
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pattern, folders }),
            }
          : {},
      );
      if (pending.isCurrent()) {
        saveBlob(blob, `${space.title}${archive ? '-materials.zip' : '.xlsx'}`);
        operation.setMessage(archive ? 'ZIP材料包已准备下载。' : 'Excel记录已准备下载。');
      }
    } catch (cause) {
      if (pending.isCurrent())
        operation.setError(cause instanceof Error ? cause.message : '整理失败，请重试。');
    } finally {
      pending.finish();
    }
  }
  return (
    <details
      className="collaboration-downloads collaboration-files--refined"
      aria-busy={operation.busy}
    >
      <summary>导出记录与整理文件</summary>
      <p className="collaboration-file-help">
        Excel包含当前权限可见的记录；ZIP集中下载这些记录的附件。
      </p>
      <div className="collaboration-file-export-actions">
        <button type="button" disabled={operation.busy} onClick={() => void download()}>
          <FileIcon download />
          下载Excel记录
        </button>
        <button
          type="button"
          disabled={operation.busy || !hasFiles || !pattern.trim()}
          onClick={() => void download(true)}
        >
          <FileIcon download />
          整理为ZIP
        </button>
      </div>
      {!hasFiles && (
        <p className="collaboration-file-help">当前可见记录暂无附件，可先下载Excel记录。</p>
      )}
      <details className="collaboration-file-options">
        <summary>ZIP高级选项</summary>
        <div className="collaboration-file-options-grid">
          <label>
            <span>文件命名</span>
            <input
              aria-label="文件命名"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              maxLength={120}
              disabled={operation.busy}
            />
            <small>{'{name} 原文件名 · {index} 序号 · {uid} 用户标识 · {date} 提交日期'}</small>
          </label>
          <label>
            <span>目录结构</span>
            <select
              aria-label="目录结构"
              value={folders ? 'by-user' : 'flat'}
              onChange={(event) => setFolders(event.target.value === 'by-user')}
              disabled={operation.busy}
            >
              <option value="by-user">按提交者分文件夹</option>
              <option value="flat">放入同一文件夹</option>
            </select>
          </label>
        </div>
        {!pattern.trim() ? (
          <p className="collaboration-file-error">请输入文件命名规则。</p>
        ) : (
          hasFiles && (
            <p className="collaboration-file-example">
              示例：{archivePreview(space, pattern, folders)}
            </p>
          )
        )}
      </details>
      {operation.busy && (
        <p className="collaboration-file-feedback" role="status">
          正在生成文件，请稍候…
        </p>
      )}
      {operation.message && (
        <p className="collaboration-file-feedback" role="status">
          {operation.message}
        </p>
      )}
      {operation.error && (
        <p className="collaboration-file-error" role="alert">
          {operation.error}
        </p>
      )}
    </details>
  );
}
