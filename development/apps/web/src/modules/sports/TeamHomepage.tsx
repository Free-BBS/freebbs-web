import { useEffect, useRef, useState } from 'react';
import type { SportsTeamHomepage } from '@freebbs-development/contracts';
import { IsolatedDepartmentDocument } from '../organizations/IsolatedDepartmentDocument.js';
import type { DevelopmentApi } from './SportsPage.js';
import { TeamShowcase } from './TeamShowcase.js';
import './sports-maintenance.css';

function readHtml(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) return reject(new Error('无法读取 HTML 文件'));
      try {
        resolve(new TextDecoder('utf-8', { fatal: true }).decode(reader.result));
      } catch {
        reject(new Error('HTML 文件必须使用 UTF-8 编码'));
      }
    };
    reader.onerror = () => reject(new Error('无法读取 HTML 文件'));
    reader.readAsArrayBuffer(file);
  });
}
export function TeamHomepage({
  client,
  teamId,
  name,
  canEditCard,
  canEditShowcase = canEditCard,
}: {
  client: DevelopmentApi;
  teamId: string;
  name: string;
  canEditCard: boolean;
  canEditShowcase?: boolean;
}) {
  const [home, setHome] = useState<SportsTeamHomepage | null>(null);
  const [draft, setDraft] = useState<{ file: File; html: string } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const generation = useRef(0);
  const requestVersion = useRef(0);
  const acceptedRevision = useRef(-1);
  const selection = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const path = `/sports/teams/${encodeURIComponent(teamId)}/homepage`;
  useEffect(() => {
    const current = ++generation.current;
    const version = ++requestVersion.current;
    acceptedRevision.current = -1;
    const controller = new AbortController();
    setHome(null);
    setDraft(null);
    setError('');
    setMessage('');
    setBusy(false);
    setShowLegacy(false);
    void client
      .request<SportsTeamHomepage>(path, { signal: controller.signal })
      .then((value) => {
        if (generation.current === current && requestVersion.current === version) {
          acceptedRevision.current = value.revision;
          setHome(value);
        }
      })
      .catch((caught) => {
        if (
          generation.current === current &&
          requestVersion.current === version &&
          !controller.signal.aborted
        )
          setError(caught instanceof Error ? caught.message : '主页暂时无法加载');
      });
    return () => {
      ++generation.current;
      ++selection.current;
      controller.abort();
      pending.current?.abort();
    };
  }, [client, path]);
  const canEdit = canEditCard && home?.canEdit === true;
  async function select(file: File) {
    const selected = ++selection.current;
    const current = generation.current;
    setDraft(null);
    setError('');
    setMessage('');
    try {
      if (!/\.html?$/i.test(file.name)) throw new Error('请选择 .html 或 .htm 文件');
      if (file.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MiB 上限');
      const html = await readHtml(file);
      if (
        !html.trim() ||
        [...html].some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 && code !== 9 && code !== 10 && code !== 13;
        })
      )
        throw new Error('文件为空或包含二进制内容');
      if (current === generation.current && selected === selection.current)
        setDraft({ file, html });
    } catch (caught) {
      if (current === generation.current && selected === selection.current)
        setError(caught instanceof Error ? caught.message : '预览失败');
    }
  }
  async function save(remove: boolean) {
    if (!home || !canEdit || busy || (!remove && !draft)) return;
    const current = generation.current;
    // Starting a write supersedes reads already in flight, including their feedback.
    const version = ++requestVersion.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = new FormData();
      body.append('revision', String(home.revision));
      if (draft) body.append('file', draft.file);
      const saved = await client.request<SportsTeamHomepage>(
        path,
        remove
          ? {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ revision: home.revision }),
              signal: controller.signal,
            }
          : { method: 'PUT', body, signal: controller.signal },
      );
      if (
        current !== generation.current ||
        version !== requestVersion.current ||
        controller.signal.aborted ||
        saved.revision < acceptedRevision.current
      )
        return;
      acceptedRevision.current = saved.revision;
      setHome(saved);
      setDraft(null);
      if (input.current) input.current.value = '';
      setMessage(remove ? 'HTML 首页已移除，继续展示图文风采' : '代表队首页已发布');
    } catch (caught) {
      if (
        current === generation.current &&
        version === requestVersion.current &&
        !controller.signal.aborted
      )
        setError(
          `${caught instanceof Error ? caught.message : '保存失败'}；草稿已保留。可刷新主页版本后重试。`,
        );
    } finally {
      if (current === generation.current && pending.current === controller) {
        setBusy(false);
        pending.current = null;
      }
    }
  }
  async function refresh() {
    const current = generation.current;
    const version = ++requestVersion.current;
    try {
      const value = await client.request<SportsTeamHomepage>(path);
      if (
        current === generation.current &&
        version === requestVersion.current &&
        value.revision >= acceptedRevision.current
      ) {
        acceptedRevision.current = value.revision;
        setHome(value);
        setError('');
        setMessage('已刷新主页版本，上传草稿仍保留');
      }
    } catch (caught) {
      if (current === generation.current && version === requestVersion.current)
        setError(caught instanceof Error ? caught.message : '刷新失败');
    }
  }
  function cancel() {
    ++selection.current;
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setDraft(null);
    setError('');
    if (input.current) input.current.value = '';
    void refresh();
  }
  return (
    <section className="sports-homepage" aria-label="代表队首页">
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {home?.html && (
        <IsolatedDepartmentDocument key={teamId} html={home.html} title={`${name}首页`} />
      )}
      {canEdit && (
        <div className="sports-homepage-editor">
          <div>
            <h3>维护代表队首页</h3>
            <p>上传完整 HTML 页面，预览后发布。支持 UTF-8 的 .html / .htm 文件，最大 5 MiB。</p>
          </div>
          {home?.originalFilename && (
            <p>
              当前文件：{home.originalFilename} · 版本 {home.revision}
            </p>
          )}
          <label>
            选择代表队 HTML 首页
            <input
              ref={input}
              type="file"
              accept=".html,.htm,text/html"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void select(file);
              }}
            />
          </label>
          {draft && (
            <div className="sports-homepage-preview">
              <p>待发布：{draft.file.name}</p>
              <IsolatedDepartmentDocument html={draft.html} title={`${name}首页上传预览`} />
              <div className="sports-maintenance-actions">
                <button type="button" disabled={busy} onClick={() => void save(false)}>
                  {busy ? '正在发布…' : '确认发布首页'}
                </button>
                <button type="button" onClick={cancel}>
                  取消上传
                </button>
              </div>
            </div>
          )}
          <div className="sports-maintenance-actions">
            <button type="button" disabled={busy} onClick={() => void refresh()}>
              刷新主页版本
            </button>
            {home?.html && (
              <button type="button" disabled={busy} onClick={() => void save(true)}>
                移除 HTML 首页
              </button>
            )}
          </div>
        </div>
      )}
      {home?.html && canEditShowcase && (
        <button type="button" onClick={() => setShowLegacy((value) => !value)}>
          {showLegacy ? '收起图文风采' : '编辑旧图文风采'}
        </button>
      )}
      {(!home?.html || showLegacy) && (
        <TeamShowcase key={teamId} client={client} teamId={teamId} canEdit={canEditShowcase} />
      )}
    </section>
  );
}
