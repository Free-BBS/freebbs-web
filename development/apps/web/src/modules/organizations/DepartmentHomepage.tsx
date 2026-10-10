import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  canEditDepartment,
  type DepartmentDefinition,
  type DepartmentHomePayload,
  type DepartmentActivitiesPayload,
} from '@freebbs-development/contracts';
import { ApiError, createApiClient, type ApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import { IsolatedDepartmentDocument } from './IsolatedDepartmentDocument.js';

export function DepartmentHomepage({
  department,
  introduction,
  client,
}: {
  department: DepartmentDefinition;
  introduction: string;
  client?: Pick<ApiClient, 'request'>;
}) {
  const fallback = useMemo(createApiClient, []);
  const api = client ?? fallback;
  const auth = useOptionalAuth();
  const base = `/organizations/${department.organizationKey}/${department.departmentKey}`;
  const [home, setHome] = useState<DepartmentHomePayload | null>(null);
  const [activities, setActivities] = useState<DepartmentActivitiesPayload | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState(false);
  const [upload, setUpload] = useState<{ file: File; html: string } | null>(null);
  const [past, setPast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const live = useRef(true);
  const readVersion = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    live.current = true;
    api.request<DepartmentHomePayload>(`${base}/home`).then(
      (data) => {
        if (live.current) setHome(data);
      },
      (error) => {
        if (live.current)
          setHomeError(error instanceof ApiError ? error.message : '主页暂时无法加载。');
      },
    );
    api.request<DepartmentActivitiesPayload>(`${base}/activities`).then(
      (data) => {
        if (live.current) setActivities(data);
      },
      () => {
        if (live.current) setActivityError(true);
      },
    );
    return () => {
      live.current = false;
      readVersion.current += 1;
    };
  }, [api, base]);
  const canEdit =
    home?.canEdit ??
    (Boolean(homeError) && canEditDepartment(auth?.user?.roles ?? [], department.id));
  async function choose(file?: File) {
    const version = ++readVersion.current;
    setUpload(null);
    setMessage(null);
    setReading(false);
    if (!file) return;
    if (!/\.html?$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
      setMessage('请选择不超过 5 MiB 的 HTML 文件。');
      return;
    }
    setReading(true);
    try {
      const html = await file.text();
      if (!live.current || version !== readVersion.current) return;
      if (!html.trim()) {
        setMessage('HTML 文件不能为空。');
        return;
      }
      setUpload({ file, html });
    } catch {
      if (live.current && version === readVersion.current) setMessage('文件读取失败，请重新选择。');
    } finally {
      if (live.current && version === readVersion.current) setReading(false);
    }
  }
  async function reload() {
    setBusy(true);
    try {
      const data = await api.request<DepartmentHomePayload>(`${base}/home`);
      if (!live.current) return;
      setHome(data);
      setHomeError(null);
      setConflict(false);
      setMessage('已加载最新主页，请核对预览后再次确认。');
    } catch (error) {
      if (live.current)
        setMessage(error instanceof ApiError ? error.message : '重新加载失败，请重试。');
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function save() {
    if (!upload || !home || !canEdit || busy || conflict) return;
    setBusy(true);
    setMessage(null);
    const body = new FormData();
    body.append('file', upload.file);
    body.append('revision', String(home.revision));
    try {
      const data = await api.request<DepartmentHomePayload>(`${base}/home`, {
        method: 'PUT',
        body,
      });
      if (!live.current) return;
      setHome(data);
      setUpload(null);
      if (input.current) input.current.value = '';
      setMessage('主页已经更新。');
    } catch (error) {
      if (!live.current) return;
      if (error instanceof ApiError && error.code === 'revision_conflict') {
        setConflict(true);
        setMessage('主页已被其他成员更新，请重新加载当前主页后核对并确认替换。');
      } else setMessage(error instanceof ApiError ? error.message : '保存失败，请稍后重试。');
    } finally {
      if (live.current) setBusy(false);
    }
  }
  const entries = activities ? (past ? activities.past : activities.active) : [];
  return (
    <>
      <header className="department-heading">
        <div>
          <p className="organization-eyebrow">{department.organizationName}</p>
          <h2>{department.name}</h2>
        </div>
        {department.id === 'tms.position' ? (
          <Link to="/collections/registrations?organization=tms">
            查看组织报名 <span aria-hidden="true">↗</span>
          </Link>
        ) : (
          <Link to={`/organizations/${department.organizationKey}`}>浏览组织 ↗</Link>
        )}
      </header>
      {canEdit ? (
        <div className="department-editor">
          <label>
            选择 HTML 文件
            <input
              ref={input}
              type="file"
              accept=".html,.htm,text/html"
              disabled={busy}
              onChange={(event) => void choose(event.target.files?.[0])}
            />
          </label>
          <p>上传完整 HTML；图片与样式请内嵌，或使用 HTTPS 绝对地址。先预览，再确认替换。</p>
          {home?.originalFilename ? <small>当前文件：{home.originalFilename}</small> : null}
        </div>
      ) : null}
      {message ? (
        <p role="status" className="department-message">
          {message}
        </p>
      ) : null}
      {homeError ? (
        <p role="alert">
          {homeError}
          <button type="button" disabled={busy} onClick={() => void reload()}>
            重新加载当前主页
          </button>
        </p>
      ) : null}
      {conflict ? (
        <button type="button" disabled={busy} onClick={() => void reload()}>
          重新加载当前主页
        </button>
      ) : null}
      {reading ? <p role="status">正在读取文件…</p> : null}
      {upload && canEdit ? (
        <section className="department-preview" aria-label="主页预览">
          <header>
            <div>
              <h3>替换预览</h3>
              <p>{upload.file.name}</p>
            </div>
            <div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setUpload(null);
                  if (input.current) input.current.value = '';
                }}
              >
                取消预览
              </button>
              <button
                type="button"
                className="organization-primary-link"
                disabled={busy || conflict || !home}
                onClick={() => void save()}
              >
                {busy ? '保存中…' : '确认替换主页'}
              </button>
            </div>
          </header>
          <IsolatedDepartmentDocument
            key={upload.html}
            html={upload.html}
            title={`${department.name}主页预览`}
          />
        </section>
      ) : null}
      {home?.html ? (
        <IsolatedDepartmentDocument
          key={home.html}
          html={home.html}
          title={`${department.name}主页`}
        />
      ) : home ? (
        <div className="department-introduction">
          <p>{introduction}</p>
          <p>部门主页正在准备中。</p>
        </div>
      ) : !homeError ? (
        <p role="status">正在加载部门主页…</p>
      ) : null}
      <section className="department-activities" aria-label="相关活动">
        <header>
          <h3>相关活动</h3>
          <div>
            <button type="button" aria-pressed={!past} onClick={() => setPast(false)}>
              活跃活动
            </button>
            <button type="button" aria-pressed={past} onClick={() => setPast(true)}>
              以往活动
            </button>
          </div>
        </header>
        {activityError ? (
          <p role="status">相关活动暂时无法加载。</p>
        ) : !activities ? (
          <p role="status">正在整理相关活动…</p>
        ) : entries.length ? (
          <div className="department-activity-grid">
            {entries.map((item) => (
              <Link
                className="department-activity-card"
                key={`${item.source}:${item.id}`}
                to={item.detailsPath}
              >
                <span>
                  {past ? '已结束' : item.status === 'upcoming' ? '即将开放' : '开放中'}{' '}
                  <b aria-hidden="true">↗</b>
                </span>
                <h4>{item.title}</h4>
                <p>{item.description}</p>
                {item.location ? <small>{item.location}</small> : null}
              </Link>
            ))}
          </div>
        ) : (
          <p className="department-activity-empty">{past ? '暂无以往活动' : '暂无活跃活动'}</p>
        )}
      </section>
    </>
  );
}
