import { useEffect, useState } from 'react';
import type {
  DevelopmentBusinessAdminBootstrapInput,
  DevelopmentBusinessAdminBootstrapResult,
  DevelopmentBusinessAdminBootstrapStatus,
} from '@freebbs-development/contracts';
import type { ApiClient } from '../../../core/api/client.js';
import { useOptionalAuth } from '../../../core/auth/AuthProvider.js';
import { isSuperAdmin } from '../../../core/permissions/Can.js';
import './FirstBusinessAdminSection.css';

interface Candidate {
  uid: string;
  username: string;
  displayName: string;
  accessLevel: 'member' | 'lead' | null;
}

export function FirstBusinessAdminSection({
  client,
  users,
  onInitialized,
}: {
  client: Pick<ApiClient, 'request'>;
  users: Candidate[];
  onInitialized: (message: string) => void;
}) {
  const auth = useOptionalAuth();
  const qualified = Boolean(auth?.user && isSuperAdmin(auth.user));
  const actorUid = auth?.user?.uid;
  const [status, setStatus] = useState<DevelopmentBusinessAdminBootstrapStatus | null>(null);
  const [uid, setUid] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus(null);
    setError('');
    setUid('');
    setReason('');
    if (qualified) {
      client
        .request<DevelopmentBusinessAdminBootstrapStatus>('/admin/business-admin-bootstrap')
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch((caught: unknown) => {
          if (active) setError(caught instanceof Error ? caught.message : '首次任命状态加载失败');
        });
    }
    return () => {
      active = false;
    };
  }, [client, qualified, actorUid, attempt]);
  const selected = users.find((user) => user.uid === uid && user.accessLevel !== null);
  async function initialize() {
    if (!selected || !status?.canInitialize || status.globalAdminCount !== 0 || saving) return;
    setSaving(true);
    setError('');
    try {
      const input: DevelopmentBusinessAdminBootstrapInput = {
        uid,
        reason: reason.trim() || undefined,
      };
      await client.request<DevelopmentBusinessAdminBootstrapResult>(
        '/admin/business-admin-bootstrap',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
      setStatus({ canInitialize: false, globalAdminCount: 1 });
      onInitialized(`已任命 ${selected.displayName || selected.username} 为首位平台管理员`);
      await auth?.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '首位平台管理员任命失败');
    } finally {
      setSaving(false);
    }
  }
  if (!qualified) return null;
  if (!status) {
    return error ? (
      <div className="development-settings-message is-error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => setAttempt(attempt + 1)}>
          重试首次任命检查
        </button>
      </div>
    ) : null;
  }
  if (!status.canInitialize || status.globalAdminCount !== 0) return null;
  return (
    <section
      className="identity-access-card first-business-admin-section"
      aria-labelledby="first-business-admin-title"
    >
      <div>
        <h3 id="first-business-admin-title">设置首位平台管理员</h3>
        <p>
          平台尚无有效的全局管理员。选择一位已有发展端访问资格的用户，确认后可在系统设置中维护社工身份。
        </p>
      </div>
      <div className="first-business-admin-fields">
        <label>
          首位平台管理员
          <select value={uid} disabled={saving} onChange={(event) => setUid(event.target.value)}>
            <option value="">请选择用户</option>
            {users
              .filter((user) => user.accessLevel !== null)
              .map((user) => (
                <option key={user.uid} value={user.uid}>
                  {user.displayName || user.username} · {user.uid}
                </option>
              ))}
          </select>
        </label>
        <label>
          任命说明
          <input
            value={reason}
            maxLength={200}
            disabled={saving}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </div>
      {error ? (
        <p className="development-settings-message is-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" disabled={!selected || saving} onClick={() => void initialize()}>
        {saving ? '任命中…' : '任命首位平台管理员'}
      </button>
    </section>
  );
}
