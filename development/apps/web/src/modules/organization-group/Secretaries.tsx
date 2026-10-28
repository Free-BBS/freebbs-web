import { useEffect, useRef, useState } from 'react';
import type {
  ClassSecretaryDirectory,
  ClassSecretaryUser,
  OrganizationGroupClass,
} from '@freebbs-development/contracts';
import type { GroupClient } from './OrganizationGroupPage.js';
import { jsonOptions } from './api.js';
import { errorMessage } from './model.js';
import './secretaries.css';

export function ClassSecretaries({
  api,
  classes,
}: {
  api: GroupClient;
  classes: OrganizationGroupClass[];
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ClassSecretaryDirectory | null>(null);
  const [selected, setSelected] = useState<ClassSecretaryUser | null>(null);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ query: search, page: String(page), pageSize: '12' });
    api
      .request<ClassSecretaryDirectory>(`/organization-group/secretaries?${params}`)
      .then(
        (next) => {
          if (live) setData(next);
        },
        (cause) => {
          if (live) setError(errorMessage(cause));
        },
      )
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api, search, page, refresh]);
  function choose(user: ClassSecretaryUser) {
    generation.current++;
    setSelected(user);
    setClassIds(user.classIds);
    setError('');
    setMessage('');
  }
  async function save(ids: string[]) {
    if (!selected || busy) return;
    const currentGeneration = generation.current;
    const uid = selected.uid;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const saved = await api.request<ClassSecretaryUser>(
        `/organization-group/secretaries/${encodeURIComponent(uid)}`,
        jsonOptions('PUT', { classIds: ids, revision: selected.revision }),
      );
      setData((current) =>
        current
          ? { ...current, items: current.items.map((row) => (row.uid === uid ? saved : row)) }
          : current,
      );
      if (generation.current === currentGeneration) {
        setSelected(saved);
        setClassIds(saved.classIds);
        setMessage(saved.classIds.length ? '团支书授权已保存' : '团支书授权已撤销');
      }
    } catch (cause) {
      if (generation.current === currentGeneration) setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function reloadSelected() {
    if (!selected) return;
    setBusy(true);
    try {
      const row = await api.request<ClassSecretaryUser>(
        `/organization-group/secretaries/${encodeURIComponent(selected.uid)}`,
      );
      choose(row);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const available = data?.classes ?? classes;
  return (
    <section className="og-secretaries" aria-label="团支书授权">
      <header>
        <h2>团支书授权</h2>
        <p>选择同学和负责班级。团支书可以填写活动，仅查看本人提交的台账。</p>
      </header>
      <form
        className="og-secretary-search"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(query.trim());
          setRefresh((value) => value + 1);
        }}
      >
        <label htmlFor="og-secretary-query">查找同学</label>
        <input
          id="og-secretary-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="姓名、用户名、学号或 UID"
          maxLength={100}
        />
        <button type="submit" disabled={loading || busy}>
          搜索
        </button>
      </form>
      {error && (
        <p role="alert" className="og-notice">
          {error}
          {selected ? (
            <button type="button" onClick={() => void reloadSelected()} disabled={busy}>
              重新加载授权
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setRefresh((value) => value + 1)}
              disabled={loading}
            >
              重新加载
            </button>
          )}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="og-secretary-layout">
        <div className="og-secretary-users" aria-label="用户列表">
          {loading && <p role="status">正在加载同学…</p>}
          {!loading && data?.items.length === 0 && <p>未找到同学</p>}
          {data?.items.map((row) => (
            <button
              type="button"
              key={row.uid}
              aria-pressed={selected?.uid === row.uid}
              disabled={busy}
              onClick={() => choose(row)}
            >
              <strong>{row.displayName || row.username}</strong>
              <span>
                {row.username}
                {row.studentId ? ` · ${row.studentId}` : ''}
              </span>
              <small>
                {row.classIds.length
                  ? row.classIds
                      .map((id) => available.find((item) => item.id === id)?.label ?? id)
                      .join('、')
                  : '尚未授予团支书'}
              </small>
            </button>
          ))}
          <nav aria-label="用户列表分页">
            <button
              type="button"
              disabled={page === 1 || loading || busy}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <span>第 {page} 页</span>
            <button
              type="button"
              disabled={!data || page * data.pageSize >= data.total || loading || busy}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </nav>
        </div>
        <div className="og-secretary-editor">
          {!selected ? (
            <p>选择一位同学，为其分配负责班级。</p>
          ) : (
            <>
              <h3>{selected.displayName || selected.username}</h3>
              <p>
                {selected.username}
                {selected.studentId ? ` · ${selected.studentId}` : ''}
              </p>
              <fieldset disabled={busy}>
                <legend>负责班级</legend>
                {available.length === 0 && <p>请先在台账设置中配置班级。</p>}
                <div className="og-secretary-classes">
                  {available.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={classIds.includes(item.id)}
                        onChange={(event) =>
                          setClassIds((current) =>
                            event.target.checked
                              ? [...current, item.id]
                              : current.filter((id) => id !== item.id),
                          )
                        }
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="og-secretary-actions">
                <button
                  type="button"
                  disabled={busy || available.length === 0}
                  onClick={() => void save(classIds)}
                >
                  {busy ? '正在保存…' : '保存授权'}
                </button>
                <button
                  type="button"
                  disabled={busy || selected.classIds.length === 0}
                  onClick={() => void save([])}
                >
                  撤销团支书
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
