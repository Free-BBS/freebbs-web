import type {
  AdminPermission,
  AdminPermissionBinding,
  AdminTagDefinition,
  PermissionBindingInput,
} from '@freebbs-development/contracts';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { PermissionBindingEditor } from '../PermissionBindingEditor.js';
import { errorMessage, Feedback, SectionState, type AdminClient } from '../admin-support.js';

const emptyDraft = {
  key: '',
  name: '',
  description: '',
  requiredScopeType: '',
  metadata: '{}',
};

function asInput(binding: AdminPermissionBinding): PermissionBindingInput {
  return {
    action: binding.action,
    resource: binding.resource,
    effect: binding.effect,
    scope: binding.scope,
  };
}

export function TagDefinitionsSection({ client }: { client: AdminClient }) {
  const [definitions, setDefinitions] = useState<AdminTagDefinition[]>([]);
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);
  const [records, setRecords] = useState<AdminPermissionBinding[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [bindings, setBindings] = useState<PermissionBindingInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selected = useMemo(
    () => definitions.find(({ key }) => key === selectedKey),
    [definitions, selectedKey],
  );

  function edit(definition: AdminTagDefinition, source = records) {
    setCreating(false);
    setSelectedKey(definition.key);
    setDraft({
      key: definition.key,
      name: definition.name,
      description: definition.description,
      requiredScopeType: definition.requiredScopeType ?? '',
      metadata: JSON.stringify(definition.metadata, null, 2),
    });
    setBindings(
      source
        .filter((item) => item.tagKey === definition.key && item.status === 'active')
        .map(asInput),
    );
    setError('');
    setSuccess('');
  }

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextDefinitions, nextPermissions, nextBindings] = await Promise.all([
        client.request<AdminTagDefinition[]>('/admin/tag-definitions'),
        client.request<AdminPermission[]>('/admin/permissions'),
        client.request<AdminPermissionBinding[]>('/admin/tag-permissions'),
      ]);
      setDefinitions(nextDefinitions);
      setPermissions(nextPermissions);
      setRecords(nextBindings);
      if (nextDefinitions[0]) {
        setSelectedKey(nextDefinitions[0].key);
        setDraft({
          key: nextDefinitions[0].key,
          name: nextDefinitions[0].name,
          description: nextDefinitions[0].description,
          requiredScopeType: nextDefinitions[0].requiredScopeType ?? '',
          metadata: JSON.stringify(nextDefinitions[0].metadata, null, 2),
        });
        setBindings(
          nextBindings
            .filter((item) => item.tagKey === nextDefinitions[0]?.key && item.status === 'active')
            .map(asInput),
        );
      }
    } catch (caught) {
      setLoadError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => void load(), [load]);

  async function submitDefinition(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!draft.key.trim() || !draft.name.trim()) {
      setError('Tag key 与名称为必填项。');
      return;
    }
    let metadata: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(draft.metadata);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
      metadata = parsed as Record<string, unknown>;
    } catch {
      setError('元数据必须是 JSON 对象。');
      return;
    }
    setBusy(true);
    try {
      const input = {
        ...(creating ? { key: draft.key.trim() } : {}),
        name: draft.name.trim(),
        description: draft.description.trim(),
        requiredScopeType: draft.requiredScopeType.trim() || null,
        metadata,
      };
      const updated = await client.request<AdminTagDefinition>(
        creating ? '/admin/tag-definitions' : `/admin/tag-definitions/${selectedKey}`,
        {
          method: creating ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
      setDefinitions((current) =>
        creating
          ? [updated, ...current]
          : current.map((item) => (item.key === updated.key ? updated : item)),
      );
      edit(updated);
      setSuccess(`Tag ${updated.key} 已${creating ? '创建' : '更新'}。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    if (!selected) return;
    const nextStatus = selected.status === 'active' ? 'inactive' : 'active';
    if (
      !window.confirm(
        `确认${nextStatus === 'active' ? '启用' : '停用'} Tag？\nKey: ${selected.key}\n作用域: ${selected.requiredScopeType ?? 'public'}\n影响: 关联授权与权限将${nextStatus === 'active' ? '重新参与' : '停止参与'}授权判定。`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const updated = await client.request<AdminTagDefinition>(
        `/admin/tag-definitions/${selected.key}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      setDefinitions((current) =>
        current.map((item) => (item.key === updated.key ? updated : item)),
      );
      setSuccess(`Tag ${updated.key} 已${updated.status === 'active' ? '启用' : '停用'}。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function savePermissions() {
    if (!selected) return;
    if (
      !window.confirm(
        `确认替换 Tag 权限？\nKey: ${selected.key}\n作用域: ${selected.requiredScopeType ?? 'public'}\n影响: 将以当前 ${bindings.length} 条绑定完整替换现有集合。`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const response = await client.request<{
        tagKey: string;
        bindings: AdminPermissionBinding[];
      }>(`/admin/tag-definitions/${selected.key}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bindings }),
      });
      setRecords((current) => [
        ...current.filter((item) => item.tagKey !== response.tagKey),
        ...response.bindings,
      ]);
      setBindings(response.bindings.map(asInput));
      setSuccess(`已替换 ${selected.key} 的权限绑定。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-section-layout" aria-labelledby="tags-heading">
      <header className="admin-section-heading">
        <p className="eyebrow">TAG POLICY</p>
        <h3 id="tags-heading">Tag 定义</h3>
        <p>扩展 Tag 可创建，创建后内部 key 保持只读；定义和权限替换均经服务端审计。</p>
      </header>
      <Feedback error={error} success={success} />
      <SectionState loading={loading} error={loadError} onRetry={() => void load()}>
        <div className="admin-editor-layout">
          <aside className="admin-definition-list" aria-label="Tag 列表">
            <button
              type="button"
              className="create-definition-button"
              onClick={() => {
                setCreating(true);
                setSelectedKey('');
                setDraft(emptyDraft);
                setBindings([]);
              }}
            >
              ＋ 创建扩展 Tag
            </button>
            {definitions.map((definition) => (
              <button
                type="button"
                key={definition.key}
                aria-pressed={!creating && definition.key === selectedKey}
                onClick={() => edit(definition)}
              >
                <strong>{definition.name}</strong>
                <span>{definition.key}</span>
              </button>
            ))}
          </aside>
          <section className="panel">
            <div className="admin-record-heading">
              <h4>{creating ? '创建扩展 Tag' : (selected?.name ?? '暂无 Tag 定义')}</h4>
              {selected ? (
                <button type="button" disabled={busy} onClick={() => void toggleStatus()}>
                  {selected.status === 'active' ? '停用' : '启用'} {selected.name}
                </button>
              ) : null}
            </div>
            <form aria-label={creating ? '创建 Tag' : '更新 Tag'} onSubmit={submitDefinition}>
              <label>
                Tag 内部 key{creating ? '' : '（只读）'}
                <input
                  readOnly={!creating}
                  value={draft.key}
                  onChange={(event) => setDraft({ ...draft, key: event.currentTarget.value })}
                />
              </label>
              <label>
                显示名称
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                />
              </label>
              <label>
                描述
                <textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.currentTarget.value })
                  }
                />
              </label>
              <label>
                必需作用域类型
                <input
                  value={draft.requiredScopeType}
                  placeholder="留空表示 public"
                  onChange={(event) =>
                    setDraft({ ...draft, requiredScopeType: event.currentTarget.value })
                  }
                />
              </label>
              <label>
                元数据 JSON
                <textarea
                  value={draft.metadata}
                  onChange={(event) => setDraft({ ...draft, metadata: event.currentTarget.value })}
                />
              </label>
              <button type="submit" disabled={busy || (!creating && !selected)}>
                {creating ? '创建 Tag' : '保存定义'}
              </button>
            </form>
            {selected ? (
              <PermissionBindingEditor
                label="Tag 权限"
                bindings={bindings}
                permissions={permissions}
                disabled={busy || selected.status !== 'active'}
                onChange={setBindings}
                onSave={() => void savePermissions()}
              />
            ) : null}
          </section>
        </div>
      </SectionState>
    </section>
  );
}
