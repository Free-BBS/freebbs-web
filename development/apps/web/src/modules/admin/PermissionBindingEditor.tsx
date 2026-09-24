import type {
  AdminPermission,
  PermissionBindingInput,
  PermissionAction,
} from '@freebbs-development/contracts';
import { useState } from 'react';

export function PermissionBindingEditor({
  label,
  bindings,
  permissions,
  disabled,
  onChange,
  onSave,
}: {
  label: string;
  bindings: PermissionBindingInput[];
  permissions: AdminPermission[];
  disabled?: boolean;
  onChange: (bindings: PermissionBindingInput[]) => void;
  onSave: () => void;
}) {
  const [action, setAction] = useState<PermissionAction>(
    permissions[0]?.action ?? ('admin.manage' as PermissionAction),
  );
  const [resource, setResource] = useState(permissions[0]?.resource ?? 'admin');
  const [effect, setEffect] = useState<'allow' | 'deny'>('allow');
  const [scopeType, setScopeType] = useState('public');
  const [scopeId, setScopeId] = useState('*');
  const [error, setError] = useState('');

  function add() {
    if (![action, resource, scopeType, scopeId].every((value) => value.trim())) {
      setError('请完整填写动作、资源和作用域。');
      return;
    }
    if (
      bindings.some(
        (item) =>
          item.action === action &&
          item.resource === resource &&
          item.scope.type === scopeType &&
          item.scope.id === scopeId,
      )
    ) {
      setError('同一动作、资源与作用域不能重复。');
      return;
    }
    setError('');
    onChange([
      ...bindings,
      { action, resource, effect, scope: { type: scopeType.trim(), id: scopeId.trim() } },
    ]);
  }

  return (
    <div className="permission-editor" aria-label={label}>
      {error ? <p role="alert">{error}</p> : null}
      <div className="admin-form-grid permission-editor-fields">
        <label>
          权限动作
          <input
            list={`${label}-actions`}
            value={action}
            onChange={(event) => {
              const next = event.currentTarget.value as PermissionAction;
              setAction(next);
              const match = permissions.find((item) => item.action === next);
              if (match) setResource(match.resource);
            }}
          />
          <datalist id={`${label}-actions`}>
            {permissions.map((permission) => (
              <option key={permission.id} value={permission.action}>
                {permission.resource}
              </option>
            ))}
          </datalist>
        </label>
        <label>
          资源
          <input value={resource} onChange={(event) => setResource(event.currentTarget.value)} />
        </label>
        <label>
          效果
          <select
            value={effect}
            onChange={(event) => setEffect(event.currentTarget.value as 'allow' | 'deny')}
          >
            <option value="allow">允许</option>
            <option value="deny">拒绝</option>
          </select>
        </label>
        <label>
          权限作用域类型
          <input value={scopeType} onChange={(event) => setScopeType(event.currentTarget.value)} />
        </label>
        <label>
          权限作用域 ID
          <input value={scopeId} onChange={(event) => setScopeId(event.currentTarget.value)} />
        </label>
      </div>
      <button type="button" className="secondary-button" onClick={add} disabled={disabled}>
        添加权限绑定
      </button>
      {bindings.length ? (
        <ul className="record-list responsive-record-list">
          {bindings.map((binding, index) => (
            <li
              key={`${binding.action}:${binding.resource}:${binding.scope.type}:${binding.scope.id}`}
              className="record-card"
            >
              <div>
                <strong>
                  {binding.effect === 'allow' ? '允许' : '拒绝'} {binding.action}
                </strong>
                <p>
                  {binding.resource} · {binding.scope.type}:{binding.scope.id}
                </p>
              </div>
              <button
                type="button"
                className="danger-button"
                aria-label={`移除权限 ${binding.action}`}
                disabled={disabled}
                onClick={() => onChange(bindings.filter((_, itemIndex) => itemIndex !== index))}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="record-list-state">当前没有权限绑定。保存后将以空集合替换。</p>
      )}
      <button type="button" disabled={disabled} onClick={onSave}>
        保存{label}
      </button>
    </div>
  );
}
