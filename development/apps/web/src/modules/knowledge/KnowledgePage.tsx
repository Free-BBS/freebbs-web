import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  SOCIAL_ORGANIZATIONS,
  organizationForRole,
  type ScopeRef,
  type UserContext,
} from '@freebbs-development/contracts';
import { EditorDrawer } from '../../components/EditorDrawer.js';
import { FilterBar } from '../../components/FilterBar.js';
import { ModulePageHeader } from '../../components/ModulePageHeader.js';
import { ResponsiveRecordList } from '../../components/ResponsiveRecordList.js';
import { StatusBadge } from '../../components/StatusBadge.js';
import { createApiClient, type ApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import { isSuperAdmin } from '../../core/permissions/Can.js';

import {
  knowledgeEntryPath,
  knowledgePreview,
  statusLabels,
  tone,
  typeLabels,
  type KnowledgeAudience,
  type KnowledgeEntry,
  type KnowledgeStatus,
  type KnowledgeType,
} from './model.js';

export interface KnowledgePageProps {
  client?: Pick<ApiClient, 'request'>;
  user?: UserContext | null;
}
interface PagePolicy {
  action: string;
  resource: string;
  effect: 'allow' | 'deny';
  scope?: ScopeRef;
}
type PageUser = UserContext & { policies?: readonly PagePolicy[] };

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim() ? error.message : fallback;
const splitTags = (value: string) => [
  ...new Set(
    value
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  ),
];
const matchesQuery = (entry: KnowledgeEntry, query: string) =>
  [entry.title, entry.summary ?? '', ...(entry.tags ?? []), entry.body]
    .join(' ')
    .toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase());
const matches = (pattern: string, value: string) =>
  pattern === '*' ||
  pattern === value ||
  (pattern.endsWith('.*') && value.startsWith(pattern.slice(0, -1)));
const sameScope = (left: ScopeRef | undefined, right: ScopeRef) =>
  left === undefined || (left.type === right.type && left.id === right.id);
function permitted(user: PageUser | null, action: string, scope: ScopeRef): boolean {
  if (user === null) return false;
  if (isSuperAdmin(user)) return true;
  const policies = (user.policies ?? []).filter(
    (policy) =>
      matches(policy.action, action) &&
      matches(policy.resource, 'knowledge_entry') &&
      sameScope(policy.scope, scope),
  );
  return (
    !policies.some((policy) => policy.effect === 'deny') &&
    policies.some((policy) => policy.effect === 'allow')
  );
}

export function KnowledgePage({ client, user: suppliedUser }: KnowledgePageProps) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const auth = useOptionalAuth();
  const user = (
    suppliedUser === undefined ? (auth?.user ?? null) : suppliedUser
  ) as PageUser | null;
  const managesAcrossOrganizations =
    user?.roles.includes('platform.super_admin') === true ||
    user?.roles.some((role) => organizationForRole(role)?.level === 'lead') === true;
  const organizations = useMemo(
    () =>
      managesAcrossOrganizations
        ? SOCIAL_ORGANIZATIONS
        : SOCIAL_ORGANIZATIONS.filter((organization) =>
            user?.tags.some((tag) => tag.key === organization.tagKey),
          ),
    [managesAcrossOrganizations, user],
  );
  const canViewSocialOrganizations = organizations.length > 0;
  const [searchParams, setSearchParams] = useSearchParams();
  const audience: KnowledgeAudience =
    canViewSocialOrganizations && searchParams.get('audience') === 'social_org'
      ? 'social_org'
      : 'general';
  function setAudience(next: KnowledgeAudience) {
    setState('loading');
    const params = new URLSearchParams(searchParams);
    if (next === 'social_org') params.set('audience', next);
    else params.delete('audience');
    setSearchParams(params, { replace: true });
  }
  const [organizationId, setOrganizationId] = useState<string>(() => organizations[0]?.id ?? '');
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [drawerEntry, setDrawerEntry] = useState<KnowledgeEntry | 'create' | null>(null);
  const [type, setType] = useState<KnowledgeType>('workflow');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [tags, setTags] = useState('');
  const [summary, setSummary] = useState('');
  const [maintainedAt, setMaintainedAt] = useState('');
  const [maintainerUid, setMaintainerUid] = useState('');
  const writableOrganizations = useMemo(
    () =>
      organizations.filter((organization) =>
        permitted(user, 'knowledge.create', { type: 'social_organization', id: organization.id }),
      ),
    [organizations, user],
  );
  const selectedScope = useMemo<ScopeRef | null>(
    () =>
      audience === 'social_org'
        ? organizationId
          ? { type: 'social_organization', id: organizationId }
          : null
        : { type: 'public', id: '*' },
    [audience, organizationId],
  );
  const canCreate = selectedScope !== null && permitted(user, 'knowledge.create', selectedScope);

  const loadEntries = useCallback(async () => {
    setState('loading');
    try {
      setEntries(await api.request<KnowledgeEntry[]>(`/knowledge/entries?audience=${audience}`));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [api, audience]);
  useEffect(() => {
    if (!canViewSocialOrganizations && audience === 'social_org') setAudience('general');
  }, [audience, canViewSocialOrganizations]);
  useEffect(() => {
    const availableOrganizations =
      audience === 'social_org' ? writableOrganizations : organizations;
    if (!availableOrganizations.some((organization) => organization.id === organizationId)) {
      setOrganizationId(availableOrganizations[0]?.id ?? '');
    }
  }, [audience, organizationId, organizations, writableOrganizations]);
  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  function openDrawer(entry: KnowledgeEntry | 'create') {
    setFeedback(null);
    setOperationError(null);
    setDrawerEntry(entry);
    setType(entry === 'create' ? 'workflow' : entry.type);
    setTitle(entry === 'create' ? '' : entry.title);
    setBody(entry === 'create' ? '' : entry.body);
    setCategory(entry === 'create' ? 'general' : (entry.category ?? 'general'));
    setTags(entry === 'create' ? '' : (entry.tags ?? []).join(', '));
    setSummary(entry === 'create' ? '' : (entry.summary ?? ''));
    setMaintainedAt(entry === 'create' ? '' : (entry.maintainedAt ?? ''));
    setMaintainerUid(entry === 'create' ? '' : (entry.maintainerUid ?? ''));
    if (entry === 'create' && audience === 'social_org') {
      setOrganizationId(writableOrganizations[0]?.id ?? '');
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle || !cleanBody) {
      setOperationError('标题和正文不能为空');
      return;
    }
    const creating = drawerEntry === 'create';
    const existing = drawerEntry !== null && drawerEntry !== 'create' ? drawerEntry : null;
    if (!creating && !globalThis.confirm(`确认保存“${existing!.title}”的修改吗？`)) return;
    setPending(true);
    setOperationError(null);
    setFeedback(null);
    try {
      const metadata = {
        category: category.trim() || 'general',
        tags: splitTags(tags),
        summary: summary.trim(),
        maintainedAt: maintainedAt.trim() || null,
        maintainerUid: maintainerUid.trim() || null,
      };
      const socialOrganizationId = organizationId || writableOrganizations[0]?.id;
      await api.request<KnowledgeEntry>('/knowledge/entries', {
        method: creating ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          creating
            ? {
                ...metadata,
                type,
                title: cleanTitle,
                body: cleanBody,
                status: 'draft',
                audience,
                organizationId: audience === 'social_org' ? socialOrganizationId : null,
                scope:
                  audience === 'social_org'
                    ? { type: 'social_organization', id: socialOrganizationId }
                    : { type: 'public', id: '*' },
              }
            : {
                ...metadata,
                id: existing!.id,
                type,
                title: cleanTitle,
                body: cleanBody,
                scope: existing!.scope,
              },
        ),
      });
      setDrawerEntry(null);
      setFeedback(creating ? '草稿已创建' : '修改已保存');
      await loadEntries();
    } catch (error) {
      setOperationError(
        errorMessage(error, creating ? '草稿保存失败，请稍后重试' : '修改保存失败，请稍后重试'),
      );
    } finally {
      setPending(false);
    }
  }
  async function transition(
    entry: KnowledgeEntry,
    to: KnowledgeStatus,
    label: '发布' | '撤回' | '归档',
  ) {
    if (!globalThis.confirm(`确认${label}“${entry.title}”吗？`)) return;
    setPending(true);
    setOperationError(null);
    setFeedback(null);
    try {
      await api.request(`/knowledge/entries/${entry.id}/transitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      setFeedback(to === 'published' ? '经验已发布' : to === 'draft' ? '经验已撤回' : '经验已归档');
      await loadEntries();
    } catch (error) {
      setOperationError(errorMessage(error, `${label}失败，请检查权限后重试`));
    } finally {
      setPending(false);
    }
  }
  const visibleEntries = useMemo(
    () => entries.filter((entry) => matchesQuery(entry, query)),
    [entries, query],
  );
  return (
    <section className="module-page" aria-label="经验库">
      <ModulePageHeader
        title={audience === 'general' ? 'General' : '社工组织'}
        description={
          audience === 'general'
            ? '面向全体同学的流程、常见问题与经验沉淀。'
            : '仅限已获授权的社工组织经验资料。'
        }
        actions={
          canCreate ? (
            <button type="button" onClick={() => openDrawer('create')}>
              新建经验
            </button>
          ) : undefined
        }
      />
      <FilterBar
        ariaLabel="搜索经验库"
        className="knowledge-filters"
        onSubmit={(event) => event.preventDefault()}
      >
        <label>
          搜索
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="标题、摘要、标签或正文"
          />
        </label>
        <div className="audience-switcher" role="group" aria-label="经验库分区">
          <button
            aria-pressed={audience === 'general'}
            type="button"
            onClick={() => setAudience('general')}
          >
            General
          </button>
          {canViewSocialOrganizations ? (
            <button
              aria-pressed={audience === 'social_org'}
              type="button"
              onClick={() => setAudience('social_org')}
            >
              社工组织
            </button>
          ) : null}
        </div>
      </FilterBar>
      {feedback ? <p role="status">{feedback}</p> : null}
      {operationError ? <p role="alert">{operationError}</p> : null}
      <ResponsiveRecordList
        ariaLabel="经验条目列表"
        className="knowledge-card-grid"
        records={visibleEntries}
        state={state}
        errorMessage="暂时无法加载经验库"
        emptyTitle={entries.length === 0 ? '经验库中还没有内容' : '没有匹配的经验'}
        emptyDescription={
          entries.length === 0 ? '有维护权限的同学可以新建一份草稿。' : '请调整搜索词后再试。'
        }
        getKey={(entry) => entry.id}
        renderRecord={(entry) => (
          <article
            className="record-card knowledge-record"
            aria-labelledby={`knowledge-${entry.id}`}
          >
            <header>
              <div>
                <p className="record-eyebrow">
                  {[entry.category, typeLabels[entry.type]].filter(Boolean).join(' · ')}
                </p>
                <h3 id={`knowledge-${entry.id}`}>
                  <Link className="knowledge-card-link" to={knowledgeEntryPath(entry.id, audience)}>
                    {entry.title}
                  </Link>
                </h3>
              </div>
              <StatusBadge status={tone(entry.status)}>{statusLabels[entry.status]}</StatusBadge>
            </header>
            <p className="knowledge-card-preview">{knowledgePreview(entry)}</p>
            <span className="knowledge-read-hint" aria-hidden="true">
              阅读全文 <span>↗</span>
            </span>
            <div className="record-metadata">
              <p className="record-meta">
                {(entry.tags ?? []).map((tag) => (
                  <span key={tag} className="record-tag">
                    {tag}
                  </span>
                ))}
              </p>
              {entry.maintainedAt ? (
                <p className="record-meta">维护于 {entry.maintainedAt.slice(0, 10)}</p>
              ) : null}
              {entry.maintainerUid ? (
                <p className="record-meta">维护人：{entry.maintainerUid}</p>
              ) : null}
            </div>
            <div className="record-actions">
              {permitted(user, 'knowledge.create', entry.scope) &&
              entry.status !== 'archived' &&
              (entry.status !== 'published' ||
                permitted(user, 'knowledge.publish', entry.scope)) ? (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`编辑 ${entry.title}`}
                  onClick={() => openDrawer(entry)}
                >
                  编辑
                </button>
              ) : null}
              {permitted(user, 'knowledge.publish', entry.scope) && entry.status === 'draft' ? (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`发布 ${entry.title}`}
                  onClick={() => void transition(entry, 'published', '发布')}
                >
                  发布
                </button>
              ) : null}
              {permitted(user, 'knowledge.publish', entry.scope) && entry.status === 'published' ? (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`撤回 ${entry.title}`}
                    onClick={() => void transition(entry, 'draft', '撤回')}
                  >
                    撤回
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`归档 ${entry.title}`}
                    onClick={() => void transition(entry, 'archived', '归档')}
                  >
                    归档
                  </button>
                </>
              ) : null}
            </div>
          </article>
        )}
      />
      <EditorDrawer
        open={drawerEntry !== null}
        title={drawerEntry === 'create' ? '新建经验' : '编辑经验'}
        description="完善正文、摘要和分类，方便同学查阅。"
        onClose={() => setDrawerEntry(null)}
      >
        <form onSubmit={(event) => void save(event)} noValidate>
          <label>
            经验类型
            <select value={type} onChange={(event) => setType(event.target.value as KnowledgeType)}>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {drawerEntry === 'create' &&
          audience === 'social_org' &&
          writableOrganizations.length > 1 ? (
            <label>
              所属社工组织
              <select
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
              >
                {writableOrganizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            {drawerEntry === 'create' ? '经验标题' : '编辑标题'}
            <input
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            {drawerEntry === 'create' ? '经验正文' : '编辑正文'}
            <textarea
              value={body}
              maxLength={20000}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <label>
            分类
            <input
              value={category}
              maxLength={80}
              onChange={(event) => setCategory(event.target.value)}
            />
          </label>
          <label>
            标签
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="用逗号分隔"
            />
          </label>
          <label>
            摘要
            <textarea
              value={summary}
              maxLength={500}
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
          <label>
            维护日期
            <input value={maintainedAt} onChange={(event) => setMaintainedAt(event.target.value)} />
          </label>
          <label>
            维护人
            <input
              value={maintainerUid}
              onChange={(event) => setMaintainerUid(event.target.value)}
            />
          </label>
          <button type="submit" disabled={pending}>
            {drawerEntry === 'create' ? '保存草稿' : '保存修改'}
          </button>
        </form>
      </EditorDrawer>
    </section>
  );
}
