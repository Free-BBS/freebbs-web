import { useState, type FormEvent } from 'react';

import { DetailSection } from '../../components/DetailSection.js';
import { StatusBadge } from '../../components/StatusBadge.js';
import type { LiaisonOutcome, LiaisonTeam } from './model.js';

export interface OutcomeInput {
  teamId: string;
  title: string;
  description: string;
  linkUrl: string | null;
  attachmentRef: string | null;
}

export interface OutcomePanelProps {
  outcomes: readonly LiaisonOutcome[];
  teams: readonly LiaisonTeam[];
  currentUid: string;
  canSubmit: (team: LiaisonTeam) => boolean;
  canManage: (outcome: LiaisonOutcome) => boolean;
  pending: boolean;
  onSubmit: (input: OutcomeInput) => Promise<boolean>;
  onAdopt: (outcomeId: string) => Promise<void>;
}

export function OutcomePanel({
  outcomes,
  teams,
  currentUid,
  canSubmit,
  canManage,
  pending,
  onSubmit,
  onAdopt,
}: OutcomePanelProps) {
  const memberTeams = teams.filter(
    (team) =>
      canSubmit(team) &&
      team.members.some((member) => member.memberUid === currentUid && member.status === 'active'),
  );
  const [teamId, setTeamId] = useState(memberTeams[0]?.id ?? '');
  const selectedTeamId = teamId || memberTeams[0]?.id || '';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTeamId || !title.trim() || !description.trim()) {
      setError('请选择团队并填写成果标题与说明');
      return;
    }
    if (linkUrl && !URL.canParse(linkUrl)) {
      setError('请输入有效的成果链接');
      return;
    }
    setError(null);
    const saved = await onSubmit({
      teamId: selectedTeamId,
      title: title.trim(),
      description: description.trim(),
      linkUrl: linkUrl.trim() || null,
      attachmentRef: null,
    });
    if (saved) {
      setTitle('');
      setDescription('');
      setLinkUrl('');
    }
  }

  return (
    <DetailSection
      title="成果版本"
      description="各团队可以持续提交版本；成果被采纳后课题仍可继续开放。"
    >
      {outcomes.length === 0 ? (
        <p>暂无成果版本。</p>
      ) : (
        <ul className="liaison-outcome-list" aria-label="课题成果版本">
          {outcomes.map((outcome) => (
            <li key={outcome.id}>
              <header>
                <div>
                  <strong>{outcome.title}</strong>
                  <span>
                    第 {outcome.version} 版 ·{' '}
                    {teams.find(({ id }) => id === outcome.teamId)?.name ?? '参与团队'}
                  </span>
                </div>
                <StatusBadge status={outcome.status === 'adopted' ? 'success' : 'neutral'}>
                  {outcome.status === 'adopted' ? '已采纳' : '已提交'}
                </StatusBadge>
              </header>
              <p>{outcome.description}</p>
              {outcome.linkUrl ? (
                <a href={outcome.linkUrl} target="_blank" rel="noreferrer">
                  查看成果链接
                </a>
              ) : null}
              {canManage(outcome) && outcome.status === 'submitted' ? (
                <button type="button" disabled={pending} onClick={() => void onAdopt(outcome.id)}>
                  标记为已采纳
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {memberTeams.length > 0 ? (
        <form onSubmit={submit} noValidate>
          <h4>提交成果版本</h4>
          <label>
            所属团队
            <select value={selectedTeamId} onChange={(event) => setTeamId(event.target.value)}>
              {memberTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            成果标题
            <input
              value={title}
              maxLength={255}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            成果说明
            <textarea
              value={description}
              maxLength={20000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            成果链接（可选）
            <input
              type="url"
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
            />
          </label>
          <button type="submit" disabled={pending}>
            提交新版本
          </button>
          {error ? <p role="alert">{error}</p> : null}
        </form>
      ) : null}
    </DetailSection>
  );
}
