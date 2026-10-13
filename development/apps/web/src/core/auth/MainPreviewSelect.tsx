import type { SystemSettingsUser } from '@freebbs-development/contracts';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider.js';

export function MainPreviewSelect() {
  const auth = useAuth();
  const navigate = useNavigate();
  const allowed = auth.authMode === 'main' && auth.user?.viewer?.canPreviewDevelopment === true;
  const previewing = auth.user?.previewing === true;
  const [users, setUsers] = useState<SystemSettingsUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!allowed || previewing) return;
    let active = true;
    setLoading(true);
    setError('');
    setUsers([]);
    auth.client
      .request<SystemSettingsUser[]>('/system-settings/users')
      .then((next) => {
        if (active) setUsers(next);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '预览名单加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [allowed, previewing, auth.client, attempt]);
  if (!allowed) return null;
  if (previewing)
    return (
      <div className="main-preview-controls">
        <span>只读身份预览</span>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            auth.setPreviewUser(null);
            navigate('/system-settings');
          }}
        >
          返回实际身份
        </button>
      </div>
    );
  return (
    <div className="main-preview-controls">
      <label className="demo-switcher">
        <span>只读身份预览</span>
        <select
          aria-label="预览发展端身份"
          disabled={loading || Boolean(error)}
          value=""
          onChange={(event) => {
            if (!event.currentTarget.value) return;
            auth.setPreviewUser(event.currentTarget.value);
            navigate('/community');
          }}
        >
          <option value="">{loading ? '正在读取名单…' : '我的实际身份'}</option>
          {users.map((user) => (
            <option
              value={user.uid}
              key={user.uid}
              disabled={user.canReceiveNotifications === false}
            >
              {user.username} · {user.displayName}
              {user.canReceiveNotifications === false ? '（未开放发展端）' : ''}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <div role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setAttempt(attempt + 1)}
          >
            重新加载预览名单
          </button>
        </div>
      ) : null}
    </div>
  );
}
