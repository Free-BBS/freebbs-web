import type {
  AdminModule,
  AdminModuleOwner,
  ModuleId,
  ModuleOwnerInput,
} from '@freebbs-development/contracts';
import { useCallback, useEffect, useState } from 'react';

import { errorMessage, Feedback, SectionState, type AdminClient } from '../admin-support.js';

export function ModulesOwnersSection({ client }: { client: AdminClient }) {
  const [modules, setModules] = useState<AdminModule[]>([]);
  const [selectedId, setSelectedId] = useState<ModuleId>('dashboard');
  const [owners, setOwners] = useState<ModuleOwnerInput[]>([]);
  const [ownerType, setOwnerType] = useState<ModuleOwnerInput['ownerType']>('role');
  const [ownerId, setOwnerId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selected = modules.find(({ id }) => id === selectedId);

  const loadOwners = useCallback(
    async (moduleId: ModuleId) => {
      const response = await client.request<{ moduleId: ModuleId; owners: AdminModuleOwner[] }>(
        `/admin/modules/${moduleId}/owners`,
      );
      setOwners(
        response.owners.map(({ ownerType: type, ownerId: id }) => ({
          ownerType: type,
          ownerId: id,
        })),
      );
    },
    [client],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const next = await client.request<AdminModule[]>('/admin/modules');
      setModules(next);
      const first = next[0]?.id;
      if (first) {
        setSelectedId(first);
        await loadOwners(first);
      }
    } catch (caught) {
      setLoadError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [client, loadOwners]);

  useEffect(() => void load(), [load]);

  async function select(moduleId: ModuleId) {
    setSelectedId(moduleId);
    setError('');
    setSuccess('');
    setOwners([]);
    try {
      await loadOwners(moduleId);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function toggleModule() {
    if (!selected) return;
    const enabled = selected.status !== 'enabled';
    if (
      !window.confirm(
        `确认${enabled ? '启用' : '停用'}模块？\nKey: ${selected.id}\n作用域: 全平台\n影响: ${enabled ? '模块权限将重新参与判定。' : '模块权限将立即从授权上下文移除。'}`,
      )
    )
      return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const updated = await client.request<AdminModule>('/admin/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId: selected.id, enabled }),
      });
      setModules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSuccess(`模块 ${updated.id} 已${updated.status === 'enabled' ? '启用' : '停用'}。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function addOwner() {
    setError('');
    if (!ownerId.trim()) {
      setError('请填写负责人标识。');
      return;
    }
    if (owners.some((owner) => owner.ownerType === ownerType && owner.ownerId === ownerId.trim())) {
      setError('该负责人已经在替换集合中。');
      return;
    }
    setOwners((current) => [...current, { ownerType, ownerId: ownerId.trim() }]);
    setOwnerId('');
  }

  async function saveOwners() {
    if (!selected) return;
    if (
      !window.confirm(
        `确认替换模块负责人？\nKey: ${selected.id}\n作用域: 全模块\n影响: 将以当前 ${owners.length} 位负责人完整替换现有集合。`,
      )
    )
      return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const response = await client.request<{ moduleId: ModuleId; owners: AdminModuleOwner[] }>(
        `/admin/modules/${selected.id}/owners`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ owners }),
        },
      );
      setOwners(
        response.owners.map(({ ownerType: type, ownerId: id }) => ({
          ownerType: type,
          ownerId: id,
        })),
      );
      setSuccess(`已替换 ${selected.id} 的负责人。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-section-layout" aria-labelledby="modules-heading">
      <header className="admin-section-heading">
        <p className="eyebrow">MODULE OWNERSHIP</p>
        <h3 id="modules-heading">模块与负责人</h3>
        <p>负责人必须是已存在且启用的角色、主站 UID 或代表队；服务端原子替换整个集合。</p>
      </header>
      <Feedback error={error} success={success} />
      <SectionState loading={loading} error={loadError} onRetry={() => void load()}>
        <div className="admin-editor-layout">
          <aside className="admin-definition-list" aria-label="模块列表">
            {modules.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={item.id === selectedId}
                onClick={() => void select(item.id)}
              >
                <strong>{item.name}</strong>
                <span>{item.id}</span>
              </button>
            ))}
          </aside>
          {selected ? (
            <section className="panel">
              <div className="admin-record-heading">
                <div>
                  <h4>{selected.name}</h4>
                  <span
                    className="status-badge"
                    data-status={selected.status === 'enabled' ? 'success' : 'warning'}
                  >
                    {selected.status === 'enabled' ? '启用中' : '已停用'}
                  </span>
                </div>
                <button type="button" disabled={busy} onClick={() => void toggleModule()}>
                  {selected.status === 'enabled' ? '停用' : '启用'} {selected.name}
                </button>
              </div>
              <label>
                模块内部 key（只读）
                <input readOnly value={selected.id} />
              </label>
              <div className="admin-form-grid">
                <label>
                  负责人类型
                  <select
                    value={ownerType}
                    onChange={(event) =>
                      setOwnerType(event.currentTarget.value as ModuleOwnerInput['ownerType'])
                    }
                  >
                    <option value="role">角色</option>
                    <option value="subject">用户 UID</option>
                    <option value="team">代表队</option>
                  </select>
                </label>
                <label>
                  负责人标识
                  <input
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.currentTarget.value)}
                  />
                </label>
              </div>
              <button type="button" className="secondary-button" onClick={addOwner}>
                添加负责人
              </button>
              {owners.length ? (
                <ul className="record-list responsive-record-list">
                  {owners.map((owner, index) => (
                    <li key={`${owner.ownerType}:${owner.ownerId}`} className="record-card">
                      <div>
                        <strong>{owner.ownerId}</strong>
                        <p>{owner.ownerType}</p>
                      </div>
                      <button
                        type="button"
                        className="danger-button"
                        aria-label={`移除负责人 ${owner.ownerId}`}
                        onClick={() =>
                          setOwners((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="record-list-state">当前没有负责人。</p>
              )}
              <button type="button" disabled={busy} onClick={() => void saveOwners()}>
                保存负责人
              </button>
            </section>
          ) : null}
        </div>
      </SectionState>
    </section>
  );
}
