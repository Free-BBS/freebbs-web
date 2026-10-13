import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { DevelopmentApi, SportsTeamRecord } from './SportsPage.js';
import './sports-maintenance.css';

export function SportsCardForm({
  client,
  team,
  onSaved,
  onCancel,
}: {
  client: DevelopmentApi;
  team?: SportsTeamRecord;
  onSaved: (team: SportsTeamRecord) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [season, setSeason] = useState(team?.season ?? '');
  const [trainingSchedule, setTrainingSchedule] = useState(team?.trainingSchedule ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const context = useMemo(() => ({ client, teamId: team?.id }), [client, team?.id]);
  const currentContext = useRef(context);
  currentContext.current = context;
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    setBusy(false);
    setError('');
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [context]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current !== null) return;
    const controller = new AbortController();
    pending.current = controller;
    const isCurrent = () =>
      currentContext.current === context &&
      pending.current === controller &&
      !controller.signal.aborted;
    setBusy(true);
    setError('');
    try {
      const saved = await client.request<SportsTeamRecord>('/sports/teams', {
        method: team ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          ...(team ? { id: team.id } : {}),
          name: name.trim(),
          description: description.trim(),
          season: season.trim(),
          trainingSchedule: trainingSchedule.trim(),
        }),
      });
      if (isCurrent()) onSaved(saved);
    } catch (caught) {
      if (isCurrent())
        setError(`${caught instanceof Error ? caught.message : '保存失败'}；输入已保留`);
    } finally {
      if (isCurrent()) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <form
      className="sports-card-form"
      aria-label={team ? '编辑队伍信息' : '添加代表队'}
      onSubmit={(event) => void submit(event)}
    >
      <p>{team ? '更新公开名片信息。' : '填写队伍名片，创建后可上传首页并启用队伍。'}</p>
      {error && <p role="alert">{error}</p>}
      <label>
        队伍名称
        <input
          required
          maxLength={200}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <label>
        公开简介
        <textarea
          required
          maxLength={20000}
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </label>
      <label>
        赛季
        <input
          maxLength={80}
          value={season}
          onChange={(event) => setSeason(event.currentTarget.value)}
          placeholder="例如：2026 秋季"
        />
      </label>
      <label>
        训练或比赛安排
        <textarea
          maxLength={500}
          value={trainingSchedule}
          onChange={(event) => setTrainingSchedule(event.currentTarget.value)}
          placeholder="时间、地点与加入方式"
        />
      </label>
      <div className="sports-maintenance-actions">
        <button type="submit" disabled={busy}>
          {team ? '保存队伍信息' : '创建代表队'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
