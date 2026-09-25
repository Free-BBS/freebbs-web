import type {
  AdminPermission,
  AdminPermissionBinding,
  AdminRole,
  PermissionBindingInput,
  RoleKey,
} from '@freebbs-development/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PermissionBindingEditor } from '../PermissionBindingEditor.js';
import { errorMessage, Feedback, SectionState, type AdminClient } from '../admin-support.js';

function asInput(binding: AdminPermissionBinding): PermissionBindingInput {
  return {
    action: binding.action,
    resource: binding.resource,
    effect: binding.effect,
    scope: binding.scope,
  };
}

export function RolesPermissionsSection({ client }: { client: AdminClient }) {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);
  const [records, setRecords] = useState<AdminPermissionBinding[]>([]);
  const [selectedKey, setSelectedKey] = useState<RoleKey>('platform.super_admin');
  const [bindings, setBindings] = useState<PermissionBindingInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedRole = useMemo(
    () => roles.find(({ key }) => key === selectedKey) ?? roles[0],
    [roles, selectedKey],
  );

  const select = useCallback(
    (key: RoleKey, source = records) => {
      setSelectedKey(key);
      setBindings(
        source.filter((item) => item.roleKey === key && item.status === 'active').map(asInput),
      );
      setError('');
      setSuccess('');
    },
    [records],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextRoles, nextPermissions, nextBindings] = await Promise.all([
        client.request<AdminRole[]>('/admin/roles'),
        client.request<AdminPermission[]>('/admin/permissions'),
        client.request<AdminPermissionBinding[]>('/admin/role-permissions'),
      ]);
      setRoles(nextRoles);
      setPermissions(nextPermissions);
      setRecords(nextBindings);
      const firstKey = nextRoles[0]?.key ?? 'platform.super_admin';
      setSelectedKey(firstKey);
      setBindings(
        nextBindings
          .filter((item) => item.roleKey === firstKey && item.status === 'active')
          .map(asInput),
      );
    } catch (caught) {
      setLoadError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => void load(), [load]);

  async function toggleStatus() {
    if (!selectedRole) return;
    const nextStatus = selectedRole.status === 'active' ? 'inactive' : 'active';
    const impact =
      nextStatus === 'inactive'
        ? '停用后，此角色的全部授权立即失效；平台最高管理员受服务端恢复性保护。'
        : '启用后，现存有效分配及权限绑定将重新参与授权判定。';
    if (
      !window.confirm(
        `确认${nextStatus === 'active' ? '启用' : '停用'}角色？\nKey: ${selectedRole.key}\n作用域: ${selectedRole.scope.type}:${selectedRole.scope.id}\n影响: ${impact}`,
      )
    )
      return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const updated = await client.request<AdminRole>(`/admin/roles/${selectedRole.key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      setRoles((current) => current.map((item) => (item.key === updated.key ? updated : item)));
      setSuccess(`角色 ${updated.key} 已${updated.status === 'active' ? '启用' : '停用'}。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function savePermissions() {
    if (!selectedRole) return;
    const impact = `将以当前 ${bindings.length} 条绑定完整替换 ${selectedRole.key} 的权限集合。`;
    if (
      !window.confirm(
        `确认替换角色权限？\nKey: ${selectedRole.key}\n作用域: 全部绑定\n影响: ${impact}`,
      )
    )
      return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const response = await client.request<{
        roleKey: RoleKey;
        bindings: AdminPermissionBinding[];
      }>(`/admin/roles/${selectedRole.key}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bindings }),
      });
      setRecords((current) => [
        ...current.filter((item) => item.roleKey !== response.roleKey),
        ...response.bindings,
      ]);
      setBindings(response.bindings.map(asInput));
      setSuccess(`已替换 ${selectedRole.key} 的权限绑定。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-section-layout" aria-labelledby="roles-permissions-heading">
      <header className="admin-section-heading">
        <p className="eyebrow">ROLE POLICY</p>
        <h3 id="roles-permissions-heading">角色与权限</h3>
        <p>角色内部 key 只读；状态与权限集合仅在服务端成功后反映到页面。</p>
      </header>
      <Feedback error={error} success={success} />
      <SectionState loading={loading} error={loadError} onRetry={() => void load()}>
        <div className="admin-editor-layout">
          <aside className="admin-definition-list" aria-label="角色列表">
            {roles.map((role) => (
              <button
                type="button"
                key={role.key}
                aria-pressed={role.key === selectedRole?.key}
                onClick={() => select(role.key)}
              >
                <strong>{role.name}</strong>
                <span>{role.key}</span>
              </button>
            ))}
          </aside>
          {selectedRole ? (
            <section className="panel" aria-labelledby="selected-role-heading">
              <div className="admin-record-heading">
                <div>
                  <h4 id="selected-role-heading">{selectedRole.name}</h4>
                  <span
                    className="status-badge"
                    data-status={selectedRole.status === 'active' ? 'success' : 'warning'}
                  >
                    {selectedRole.status === 'active' ? '启用中' : '已停用'}
                  </span>
                </div>
                <button type="button" disabled={busy} onClick={() => void toggleStatus()}>
                  {selectedRole.status === 'active' ? '停用' : '启用'}
                  {selectedRole.name}
                </button>
              </div>
              <label>
                角色内部 key（只读）
                <input readOnly value={selectedRole.key} />
              </label>
              <PermissionBindingEditor
                label="角色权限"
                bindings={bindings}
                permissions={permissions}
                disabled={busy || selectedRole.status !== 'active'}
                onChange={setBindings}
                onSave={() => void savePermissions()}
              />
            </section>
          ) : (
            <p className="record-list-state">暂无角色定义。</p>
          )}
        </div>
      </SectionState>
    </section>
  );
}
