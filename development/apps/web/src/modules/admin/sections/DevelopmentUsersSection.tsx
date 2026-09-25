import { ROLE_KEYS, type RoleKey } from '@freebbs-development/contracts';
import { useCallback, useEffect, useState } from 'react';

import { useOptionalAuth } from '../../../core/auth/AuthProvider.js';
import type { ApiClient } from '../../../core/api/client.js';

interface DevelopmentDirectoryUser {
  uid: string;
  username: string;
  displayName: string;
  studentId: string | null;
  avatarUrl: string | null;
  accessLevel: 'member' | 'lead' | null;
  roles: RoleKey[];
  captainTeamIds: string[];
}

const roleLabels: Readonly<Record<RoleKey, string>> = {
  'platform.super_admin': '发展端负责人',
  'domain.arts_lead': '文艺中心负责人',
  'domain.sports_lead': '体育中心负责人',
  'domain.liaison_lead': '联络中心负责人',
  'domain.rights_development_lead': '权发中心负责人',
  'department.arts_director': '文艺中心部长',
  'department.sports_director': '体育中心部长',
  'department.liaison_director': '联络中心部长',
  'department.rights_development_director': '权发中心部长',
  'department.arts_member': '文艺中心部员',
  'department.sports_member': '体育中心部员',
  'department.liaison_member': '联络中心部员',
  'department.rights_development_member': '权发中心部员',
  'affiliation.tuanwei_member': '团委部员',
  'affiliation.sast_member': '科协部员',
  'affiliation.tuanwei_director': '团委部长',
  'affiliation.tuanwei_lead': '团委负责人',
  'affiliation.sast_director': '科协部长',
  'affiliation.sast_lead': '科协负责人',
  'affiliation.tms_member': '媒体中心部员',
  'affiliation.tms_director': '媒体中心部长',
  'affiliation.tms_lead': '媒体中心负责人',
};

const assignableRoles = ROLE_KEYS.filter((key) => key !== 'platform.super_admin');

export function DevelopmentUsersSection({ client }: { client: Pick<ApiClient, 'request'> }) {
  const auth = useOptionalAuth();
  const [users, setUsers] = useState<DevelopmentDirectoryUser[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const suffix = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : '';
      setUsers(
        await client.request<DevelopmentDirectoryUser[]>(`/admin/development-users${suffix}`),
      );
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '用户名单加载失败');
    } finally {
      setLoading(false);
    }
  }, [client, query]);

  useEffect(() => void load(), [load]);

  function patch(uid: string, change: Partial<DevelopmentDirectoryUser>) {
    setUsers((current) =>
      current.map((user) => (user.uid === uid ? { ...user, ...change } : user)),
    );
  }

  async function save(user: DevelopmentDirectoryUser) {
    setBusyUid(user.uid);
    setMessage('');
    try {
      await client.request(`/admin/development-users/${encodeURIComponent(user.uid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessLevel: user.accessLevel,
          roles: user.roles,
          captainTeamIds: user.captainTeamIds,
        }),
      });
      setMessage(`已保存 ${user.username} 的发展端权限`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '权限保存失败');
    } finally {
      setBusyUid('');
    }
  }

  return (
    <section className="development-user-settings" aria-labelledby="development-users-title">
      <div className="development-settings-intro">
        <div>
          <p className="section-kicker">DEVELOPMENT ACCESS</p>
          <h2 id="development-users-title">发展端用户名单</h2>
          <p>白名单和身份只影响发展端；学习端权限保持不变。</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <label>
            <span className="sr-only">搜索用户名、学号或 UID</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索用户名、学号或 UID"
            />
          </label>
          <button type="submit">搜索</button>
        </form>
      </div>

      {message ? (
        <p className="development-settings-message" role="status">
          {message}
        </p>
      ) : null}
      {loading ? <p>正在读取主站用户名单…</p> : null}
      <div className="development-user-list">
        {users.map((user) => (
          <article className="development-user-card" key={user.uid}>
            <header>
              <div>
                <strong>{user.username}</strong>
                <span>
                  {user.studentId ?? '无学号'} · {user.uid}
                </span>
              </div>
              <button
                type="button"
                className="preview-user-button"
                disabled={!auth}
                onClick={() => auth?.setPreviewUser(user.uid)}
              >
                以此身份预览
              </button>
            </header>

            <label className="development-access-field">
              <span>发展端访问</span>
              <select
                value={user.accessLevel ?? 'none'}
                onChange={(event) =>
                  patch(user.uid, {
                    accessLevel:
                      event.target.value === 'none'
                        ? null
                        : (event.target.value as 'member' | 'lead'),
                  })
                }
              >
                <option value="none">不在白名单</option>
                <option value="member">可访问</option>
                <option value="lead">发展端负责人</option>
              </select>
            </label>

            <fieldset>
              <legend>身份权限</legend>
              <div className="development-role-grid">
                {assignableRoles.map((role) => (
                  <label key={role}>
                    <input
                      type="checkbox"
                      checked={user.roles.includes(role)}
                      onChange={(event) =>
                        patch(user.uid, {
                          roles: event.target.checked
                            ? [...new Set([...user.roles, role])]
                            : user.roles.filter((item) => item !== role),
                        })
                      }
                    />
                    <span>{roleLabels[role]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="development-access-field">
              <span>代表队队长范围</span>
              <input
                value={user.captainTeamIds.join(', ')}
                onChange={(event) =>
                  patch(user.uid, {
                    captainTeamIds: event.target.value
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="队伍 ID，多个用逗号分隔"
              />
            </label>

            <footer>
              <button type="button" disabled={busyUid === user.uid} onClick={() => void save(user)}>
                {busyUid === user.uid ? '保存中…' : '保存权限'}
              </button>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
