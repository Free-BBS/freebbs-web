import { useEffect, useRef, useState } from 'react';
import type { OrganizationGroupFile } from '@freebbs-development/contracts';
import type { GroupClient } from './OrganizationGroupPage.js';
import { errorMessage } from './model.js';

export async function downloadBlob(
  api: GroupClient,
  path: string,
  name: string,
  isCurrent: () => boolean,
) {
  if (!api.download) throw new Error('文件下载暂不可用。');
  const blob = await api.download(path);
  if (!isCurrent()) return;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export function FileTile({
  file,
  api,
  onRemove,
}: {
  file: OrganizationGroupFile;
  api: GroupClient;
  onRemove?: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  const readVersion = useRef(0);
  const current = useRef<string | null>(null);
  useEffect(() => {
    live.current = true;
    readVersion.current += 1;
    setUrl(null);
    setBusy(false);
    setError('');
    return () => {
      live.current = false;
      readVersion.current += 1;
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = null;
    };
  }, [file.id, api]);
  async function preview() {
    if (!api.download) return;
    const version = readVersion.current;
    setBusy(true);
    setError('');
    try {
      const blob = await api.download(
        `/organization-group/files/${encodeURIComponent(file.id)}?preview=1`,
      );
      if (!live.current || version !== readVersion.current) return;
      const safeMime =
        /^image\/(png|jpeg|webp)$/.test(file.mime) || file.mime === 'application/pdf';
      if (!safeMime) throw new Error('该文件仅支持下载。');
      const safeBlob = new Blob([blob], { type: file.mime });
      const next = URL.createObjectURL(safeBlob);
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = next;
      setUrl(next);
    } catch (cause) {
      if (live.current && version === readVersion.current) setError(errorMessage(cause));
    } finally {
      if (live.current && version === readVersion.current) setBusy(false);
    }
  }
  async function download() {
    const version = readVersion.current;
    const isCurrent = () => live.current && version === readVersion.current;
    setError('');
    try {
      await downloadBlob(
        api,
        `/organization-group/files/${encodeURIComponent(file.id)}`,
        file.originalName,
        isCurrent,
      );
    } catch (cause) {
      if (isCurrent()) setError(errorMessage(cause));
    }
  }
  return (
    <div className="og-file">
      <div className="og-file-top">
        <span>{file.originalName}</span>
        <small>{Math.max(1, Math.ceil(file.size / 1024))} KiB</small>
      </div>
      <div className="og-actions">
        {file.previewable && api.download ? (
          <button type="button" disabled={busy} onClick={() => void preview()}>
            {busy ? '加载中…' : '预览'}
          </button>
        ) : null}
        {api.download ? (
          <button type="button" onClick={() => void download()}>
            下载
          </button>
        ) : null}
        {onRemove ? (
          <button type="button" onClick={onRemove}>
            移除
          </button>
        ) : null}
      </div>
      {url ? (
        file.mime === 'application/pdf' ? (
          <iframe title={file.originalName} src={url} />
        ) : (
          <img alt={file.originalName} src={url} />
        )
      ) : null}
      {url ? (
        <button
          type="button"
          onClick={() => {
            if (current.current) URL.revokeObjectURL(current.current);
            current.current = null;
            setUrl(null);
          }}
        >
          关闭预览
        </button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
export async function uploadFile(
  api: GroupClient,
  file: File,
  yearId: string,
  purpose: 'activity_photo' | 'resource',
  entryId?: string,
) {
  const body = new FormData();
  body.append('file', file);
  body.append('yearId', yearId);
  body.append('purpose', purpose);
  if (entryId) body.append('entryId', entryId);
  return api.request<OrganizationGroupFile>('/organization-group/uploads', {
    method: 'POST',
    body,
  });
}
