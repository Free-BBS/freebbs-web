import { useEffect, useRef, useState } from 'react';
import type { CollaborationEntry, CollaborationSpace } from '@freebbs-development/contracts';
import { useAuth } from '../../core/auth/AuthProvider.js';
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
  const active = useRef(true);
  const identity = useRef(client);
  identity.current = client;
  useEffect(() => {
    active.current = true;
    setError('');
    setBusy(false);
    return () => {
      active.current = false;
    };
  }, [client]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const startedClient = client;
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('revision', String(space.revision));
      for (const file of files) body.append('files', file);
      await client.request(`/collaboration/${space.id}/entries/${entry.id}/files`, {
        method: 'POST',
        body,
      });
      if (active.current && identity.current === startedClient) await onUpdate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '上传失败');
    } finally {
      setBusy(false);
    }
  }
  async function download(id: string, name: string) {
    setError('');
    try {
      const blob = await client.download(
        `/collaboration/${space.id}/entries/${entry.id}/files/${id}`,
      );
      if (active.current && identity.current === client) saveBlob(blob, name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下载失败');
    }
  }
  return (
    <div className="collaboration-attachments">
      {entry.files.map((file) => (
        <button type="button" key={file.id} onClick={() => void download(file.id, file.name)}>
          ↧ {file.name} · {(file.bytes / 1024).toFixed(0)} KiB
        </button>
      ))}
      {(space.canManage || entry.uid === user?.uid) &&
        space.status === 'published' &&
        entry.reviewStatus !== 'approved' &&
        !(space.kind === 'review' && entry.reviewStatus === 'pending' && entry.stage > 0) && (
          <label>
            补充附件
            <input
              type="file"
              multiple
              disabled={busy}
              onChange={(event) => {
                void upload(event.target.files);
                event.target.value = '';
              }}
            />
            <small>一次最多4个文件，每个不超过25 MiB。</small>
          </label>
        )}
      {error && <p role="alert">{error}</p>}
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
export function SpaceDownloads({ space }: { space: CollaborationSpace }) {
  const { client } = useAuth();
  const active = useRef(true);
  const identity = useRef(client);
  identity.current = client;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, [client]);
  const [pattern, setPattern] = useState('{name}');
  const [folders, setFolders] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download(archive = false) {
    setBusy(true);
    setError('');
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
      if (active.current && identity.current === client)
        saveBlob(blob, `${space.title}${archive ? '-materials.zip' : '.xlsx'}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '整理失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="collaboration-downloads">
      <summary>导出记录与整理文件</summary>
      <div className="collaboration-form-grid">
        <label>
          文件命名
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} maxLength={120} />
          <small>{'{name} 原文件名 · {index} 序号 · {uid} 用户标识 · {date} 提交日期'}</small>
        </label>
        <label>
          <span>目录结构</span>
          <select
            value={folders ? 'by-user' : 'flat'}
            onChange={(e) => setFolders(e.target.value === 'by-user')}
          >
            <option value="by-user">按提交者分文件夹</option>
            <option value="flat">放入同一文件夹</option>
          </select>
        </label>
      </div>
      <div className="collaboration-toolbar">
        <button disabled={busy} type="button" onClick={() => void download()}>
          下载Excel记录
        </button>
        <button
          disabled={busy || !space.entries.some((entry) => entry.files.length)}
          type="button"
          onClick={() => void download(true)}
        >
          整理为ZIP
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
