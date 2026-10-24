import {
  ROLE_KEYS,
  SOCIAL_ORGANIZATIONS,
  identityLabels,
  type DevelopmentDirectoryFilters,
  type Page,
  type SystemSettingsOrganizations,
} from '@freebbs-development/contracts';
import './directory-controls.css';

export function directoryUrl(
  base: string,
  query: string,
  filters: DevelopmentDirectoryFilters,
  page = 1,
) {
  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (query.trim()) params.set('query', query.trim());
  for (const key of ['organizationId', 'roleKey', 'admission'] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  return `${base}?${params}`;
}
export function directoryResult<T>(result: T[] | Page<T>): Page<T> {
  return Array.isArray(result)
    ? { items: result, total: result.length, page: 1, pageSize: 20 }
    : result;
}
export function DirectoryFilters({
  value,
  onChange,
  metadata,
}: {
  value: DevelopmentDirectoryFilters;
  onChange: (value: DevelopmentDirectoryFilters) => void;
  metadata?: SystemSettingsOrganizations;
}) {
  return (
    <div className="settings-directory-filters">
      <label>
        组织筛选
        <select
          aria-label="组织筛选"
          value={value.organizationId ?? ''}
          onChange={(event) =>
            onChange({ ...value, organizationId: event.target.value || undefined })
          }
        >
          <option value="">全部组织</option>
          {(metadata?.organizations ?? SOCIAL_ORGANIZATIONS).map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        身份筛选
        <select
          aria-label="身份筛选"
          value={value.roleKey ?? ''}
          onChange={(event) => onChange({ ...value, roleKey: event.target.value || undefined })}
        >
          <option value="">全部身份</option>
          {ROLE_KEYS.map((role) => (
            <option key={role} value={role}>
              {metadata?.roles.find((item) => item.key === role)?.name ??
                identityLabels([role])[0] ??
                role}
            </option>
          ))}
        </select>
      </label>
      <label>
        发展端身份
        <select
          aria-label="发展端身份"
          value={value.admission ?? ''}
          onChange={(event) =>
            onChange({
              ...value,
              admission:
                (event.target.value as DevelopmentDirectoryFilters['admission']) || undefined,
            })
          }
        >
          <option value="">全部用户</option>
          <option value="member">普通成员</option>
          <option value="lead">发展端负责人</option>
        </select>
      </label>
    </div>
  );
}
export function DirectoryPagination({
  page,
  total,
  loading,
  onPage,
}: {
  page: number;
  total: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <nav className="settings-directory-pagination" aria-label="用户名单分页">
      <span>
        共 {total} 位 · 第 {page} / {Math.max(1, Math.ceil(total / 20))} 页
      </span>
      <button type="button" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>
        上一页
      </button>
      <button
        type="button"
        disabled={loading || page * 20 >= total}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </button>
    </nav>
  );
}
