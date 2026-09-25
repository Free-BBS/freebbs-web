import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { Link } from 'react-router-dom';

import { createApiClient } from '../../core/api/client.js';
import { useOptionalAuth } from '../../core/auth/AuthProvider.js';
import {
  permitted,
  statusLabels,
  type DevelopmentApi,
  type SportsPageProps,
  type SportsTeamRecord,
  type SportsTeamStatus,
  type SportsUser,
} from './SportsPage.js';
import { TeamShowcase } from './TeamShowcase.js';

interface SportsTeamMemberRecord {
  id: string;
  teamId?: string;
  memberUid: string;
  isCaptain: boolean;
}

interface SportsCheckinRecord {
  id: string;
  memberUid: string;
  checkinDate: string;
}

type RosterImportOutcome = 'ready' | 'already_member' | 'duplicate_in_file' | 'name_mismatch';
interface RosterPreviewRow {
  row: number;
  name: string;
  studentNumber: string;
  outcome: RosterImportOutcome;
  blocking: boolean;
}
interface RosterImportResult {
  imported: number;
  skipped: number;
  rows: RosterPreviewRow[];
}

export interface SportsTeamDetailPageProps extends Pick<SportsPageProps, 'client' | 'user'> {
  teamId: string;
}

const rosterOutcomeLabels: Record<RosterImportOutcome, string> = {
  ready: '可导入',
  already_member: '已在队伍中',
  duplicate_in_file: '文件内学号重复',
  name_mismatch: '姓名与现有账号不一致',
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '未知错误';
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('CSV 文件无法读取'));
    });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('CSV 文件无法读取')));
    reader.readAsText(file, 'utf-8');
  });
}

function TeamSummary({ team }: { team: SportsTeamRecord }) {
  return (
    <header className="page-section-header">
      <div>
        <p className="eyebrow">代表队详情</p>
        <h2 id="sports-team-detail-title">{team.name}</h2>
        <p>{team.description}</p>
      </div>
      <span className="status-badge" data-status={team.status === 'active' ? 'success' : 'warning'}>
        {statusLabels[team.status]}
      </span>
      <dl className="module-meta-list">
        <div>
          <dt>赛季</dt>
          <dd>{team.season || '待补充'}</dd>
        </div>
        <div>
          <dt>训练或比赛安排</dt>
          <dd>{team.trainingSchedule || '待发布'}</dd>
        </div>
      </dl>
    </header>
  );
}

function RosterImport({
  client,
  disabled,
  onFeedback,
  onImported,
  teamId,
}: {
  client: DevelopmentApi;
  disabled: boolean;
  onFeedback: (message: string) => void;
  onImported: () => Promise<void>;
  teamId: string;
}) {
  const [preview, setPreview] = useState<RosterPreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function previewFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file === undefined) return;
    setBusy(true);
    setPreview(null);
    try {
      const csv = await readTextFile(file);
      setPreview(
        await client.request<RosterPreviewRow[]>(
          `/sports/teams/${encodeURIComponent(teamId)}/roster-import/preview`,
          { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv },
        ),
      );
    } catch (error) {
      onFeedback(`名单预览失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (preview === null || preview.length === 0 || preview.some((row) => row.blocking)) return;
    setBusy(true);
    try {
      const rows = preview.map(({ row, name, studentNumber, outcome }) => ({
        row,
        name,
        studentNumber,
        outcome,
      }));
      const result = await client.request<RosterImportResult>(
        `/sports/teams/${encodeURIComponent(teamId)}/roster-import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows }),
        },
      );
      setPreview(null);
      await onImported();
      onFeedback(`名单导入完成：新增 ${result.imported} 人，跳过 ${result.skipped} 人`);
    } catch (error) {
      onFeedback(`名单导入失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const hasBlockingRows = preview?.some((row) => row.blocking) ?? false;
  return (
    <section aria-labelledby="sports-roster-import-title">
      <h3 id="sports-roster-import-title">批量导入名单</h3>
      <p>仅支持两列且表头为“姓名,学号”。先预览校验结果，再确认写入；预览不会修改服务端数据。</p>
      <label>
        选择名单 CSV（姓名,学号）
        <input
          accept=".csv,text/csv"
          disabled={disabled || busy}
          type="file"
          onChange={(event) => void previewFile(event)}
        />
      </label>
      {preview !== null && (
        <>
          <table aria-label="名单预览">
            <thead>
              <tr>
                <th>行</th>
                <th>姓名</th>
                <th>学号</th>
                <th>校验结果</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={`${row.row}-${row.studentNumber}`}>
                  <td>{row.row}</td>
                  <td>{row.name}</td>
                  <td>{row.studentNumber}</td>
                  <td>{rosterOutcomeLabels[row.outcome]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            disabled={disabled || busy || preview.length === 0 || hasBlockingRows}
            onClick={() => void confirmImport()}
          >
            确认导入
          </button>
        </>
      )}
    </section>
  );
}

function TeamOperations({
  canCreateCheckins,
  canReadCheckins,
  client,
  initialTeam,
  onFeedback,
  onTeamUpdated,
}: {
  canCreateCheckins: boolean;
  canReadCheckins: boolean;
  client: DevelopmentApi;
  initialTeam: SportsTeamRecord;
  onFeedback: (message: string) => void;
  onTeamUpdated: (team: SportsTeamRecord) => void;
}) {
  const [team, setTeam] = useState(initialTeam);
  const [members, setMembers] = useState<SportsTeamMemberRecord[] | null>(null);
  const [checkins, setCheckins] = useState<SportsCheckinRecord[] | null>(null);
  const [memberUid, setMemberUid] = useState('');
  const [checkinDate, setCheckinDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialTeam.name);
  const [description, setDescription] = useState(initialTeam.description);
  const [season, setSeason] = useState(initialTeam.season);
  const [trainingSchedule, setTrainingSchedule] = useState(initialTeam.trainingSchedule);

  const loadMembers = useCallback(async () => {
    setMembers(
      await client.request<SportsTeamMemberRecord[]>(
        `/sports/teams/${encodeURIComponent(team.id)}/members`,
      ),
    );
  }, [client, team.id]);
  const loadCheckins = useCallback(async () => {
    setCheckins(
      await client.request<SportsCheckinRecord[]>(
        `/sports/teams/${encodeURIComponent(team.id)}/checkins`,
      ),
    );
  }, [client, team.id]);

  useEffect(() => {
    void loadMembers().catch((error) => onFeedback(`成员加载失败：${errorMessage(error)}`));
  }, [loadMembers, onFeedback]);
  useEffect(() => {
    if (!canReadCheckins) return;
    void loadCheckins().catch((error) => onFeedback(`签到加载失败：${errorMessage(error)}`));
  }, [canReadCheckins, loadCheckins, onFeedback]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memberUid.trim()) return;
    setBusy(true);
    try {
      await client.request(`/sports/teams/${encodeURIComponent(team.id)}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberUid: memberUid.trim() }),
      });
      setMemberUid('');
      await loadMembers();
      onFeedback('成员已添加');
    } catch (error) {
      onFeedback(`成员添加失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function changeMember(
    member: SportsTeamMemberRecord,
    action: 'grant' | 'revoke' | 'remove',
  ) {
    setBusy(true);
    try {
      const root = `/sports/teams/${encodeURIComponent(team.id)}`;
      if (action === 'grant')
        await client.request(`${root}/captains`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberUid: member.memberUid }),
        });
      if (action === 'revoke')
        await client.request(`${root}/captains/${encodeURIComponent(member.memberUid)}`, {
          method: 'DELETE',
        });
      if (action === 'remove')
        await client.request(`${root}/members/${encodeURIComponent(member.memberUid)}`, {
          method: 'DELETE',
        });
      await loadMembers();
      onFeedback(
        action === 'grant'
          ? '队长权限已授予'
          : action === 'revoke'
            ? '队长权限已撤销'
            : '成员已移除',
      );
    } catch (error) {
      onFeedback(`成员操作失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function transition(to: SportsTeamStatus) {
    setBusy(true);
    try {
      const updated = await client.request<SportsTeamRecord>(
        `/sports/teams/${encodeURIComponent(team.id)}/transitions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to }),
        },
      );
      setTeam(updated);
      onTeamUpdated(updated);
      onFeedback(to === 'active' ? '队伍已启用' : '队伍已归档');
    } catch (error) {
      onFeedback(`状态更新失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !description.trim()) {
      onFeedback('队伍名称和简介不能为空');
      return;
    }
    setBusy(true);
    try {
      const updated = await client.request<SportsTeamRecord>('/sports/teams', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: team.id,
          name: name.trim(),
          description: description.trim(),
          season: season.trim(),
          trainingSchedule: trainingSchedule.trim(),
        }),
      });
      setTeam(updated);
      onTeamUpdated(updated);
      setEditing(false);
      onFeedback('队伍信息已更新');
    } catch (error) {
      onFeedback(`保存失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function createCheckin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memberUid.trim() || !checkinDate) return;
    setBusy(true);
    try {
      await client.request(`/sports/teams/${encodeURIComponent(team.id)}/checkins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberUid: memberUid.trim(), checkinDate }),
      });
      if (canReadCheckins) await loadCheckins();
      onFeedback('签到已记录');
    } catch (error) {
      onFeedback(`签到记录失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const writable = team.status !== 'archived';
  return (
    <>
      <section aria-labelledby="sports-team-edit-title">
        <h3 id="sports-team-edit-title">队伍资料</h3>
        {!editing ? (
          <button type="button" disabled={busy} onClick={() => setEditing(true)}>
            编辑队伍信息
          </button>
        ) : (
          <form aria-label="编辑队伍信息" onSubmit={(event) => void saveTeam(event)}>
            <label>
              队伍名称
              <input
                required
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <label>
              公开简介
              <textarea
                required
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
            </label>
            <label>
              赛季
              <input value={season} onChange={(event) => setSeason(event.currentTarget.value)} />
            </label>
            <label>
              训练或比赛安排
              <textarea
                value={trainingSchedule}
                onChange={(event) => setTrainingSchedule(event.currentTarget.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              保存队伍信息
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>
              取消编辑
            </button>
          </form>
        )}
      </section>
      <section aria-labelledby="sports-members-title">
        <h3 id="sports-members-title">队员与队长</h3>
        {writable && (
          <form aria-label="添加成员" onSubmit={(event) => void addMember(event)}>
            <label>
              成员 UID
              <input
                required
                value={memberUid}
                onChange={(event) => setMemberUid(event.currentTarget.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              添加成员
            </button>
          </form>
        )}
        {members === null ? (
          <p role="status">正在加载成员…</p>
        ) : members.length === 0 ? (
          <p>暂无成员</p>
        ) : (
          <ul aria-label="队员列表">
            {members.map((member) => (
              <li key={member.id}>
                {member.memberUid}
                {member.isCaptain ? '（队长）' : ''}
                {writable &&
                  (member.isCaptain ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void changeMember(member, 'revoke')}
                    >
                      撤销队长
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void changeMember(member, 'grant')}
                      >
                        授予队长
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void changeMember(member, 'remove')}
                      >
                        移除成员
                      </button>
                    </>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>
      <RosterImport
        client={client}
        disabled={!writable}
        onFeedback={onFeedback}
        onImported={loadMembers}
        teamId={team.id}
      />
      {(canReadCheckins || canCreateCheckins) && (
        <section aria-labelledby="sports-checkins-title">
          <h3 id="sports-checkins-title">训练签到</h3>
          {canCreateCheckins && team.status === 'active' && (
            <form aria-label="训练签到" onSubmit={(event) => void createCheckin(event)}>
              <label>
                成员 UID
                <input
                  required
                  value={memberUid}
                  onChange={(event) => setMemberUid(event.currentTarget.value)}
                />
              </label>
              <label>
                签到日期
                <input
                  required
                  type="date"
                  value={checkinDate}
                  onChange={(event) => setCheckinDate(event.currentTarget.value)}
                />
              </label>
              <button type="submit" disabled={busy}>
                记录签到
              </button>
            </form>
          )}
          {canReadCheckins &&
            (checkins === null ? (
              <p role="status">正在加载签到记录…</p>
            ) : checkins.length === 0 ? (
              <p>暂无签到记录</p>
            ) : (
              <ul aria-label="签到记录">
                {checkins.map((checkin) => (
                  <li key={checkin.id}>
                    {checkin.memberUid}：{checkin.checkinDate}
                  </li>
                ))}
              </ul>
            ))}
        </section>
      )}
      <section aria-label="队伍状态">
        <h3>队伍状态</h3>
        {team.status === 'draft' && (
          <button type="button" disabled={busy} onClick={() => void transition('active')}>
            启用队伍
          </button>
        )}
        {team.status === 'active' && (
          <button type="button" disabled={busy} onClick={() => void transition('archived')}>
            归档队伍
          </button>
        )}
        {team.status === 'archived' && (
          <button type="button" disabled={busy} onClick={() => void transition('active')}>
            恢复队伍
          </button>
        )}
      </section>
    </>
  );
}

function CaptainCheckins({
  canCreate,
  canRead,
  client,
  team,
}: {
  canCreate: boolean;
  canRead: boolean;
  client: DevelopmentApi;
  team: SportsTeamRecord;
}) {
  const [checkins, setCheckins] = useState<SportsCheckinRecord[] | null>(null);
  const [memberUid, setMemberUid] = useState('');
  const [checkinDate, setCheckinDate] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(
    async () =>
      setCheckins(
        await client.request<SportsCheckinRecord[]>(
          `/sports/teams/${encodeURIComponent(team.id)}/checkins`,
        ),
      ),
    [client, team.id],
  );
  useEffect(() => {
    if (!canRead) return;
    void load().catch((error) => setMessage(`签到加载失败：${errorMessage(error)}`));
  }, [canRead, load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await client.request(`/sports/teams/${encodeURIComponent(team.id)}/checkins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberUid: memberUid.trim(), checkinDate }),
      });
      if (canRead) await load();
      setMessage('签到已记录');
    } catch (error) {
      setMessage(`签到记录失败：${errorMessage(error)}`);
    }
  }
  return (
    <section aria-labelledby="sports-checkins-title">
      <h3 id="sports-checkins-title">训练签到</h3>
      {canCreate && team.status === 'active' && (
        <form aria-label="训练签到" onSubmit={(event) => void submit(event)}>
          <label>
            成员 UID
            <input
              required
              value={memberUid}
              onChange={(event) => setMemberUid(event.currentTarget.value)}
            />
          </label>
          <label>
            签到日期
            <input
              required
              type="date"
              value={checkinDate}
              onChange={(event) => setCheckinDate(event.currentTarget.value)}
            />
          </label>
          <button type="submit">记录签到</button>
        </form>
      )}
      {message !== null && <p role="status">{message}</p>}
      {canRead &&
        (checkins === null ? (
          <p role="status">正在加载签到记录…</p>
        ) : checkins.length === 0 ? (
          <p>暂无签到记录</p>
        ) : (
          <ul aria-label="签到记录">
            {checkins.map((checkin) => (
              <li key={checkin.id}>
                {checkin.memberUid}：{checkin.checkinDate}
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

export function SportsTeamDetailPage({
  client,
  teamId,
  user: suppliedUser,
}: SportsTeamDetailPageProps) {
  const defaultClient = useMemo(createApiClient, []);
  const auth = useOptionalAuth();
  const activeClient = client ?? auth?.client ?? defaultClient;
  const user =
    suppliedUser === undefined ? ((auth?.user as SportsUser | null) ?? null) : suppliedUser;
  const [team, setTeam] = useState<SportsTeamRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const actorUid = user?.uid ?? '';

  const loadTeam = useCallback(async () => {
    const version = ++loadVersion.current;
    setError(null);
    setTeam(null);
    try {
      const teams = await activeClient.request<SportsTeamRecord[]>('/sports/teams');
      const found = teams.find((candidate) => candidate.id === teamId) ?? null;
      if (version !== loadVersion.current) return;
      if (found === null) setError('未找到该代表队，或你没有访问权限。');
      setTeam(found);
    } catch (caught) {
      if (version !== loadVersion.current) return;
      setError(`代表队加载失败：${errorMessage(caught)}`);
    }
  }, [activeClient, actorUid, teamId]);
  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  if (team === null)
    return (
      <section className="module-page" aria-labelledby="sports-team-detail-title">
        <Link to="/sports">← 返回代表队</Link>
        <h2 id="sports-team-detail-title">代表队详情</h2>
        {error === null ? <p role="status">正在加载代表队…</p> : <p role="alert">{error}</p>}
      </section>
    );

  const canManage = permitted(user, 'sports.team.update', 'sports_team', team.scope);
  const canReadCheckins = permitted(user, 'sports.checkin.read', 'sports_checkin', team.scope);
  const canCreateCheckins = permitted(user, 'sports.checkin.create', 'sports_checkin', team.scope);
  const canReadShowcase = permitted(user, 'sports.showcase.read', 'sports_showcase', team.scope);
  const canEditShowcase = permitted(user, 'sports.showcase.update', 'sports_showcase', team.scope);
  return (
    <section className="module-page" aria-labelledby="sports-team-detail-title">
      <Link className="text-link" to="/sports">
        ← 返回代表队
      </Link>
      <TeamSummary team={team} />
      {(canReadShowcase || canEditShowcase) && (
        <TeamShowcase client={activeClient} teamId={team.id} canEdit={canEditShowcase} />
      )}
      {feedback !== null && <p role="status">{feedback}</p>}
      {canManage ? (
        <TeamOperations
          key={team.id}
          canCreateCheckins={canCreateCheckins}
          canReadCheckins={canReadCheckins}
          client={activeClient}
          initialTeam={team}
          onFeedback={setFeedback}
          onTeamUpdated={setTeam}
        />
      ) : canReadCheckins || canCreateCheckins ? (
        <CaptainCheckins
          canCreate={canCreateCheckins}
          canRead={canReadCheckins}
          client={activeClient}
          team={team}
        />
      ) : (
        <p>你可以查看队伍公开信息；维护权限由队伍负责人按具体代表队授予。</p>
      )}
    </section>
  );
}
