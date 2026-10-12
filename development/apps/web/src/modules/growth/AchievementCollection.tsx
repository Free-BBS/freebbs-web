import { useEffect, useId, useRef, useState } from 'react';
import type { GrowthAchievement, GrowthAchievementSeries } from '@freebbs-development/contracts';
import { DetailSection } from '../../components/DetailSection.js';
import { AchievementMark } from './AchievementMark.js';

const SERIES: { key: GrowthAchievementSeries; label: string; unit: string }[] = [
  { key: 'milestone', label: '成长里程', unit: '次报名记录' },
  { key: 'specialty', label: '领域专长', unit: '次领域报名记录' },
  { key: 'diversity', label: '跨界探索', unit: '个已知领域' },
  { key: 'rhythm', label: '成长节奏', unit: '个不同月份' },
];

function seriesFor(badge: GrowthAchievement): GrowthAchievementSeries {
  return badge.series ?? (badge.id === 'multi-domain' ? 'diversity' : 'milestone');
}
function progress(badge: GrowthAchievement) {
  return Math.max(0, Math.min(badge.progress, badge.target));
}

function AchievementDetail({
  badge,
  selected,
  onClose,
  onSelect,
}: {
  badge: GrowthAchievement;
  selected: boolean;
  onClose(): void;
  onSelect(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    closeRef.current?.focus();
    return () => {
      if (typeof dialog.close === 'function') dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const series = SERIES.find((entry) => entry.key === seriesFor(badge))!;
  return (
    <dialog
      ref={dialogRef}
      className={`growth-achievement-dialog ${badge.unlocked ? 'is-unlocked' : 'is-locked'}`}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="growth-dialog-content">
        <button
          ref={closeRef}
          type="button"
          className="growth-dialog-close growth-button"
          aria-label="关闭成就详情"
          onClick={onClose}
        >
          关闭
        </button>
        <AchievementMark achievement={badge} />
        <p className="growth-series-label">
          {series.label} · {badge.unlocked ? '已解锁' : '待解锁'}
        </p>
        <h3 id={titleId}>{badge.title}</h3>
        <p id={descriptionId}>{badge.description}</p>
        <div className="growth-detail-progress">
          <span>当前进度</span>
          <strong>
            {progress(badge)} / {badge.target}
          </strong>
        </div>
        <progress
          aria-label={`${badge.title}进度`}
          value={progress(badge)}
          max={Math.max(1, badge.target)}
        />
        <p className="growth-detail-note">
          已有 {badge.progress} {series.unit}。依据已结束且未取消的报名记录，不代表实际到场核验。
        </p>
        <button
          type="button"
          className="growth-button growth-title-action"
          disabled={!badge.unlocked || selected}
          onClick={onSelect}
        >
          {!badge.unlocked ? '解锁后可展示' : selected ? '正在展示此称号' : '设为展示称号'}
        </button>
        <p className="growth-detail-note">仅作为本设备上的成长档案展示称号。</p>
      </div>
    </dialog>
  );
}

export function AchievementCollection({
  achievements,
  uid,
}: {
  achievements: GrowthAchievement[];
  uid: string;
}) {
  const [filter, setFilter] = useState<GrowthAchievementSeries | 'all'>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [preference, setPreference] = useState<{ uid: string; id: string | null } | null>(null);
  const [storageMessage, setStorageMessage] = useState('');
  const storageKey = `freebbs:growth-title:${uid}`;
  useEffect(() => {
    setFilter('all');
    setDetailId(null);
    setStorageMessage('');
    try {
      setPreference({ uid, id: localStorage.getItem(`freebbs:growth-title:${uid}`) });
    } catch {
      setPreference({ uid, id: null });
    }
  }, [uid]);
  const selected =
    preference?.uid === uid
      ? achievements.find((badge) => badge.id === preference.id && badge.unlocked)
      : undefined;
  function choose(badge: GrowthAchievement | null) {
    if (badge && !achievements.some((current) => current.id === badge.id && current.unlocked))
      return;
    setPreference({ uid, id: badge?.id ?? null });
    setDetailId(null);
    try {
      if (badge) localStorage.setItem(storageKey, badge.id);
      else localStorage.removeItem(storageKey);
      setStorageMessage('');
    } catch {
      setStorageMessage('本次选择仅在当前页面展示，设备暂时无法保存。');
    }
  }
  const visible = achievements.filter((badge) => filter === 'all' || seriesFor(badge) === filter);
  const next = visible
    .filter((badge) => !badge.unlocked)
    .sort(
      (left, right) =>
        progress(right) / Math.max(1, right.target) - progress(left) / Math.max(1, left.target),
    )[0];
  const detail = achievements.find((badge) => badge.id === detailId);
  const nextSeries = next ? SERIES.find((entry) => entry.key === seriesFor(next)) : null;
  return (
    <div className="growth-collection">
      <DetailSection
        title="成就收藏册"
        description="四个系列，收藏属于自己的校园探索。"
        actions={
          <span className="growth-collection-count">
            已解锁 {achievements.filter((badge) => badge.unlocked).length} / {achievements.length}
          </span>
        }
      >
        <div className="growth-title-display">
          <div aria-label="成长档案展示称号">
            <span>成长档案展示称号</span>
            <strong>{selected?.title ?? '尚未选择'}</strong>
          </div>
          {selected ? (
            <button type="button" className="growth-button" onClick={() => choose(null)}>
              清除展示称号
            </button>
          ) : (
            <p>点开已解锁徽章，选一个称号陪你继续探索。</p>
          )}
        </div>
        {storageMessage ? (
          <p className="growth-storage-message" role="status">
            {storageMessage}
          </p>
        ) : null}
        <div className="growth-series-filters" role="group" aria-label="成就系列">
          <button
            type="button"
            aria-label="全部成就"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            全部<span>{achievements.length}</span>
          </button>
          {SERIES.map((entry) => (
            <button
              type="button"
              key={entry.key}
              aria-label={entry.label}
              aria-pressed={filter === entry.key}
              onClick={() => setFilter(entry.key)}
            >
              {entry.label}
              <span>{achievements.filter((badge) => seriesFor(badge) === entry.key).length}</span>
            </button>
          ))}
        </div>
        {next ? (
          <section className="growth-next-goal" aria-label="下一枚收藏">
            <div>
              <span className="growth-series-label">下一枚收藏</span>
              <p>
                距离「{next.title}」还差 {Math.max(0, next.target - next.progress)}{' '}
                {nextSeries?.unit}。
              </p>
            </div>
            <button type="button" className="growth-button" onClick={() => setDetailId(next.id)}>
              查看目标
            </button>
          </section>
        ) : visible.length ? (
          <p className="growth-goals-complete">这个系列的徽章已经全部点亮。</p>
        ) : null}
        <ul className="growth-badge-grid" aria-label="徽章收藏">
          {visible.map((badge) => (
            <li key={badge.id} className={badge.unlocked ? 'is-unlocked' : 'is-locked'}>
              <button
                className="growth-badge-card"
                type="button"
                aria-label={`查看${badge.title}详情`}
                onClick={() => setDetailId(badge.id)}
              >
                <span className="growth-badge-state">{badge.unlocked ? '已解锁' : '待解锁'}</span>
                <AchievementMark achievement={badge} />
                <strong>{badge.title}</strong>
                <span className="growth-series-label">
                  {SERIES.find((entry) => entry.key === seriesFor(badge))?.label}
                </span>
                <progress
                  aria-label={`${badge.title}进度`}
                  value={progress(badge)}
                  max={Math.max(1, badge.target)}
                />
                <span className="growth-progress-label">
                  {progress(badge)} / {badge.target}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!visible.length ? <p className="growth-empty">这个系列暂时没有可展示的成就。</p> : null}
      </DetailSection>
      {detail ? (
        <AchievementDetail
          badge={detail}
          selected={selected?.id === detail.id}
          onClose={() => setDetailId(null)}
          onSelect={() => choose(detail)}
        />
      ) : null}
    </div>
  );
}
