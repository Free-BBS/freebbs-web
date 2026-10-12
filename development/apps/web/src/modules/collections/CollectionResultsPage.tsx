import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CollectionSchema } from '@freebbs-development/contracts';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import './completion.css';

interface ResultItem {
  id: string;
  versionId?: string;
  respondentUid: string;
  submittedAt: string;
  answers: Record<string, unknown>;
  identity?: { name: string; studentId: string } | null;
  guest: boolean;
}
interface ResultPayload {
  form: {
    id: string;
    title: string;
    status: string;
    canManage: boolean;
    schema?: CollectionSchema;
  };
  items: ResultItem[];
  total: number;
  page: number;
  pageSize: number;
  stats: {
    submitted: number;
    authenticated: number;
    guests: number;
    choices: Record<string, Record<string, number>>;
  };
  versions?: Array<{ id: string; version: number; schema: CollectionSchema }>;
}
interface RecipientPayload {
  items: Array<{
    name: string;
    studentId: string;
    completed: boolean;
    submissionCount: number;
    submittedAt: string | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
  stats: { total: number; completed: number; pending: number };
}
export function CollectionResultsPage({
  client,
}: {
  client?: Pick<ApiClient, 'request'> & Partial<Pick<ApiClient, 'download'>>;
}) {
  const { collectionId } = useParams();
  const fallback = useMemo(createApiClient, []);
  const api = client ?? fallback;
  const base = `/collections/forms/${encodeURIComponent(collectionId ?? '')}`;
  const [results, setResults] = useState<ResultPayload>();
  const [versionId, setVersionId] = useState('');
  const [recipients, setRecipients] = useState<RecipientPayload>();
  const [page, setPage] = useState(1),
    [rosterPage, setRosterPage] = useState(1),
    [search, setSearch] = useState(''),
    [rosterSearch, setRosterSearch] = useState(''),
    [completion, setCompletion] = useState('all');
  const [error, setError] = useState(''),
    [feedback, setFeedback] = useState(''),
    [rowErrors, setRowErrors] = useState<Array<{ row: number; message: string }>>([]),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    setPage(1);
    setRosterPage(1);
    setResults(undefined);
    setRecipients(undefined);
    setVersionId('');
  }, [collectionId]);
  useEffect(() => {
    let active = true;
    setError('');
    const query = new URLSearchParams({ page: String(page), pageSize: '25', query: search });
    if (versionId) query.set('versionId', versionId);
    api.request<ResultPayload>(`${base}/results?${query}`).then(
      (data) => {
        if (active) setResults(data);
      },
      (cause) => {
        if (active) {
          setResults(undefined);
          setError(cause instanceof Error ? cause.message : '无法读取结果');
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, base, page, search, revision, versionId]);
  useEffect(() => {
    if (!results?.form.canManage) return;
    let active = true;
    const query = new URLSearchParams({
      page: String(rosterPage),
      pageSize: '25',
      query: rosterSearch,
      completion,
    });
    api.request<RecipientPayload>(`${base}/recipients?${query}`).then(
      (data) => {
        if (active) setRecipients(data);
      },
      (cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '无法读取名单');
      },
    );
    return () => {
      active = false;
    };
  }, [api, base, results?.form.canManage, rosterPage, rosterSearch, completion, revision]);
  async function importRoster(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    setFeedback('');
    setRowErrors([]);
    try {
      const body = new FormData();
      body.append('file', file);
      const result = await api.request<{
        imported: number;
        duplicates: number;
        errors: Array<{ row: number; message: string }>;
        errorCount: number;
      }>(`${base}/recipients/import`, { method: 'POST', body });
      setFeedback(
        `导入 ${result.imported} 人，跳过 ${result.duplicates} 个重复，${result.errorCount} 行有误。`,
      );
      setRowErrors(result.errors);
      setRevision((current) => current + 1);
      setRosterPage(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }
  async function download(path: string, name: string) {
    if (!api.download) {
      setError('当前连接不支持文件下载');
      return;
    }
    setBusy(true);
    try {
      const blob = await api.download(path);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下载失败');
    } finally {
      setBusy(false);
    }
  }
  const schema =
    results?.versions?.find((version) => version.id === versionId)?.schema ?? results?.form.schema;
  const fields = new Map<string, CollectionSchema['fields'][number]>();
  for (const version of versionId
    ? (results?.versions?.filter((item) => item.id === versionId) ?? [])
    : (results?.versions ?? []))
    for (const field of version.schema.fields)
      if (!fields.has(field.id)) fields.set(field.id, field);
  if (!fields.size) for (const field of schema?.fields ?? []) fields.set(field.id, field);
  const answerFields = [...fields.values()].filter(
    (field) => !['instructions', 'identity'].includes(field.kind),
  );
  return (
    <main className="collection-results-page">
      <header>
        <Link to="/collections/activities/manage">← 活动管理</Link>
        <h1>{results?.form.title ?? '收集结果'}</h1>
        {results && (
          <Link to={`/collections/workbench/${encodeURIComponent(results.form.id)}`}>编辑草稿</Link>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      {!results && !error && <p role="status">正在读取管理结果…</p>}
      {results?.form.canManage && (
        <>
          <div className="collection-results-stats">
            <span>有效提交 {results.stats.submitted}</span>
            <span>登录提交 {results.stats.authenticated}</span>
            <span>访客提交 {results.stats.guests}</span>
          </div>
          <div className="collection-results-toolbar">
            <label>
              表单版本
              <select
                value={versionId}
                onChange={(event) => {
                  setVersionId(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部发布版本</option>
                {results.versions?.map((version) => (
                  <option key={version.id} value={version.id}>
                    第{version.version}版 · {version.schema.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              搜索回答
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            {schema?.outputs.map((output) => (
              <button
                key={output.id}
                type="button"
                disabled={busy || results.form.status === 'draft'}
                onClick={() =>
                  void download(
                    `${base}/exports/${encodeURIComponent(output.id)}?${versionId ? `versionId=${encodeURIComponent(versionId)}` : 'allVersions=1'}`,
                    output.kind === 'excel'
                      ? `${output.fileName.replace(/\.[^.]+$/u, '')}.xlsx`
                      : output.fileName,
                  )
                }
              >
                下载{output.label}
              </button>
            ))}
            {schema?.publicRegistration && results.form.status === 'published' && (
              <Link
                to={`/collections/public/${encodeURIComponent(results.form.id)}`}
                target="_blank"
                rel="noreferrer"
              >
                公开填写链接
              </Link>
            )}
            {results.form.status !== 'draft' && (
              <Link
                to={`/collections/registrations?focus=native_collection:${encodeURIComponent(results.form.id)}`}
              >
                登录填写链接
              </Link>
            )}
          </div>
          <div className="collection-results-scroll">
            <table>
              <thead>
                <tr>
                  <th>填写人</th>
                  <th>提交时间</th>
                  {answerFields.map((field) => (
                    <th key={field.id}>{field.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.guest
                        ? '访客（未认证）'
                        : item.identity
                          ? `${item.identity.name} · ${item.identity.studentId}`
                          : item.respondentUid}
                    </td>
                    <td>{new Date(item.submittedAt).toLocaleString('zh-CN')}</td>
                    {answerFields.map((field) => (
                      <td key={field.id}>
                        <AnswerValue
                          value={item.answers[field.id]}
                          onDownload={(asset) =>
                            void download(
                              item.guest
                                ? `${base}/guest-assets/${encodeURIComponent(asset.id)}`
                                : `/collections/assets/${encodeURIComponent(asset.id)}`,
                              asset.name,
                            )
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!results.items.length && <p>暂无匹配的提交。</p>}
          <Pagination page={page} total={results.total} onPage={setPage} />
          {Object.entries(results.stats.choices).length > 0 && (
            <section>
              <h2>选项统计</h2>
              {Object.entries(results.stats.choices).map(([id, counts]) => (
                <div key={id}>
                  <strong>{schema?.fields.find((field) => field.id === id)?.label ?? id}</strong>
                  {Object.entries(counts).map(([choice, count]) => (
                    <p key={choice}>
                      {choice}：{count}
                    </p>
                  ))}
                </div>
              ))}
            </section>
          )}
          <section>
            <h2>姓名学号名单与完成情况</h2>
            <p>
              名单第一行使用“姓名”和“学号”。学号设为文本以保留前导零；导入名单不赋予学校身份，完成情况只匹配登录身份中的姓名学号。
            </p>
            <div className="collection-results-toolbar">
              <label>
                导入姓名学号名单
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  disabled={busy}
                  onChange={(event) => {
                    void importRoster(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </label>
              <button
                disabled={busy}
                type="button"
                onClick={() => void download(`${base}/recipients/export`, '名单完成情况.xlsx')}
              >
                下载完成名单
              </button>
              <label>
                搜索名单
                <input
                  value={rosterSearch}
                  onChange={(event) => {
                    setRosterSearch(event.target.value);
                    setRosterPage(1);
                  }}
                />
              </label>
              <label>
                完成筛选
                <select
                  value={completion}
                  onChange={(event) => {
                    setCompletion(event.target.value);
                    setRosterPage(1);
                  }}
                >
                  <option value="all">全部</option>
                  <option value="completed">已完成</option>
                  <option value="pending">未完成</option>
                </select>
              </label>
            </div>
            {feedback && <p role="status">{feedback}</p>}
            {rowErrors.map((item, index) => (
              <p key={index}>
                第 {item.row} 行：{item.message}
              </p>
            ))}
            {recipients && (
              <>
                <div className="collection-results-stats">
                  <span>名单 {recipients.stats.total}</span>
                  <span>已完成 {recipients.stats.completed}</span>
                  <span>未完成 {recipients.stats.pending}</span>
                </div>
                <div className="collection-results-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>姓名</th>
                        <th>学号</th>
                        <th>完成情况</th>
                        <th>提交次数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipients.items.map((item) => (
                        <tr key={item.studentId}>
                          <td>{item.name}</td>
                          <td>{item.studentId}</td>
                          <td>{item.completed ? '已完成' : '未完成'}</td>
                          <td>{item.submissionCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={rosterPage} total={recipients.total} onPage={setRosterPage} />
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
function Pagination({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / 25));
  return (
    <div className="collection-results-toolbar">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        上一页
      </button>
      <span>
        {page} / {pages} · {total} 条
      </span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        下一页
      </button>
    </div>
  );
}
function AnswerValue({
  value,
  onDownload,
}: {
  value: unknown;
  onDownload: (asset: { id: string; name: string }) => void;
}) {
  if (Array.isArray(value))
    return (
      <>
        {value.map((item, index) => (
          <AnswerValue key={index} value={item} onDownload={onDownload} />
        ))}
      </>
    );
  if (value && typeof value === 'object' && 'id' in value && 'name' in value)
    return (
      <button type="button" onClick={() => onDownload(value as { id: string; name: string })}>
        {String(value.name)}
      </button>
    );
  return <span>{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}</span>;
}
