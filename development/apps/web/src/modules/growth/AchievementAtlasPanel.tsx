import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  AchievementAtlas,
  AchievementFamily,
  AtlasAchievement,
  MapBindingRequest,
  MapConnectionStatus,
} from '@freebbs-development/contracts';
import { DetailSection } from '../../components/DetailSection.js';
import { ApiError } from '../../core/api/client.js';
import { growthSessionKey, type GrowthClient } from './growthSession.js';
import { AchievementMark } from './AchievementMark.js';

const FAMILIES: { key: AchievementFamily; label: string; icon: string }[] = [
  { key: 'daily', label: '日常成长', icon: 'calendar' },
  { key: 'learning', label: '学习探索', icon: 'orbit' },
  { key: 'creation', label: '创作表达', icon: 'flag' },
  { key: 'campus', label: '校园同行', icon: 'spark' },
  { key: 'contribution', label: '组织贡献', icon: 'liaison' },
  { key: 'map', label: '地图收藏', icon: 'compass' },
];
interface AtlasPanelProps {
  client: GrowthClient;
  personalAccess?: boolean;
  uid: string;
  onAtlasLoaded?(atlas: AchievementAtlas): void;
}
function familyLabel(family: AchievementFamily) {
  return FAMILIES.find((entry) => entry.key === family)?.label ?? '校园同行';
}
function achievementState(badge: AtlasAchievement) {
  return badge.unlocked ? '已解锁' : badge.available ? '待解锁' : '来源暂不可用';
}
function progressLabel(badge: AtlasAchievement) {
  return `${Math.max(0, Math.min(badge.progress, badge.target))} / ${badge.target}`;
}
function displayDate(value: string | undefined) {
  if (!value) return '尚未同步';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '日期待补充' : date.toLocaleString('zh-CN');
}
function validAtlas(value: AchievementAtlas, uid: string): boolean {
  return (
    value?.version === 1 &&
    value.uid === uid &&
    Array.isArray(value.achievements) &&
    Array.isArray(value.showcaseIds) &&
    Boolean(value.map && value.sources && value.counts)
  );
}
function AchievementArt({ badge }: { badge: AtlasAchievement }) {
  const [failed, setFailed] = useState(false);
  const image =
    badge.family === 'map' && /^(https:\/\/|\/).*\.(png|webp)(\?.*)?$/i.test(badge.icon);
  return image && !failed ? (
    <img className="atlas-map-art" src={badge.icon} alt="" onError={() => setFailed(true)} />
  ) : (
    <AchievementMark
      achievement={{
        ...badge,
        icon: badge.icon || FAMILIES.find((entry) => entry.key === badge.family)?.icon,
      }}
    />
  );
}
function AtlasDetail({
  badge,
  selected,
  full,
  saving,
  onClose,
  onSelect,
}: {
  badge: AtlasAchievement;
  selected: boolean;
  full: boolean;
  saving: boolean;
  onClose(): void;
  onSelect(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
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
  return (
    <dialog
      ref={dialogRef}
      className={
        'growth-achievement-dialog atlas-detail ' + (badge.unlocked ? 'is-unlocked' : 'is-locked')
      }
      aria-labelledby={titleId}
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
          onClick={onClose}
        >
          关闭成就详情
        </button>
        <AchievementArt badge={badge} />
        <p className="growth-series-label">
          {familyLabel(badge.family)} · {achievementState(badge)}
        </p>
        <h3 id={titleId}>{badge.title}</h3>
        <p>{badge.description}</p>
        <dl className="atlas-detail-source">
          <div>
            <dt>记录来源</dt>
            <dd>{badge.source}</dd>
          </div>
          {badge.earnedAt ? (
            <div>
              <dt>入藏时间</dt>
              <dd>{displayDate(badge.earnedAt)}</dd>
            </div>
          ) : null}
        </dl>
        {badge.available ? (
          <>
            <div className="growth-detail-progress">
              <span>当前进度</span>
              <strong>{progressLabel(badge)}</strong>
            </div>
            <progress
              aria-label={badge.title + '进度'}
              value={Math.max(0, Math.min(badge.progress, badge.target))}
              max={Math.max(1, badge.target)}
            />
          </>
        ) : (
          <p className="atlas-source-note">来源暂不可用</p>
        )}
        <button
          type="button"
          className="growth-button growth-title-action"
          onClick={onSelect}
          disabled={!badge.unlocked || saving || (!selected && full)}
        >
          {!badge.unlocked
            ? '解锁后可陈列'
            : saving
              ? '正在保存…'
              : selected
                ? '移出陈列'
                : full
                  ? '陈列已满，请先移出一枚'
                  : '加入陈列'}
        </button>
        <p className="growth-detail-note">最多陈列六枚已解锁成就，网站与小程序共享这份选择。</p>
      </div>
    </dialog>
  );
}

// Retire the whole private session whenever its account or transport changes.
export function AchievementAtlasPanel(props: AtlasPanelProps) {
  if (props.personalAccess === false || props.client.previewUser)
    return <p className="atlas-source-note">请切回本人账号后查看成就图鉴和管理地图连接。</p>;
  return <AtlasSession key={growthSessionKey(props.client, props.uid)} {...props} />;
}
function AtlasSession({ client, uid, onAtlasLoaded }: AtlasPanelProps) {
  const [atlas, setAtlas] = useState<AchievementAtlas | null>(null);
  const [connection, setConnection] = useState<MapConnectionStatus | null>(null);
  const [filter, setFilter] = useState<AchievementFamily | 'all'>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [unlinkConfirmation, setUnlinkConfirmation] = useState(false);
  const live = useRef(true);
  const readSerial = useRef(0);
  const connectionSerial = useRef(0);
  const pollBusy = useRef(false);
  const callback = useRef(onAtlasLoaded);
  callback.current = onAtlasLoaded;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      readSerial.current++;
      connectionSerial.current++;
    };
  }, []);
  const loadAtlas = useCallback(
    async (updateConnection = true) => {
      if (client.previewUser) return false;
      const serial = ++readSerial.current;
      try {
        const result = await client.request<AchievementAtlas>('/growth/atlas');
        if (!live.current || Boolean(client.previewUser) || serial !== readSerial.current) return;
        if (!validAtlas(result, uid)) throw new Error('invalid_atlas');
        setAtlas(result);
        if (updateConnection) setConnection(result.map);
        setError('');
        callback.current?.(result);
        return true;
      } catch {
        if (live.current && serial === readSerial.current)
          setError('成就图鉴暂时无法加载，请稍后重试。');
        return false;
      }
    },
    [client, uid],
  );
  useEffect(() => {
    void loadAtlas();
  }, [loadAtlas]);

  const refreshConnection = useCallback(async () => {
    if (client.previewUser) return;
    const serial = ++connectionSerial.current;
    try {
      const result = await client.request<MapConnectionStatus>('/growth/map/status');
      if (!live.current || Boolean(client.previewUser) || serial !== connectionSerial.current)
        return;
      setConnection(result);
      setConnectionError('');
      setClock(Date.now());
    } catch {
      if (live.current && serial === connectionSerial.current)
        setConnectionError('连接状态暂时无法获取，稍后可以继续检查。');
    }
  }, [client]);
  const pending = connection?.pending;
  const expired = Boolean(
    pending && (pending.status === 'expired' || Date.parse(pending.expiresAt) <= clock),
  );
  useEffect(() => {
    if (!pending || expired || connection?.linked || connecting) return;
    const timer = window.setInterval(() => {
      setClock(Date.now());
      if (Date.parse(pending.expiresAt) <= Date.now() || pollBusy.current) return;
      pollBusy.current = true;
      void refreshConnection().finally(() => {
        pollBusy.current = false;
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [pending?.id, pending?.expiresAt, expired, connection?.linked, connecting, refreshConnection]);

  async function saveShowcase(ids: Array<string | null>) {
    if (!atlas || saving || client.previewUser) return;
    setSaving(true);
    setNotice('');
    try {
      const result = await client.request<AchievementAtlas>('/growth/showcase', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, revision: atlas.showcaseRevision }),
      });
      if (!live.current || Boolean(client.previewUser)) return;
      if (!validAtlas(result, uid)) throw new Error('invalid_atlas');
      readSerial.current++;
      setAtlas(result);
      callback.current?.(result);
      setDetailId(null);
      setNotice('陈列已保存。');
    } catch (failure) {
      if (!live.current || Boolean(client.previewUser)) return;
      if (failure instanceof ApiError && failure.status === 409) {
        const reloaded = await loadAtlas();
        if (live.current) {
          setDetailId(null);
          setNotice(
            reloaded
              ? '陈列已在另一端更新，已载入最新选择，请重新选择。'
              : '最新陈列暂时无法获取，请刷新图鉴后再选择。',
          );
        }
      } else setNotice('陈列保存失败，当前选择未变，请重试。');
    } finally {
      if (live.current) setSaving(false);
    }
  }
  function toggleShowcase(badge: AtlasAchievement) {
    if (!atlas || !badge.unlocked) return;
    const ids = [...atlas.showcaseIds];
    const selected = ids.indexOf(badge.id);
    if (selected >= 0) ids[selected] = null;
    else {
      const empty = ids.indexOf(null);
      if (empty >= 0) ids[empty] = badge.id;
      else if (ids.length < 6) ids.push(badge.id);
      else return;
    }
    void saveShowcase(ids);
  }
  async function connectionAction(action: 'create' | 'confirm' | 'unlink') {
    if (
      client.previewUser ||
      connecting ||
      (action === 'confirm' && (!pending || pending.status !== 'claimed' || expired))
    )
      return;
    setConnecting(true);
    setConnectionError('');
    connectionSerial.current++;
    try {
      if (action === 'create') {
        const result = await client.request<MapBindingRequest>('/growth/map/binding', {
          method: 'POST',
        });
        if (!live.current || Boolean(client.previewUser)) return;
        setConnection({ configured: true, linked: false, pending: result });
        setClock(Date.now());
      } else {
        const path =
          action === 'confirm'
            ? '/growth/map/binding/' + encodeURIComponent(pending!.id) + '/confirm'
            : '/growth/map/binding';
        const result = await client.request<MapConnectionStatus>(path, {
          method: action === 'confirm' ? 'POST' : 'DELETE',
        });
        if (!live.current || Boolean(client.previewUser)) return;
        setConnection(result);
        setUnlinkConfirmation(false);
        await loadAtlas(false);
      }
    } catch (failure) {
      if (!live.current || Boolean(client.previewUser)) return;
      setConnectionError(
        failure instanceof ApiError && failure.code === 'preview_identity_denied'
          ? '请切回本人账号后管理地图连接。'
          : action === 'create'
            ? '绑定码暂时无法生成，请稍后重试。'
            : action === 'confirm'
              ? '绑定未完成，请检查口令是否过期或账号是否已有连接。'
              : '解除连接失败，请稍后重试。',
      );
    } finally {
      if (live.current) setConnecting(false);
    }
  }
  const visible =
    atlas?.achievements.filter((badge) => filter === 'all' || badge.family === filter) ?? [];
  const allCollectibles = [
    ...new Map(
      [
        ...(atlas?.achievements ?? []),
        ...(atlas?.archivedAchievements ?? []),
        ...(atlas?.showcaseAchievements ?? []),
      ].map((badge) => [badge.id, badge]),
    ).values(),
  ];
  const detail = allCollectibles.find((badge) => badge.id === detailId);
  const featured = Array.from({ length: 6 }, (_, index) =>
    allCollectibles.find((badge) => badge.id === atlas?.showcaseIds[index] && badge.unlocked),
  );
  const full = atlas ? atlas.showcaseIds.filter(Boolean).length >= 6 : false;
  return (
    <div className="growth-atlas">
      <DetailSection
        title="成就图鉴"
        description="日常、学习、创作与同行，收藏成长的不同侧面。"
        actions={
          atlas ? (
            <span className="growth-collection-count">
              已解锁 {atlas.achievements.filter((badge) => badge.unlocked).length} /{' '}
              {atlas.achievements.length}
            </span>
          ) : undefined
        }
      >
        {error ? (
          <div className="atlas-error">
            <p role="alert">{error}</p>
            <button type="button" className="growth-button" onClick={() => void loadAtlas()}>
              重试成就图鉴
            </button>
          </div>
        ) : null}
        {!atlas && !error ? (
          <p role="status" className="growth-empty">
            正在整理成就图鉴…
          </p>
        ) : null}
        {atlas ? (
          <>
            <div className="atlas-evidence-counts">
              <div aria-label="已结束报名">
                <strong>{atlas.counts.registration}</strong>
                <span>已结束报名</span>
              </div>
              <div aria-label="已核验参加">
                <strong>{atlas.counts.verifiedActivity}</strong>
                <span>已核验参加</span>
              </div>
              <div aria-label="地图探索">
                <strong>{atlas.counts.mapExploration}</strong>
                <span>地图探索</span>
              </div>
            </div>
            <p className="atlas-source-note">
              报名记录与实际参加分别统计，地图纪念点与地标收藏属于探索。
            </p>
            <section className="atlas-showcase" aria-label="成就陈列">
              <header>
                <div>
                  <h4>我的成就陈列</h4>
                  <p>挑选六枚成就，展示自己的成长轨迹。</p>
                </div>
                <span>{atlas.showcaseIds.filter(Boolean).length} / 6</span>
              </header>
              <ol className="atlas-showcase-slots">
                {featured.map((badge, index) => (
                  <li key={index} className={badge ? 'is-unlocked' : 'is-empty'}>
                    <button
                      type="button"
                      disabled={!badge || saving}
                      aria-label={
                        badge ? '查看陈列成就 ' + badge.title : '第 ' + (index + 1) + ' 格陈列空位'
                      }
                      onClick={() => badge && setDetailId(badge.id)}
                    >
                      {badge ? (
                        <>
                          <AchievementArt badge={badge} />
                          <strong>{badge.title}</strong>
                        </>
                      ) : (
                        <>
                          <span className="atlas-empty-star" aria-hidden="true">
                            ✧
                          </span>
                          <span>待你点亮</span>
                        </>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            </section>
            {notice ? (
              <p role="status" className="atlas-notice">
                {notice}
              </p>
            ) : null}
            {atlas.sources.learning !== 'ready' ? (
              <p className="atlas-source-note">
                {atlas.sources.learning === 'not_configured'
                  ? '平台学习与日常记录尚未接入，相关进度将在接入后更新。'
                  : '平台学习与日常记录暂时无法读取，已有成就保留，当前进度暂不可用。'}
              </p>
            ) : null}
            <div
              className="growth-series-filters atlas-family-filters"
              role="group"
              aria-label="成就分类"
            >
              <button
                type="button"
                aria-label="全部成就"
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                全部<span>{atlas.achievements.length}</span>
              </button>
              {FAMILIES.map((family) => (
                <button
                  type="button"
                  key={family.key}
                  aria-label={family.label}
                  aria-pressed={filter === family.key}
                  onClick={() => setFilter(family.key)}
                >
                  {family.label}
                  <span>
                    {atlas.achievements.filter((badge) => badge.family === family.key).length}
                  </span>
                </button>
              ))}
            </div>
            <ul className="growth-badge-grid atlas-badge-grid" aria-label="成就收藏">
              {visible.map((badge) => (
                <li key={badge.id} className={badge.unlocked ? 'is-unlocked' : 'is-locked'}>
                  <button
                    className="growth-badge-card atlas-badge-card"
                    type="button"
                    aria-label={badge.title + ' 查看详情'}
                    onClick={() => setDetailId(badge.id)}
                  >
                    <span className="growth-badge-state">{achievementState(badge)}</span>
                    <AchievementArt badge={badge} />
                    <strong>{badge.title}</strong>
                    <span className="growth-series-label">{familyLabel(badge.family)}</span>
                    <span className="atlas-card-description">{badge.description}</span>
                    {badge.available ? (
                      <>
                        <progress
                          aria-label={badge.title + '进度'}
                          value={Math.max(0, Math.min(badge.progress, badge.target))}
                          max={Math.max(1, badge.target)}
                        />
                        <span className="growth-progress-label">{progressLabel(badge)}</span>
                      </>
                    ) : (
                      <span className="atlas-progress-unavailable">进度待更新</span>
                    )}
                    <span className="atlas-card-source">{badge.source}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!visible.length ? (
              <p className="growth-empty">
                {atlas.achievements.length
                  ? '这个分类暂时没有可展示的成就。'
                  : '还没有可展示的成就。'}
              </p>
            ) : null}
            {atlas.archivedAchievements?.length ? (
              <details className="atlas-archive">
                <summary>
                  往期收藏 <span>{atlas.archivedAchievements.length}</span>
                </summary>
                <p className="atlas-source-note">旧版已入藏的成就会一直保留，也可以继续陈列。</p>
                <ul className="atlas-archive-list">
                  {atlas.archivedAchievements.map((badge) => (
                    <li key={badge.id}>
                      <button
                        type="button"
                        aria-label={`${badge.title} 查看详情`}
                        onClick={() => setDetailId(badge.id)}
                      >
                        <AchievementArt badge={badge} />
                        <strong>{badge.title}</strong>
                        <span>往期入藏</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
      </DetailSection>
      {connection ? (
        <DetailSection title="地图连接" description="连接校园活动地图，汇集自己的历史点亮记录。">
          <div className="atlas-map-connection">
            <div className="atlas-map-copy">
              <p className="atlas-map-state">
                <span
                  className={connection.linked ? 'atlas-status-dot connected' : 'atlas-status-dot'}
                  aria-hidden="true"
                />
                {connection.linked
                  ? '已连接'
                  : connection.configured
                    ? '尚未连接'
                    : '地图接入尚未配置'}
              </p>
              {connection.linked ? (
                <p>
                  地图编号 <strong>{connection.publicId}</strong>
                  <br />
                  最近同步：{displayDate(connection.lastSyncedAt)}
                  <br />
                  在小程序档案中点击同步，可补齐历史点亮。
                </p>
              ) : (
                <p>获取口令后，在小程序「连接网站成就图鉴」页面填写，再回到这里确认账号。</p>
              )}
            </div>
            <div className="atlas-map-controls">
              {!connection.linked ? (
                <button
                  type="button"
                  className="growth-button"
                  disabled={!connection.configured || connecting}
                  onClick={() => void connectionAction('create')}
                >
                  {connecting ? '处理中…' : '获取绑定码'}
                </button>
              ) : (
                <button
                  type="button"
                  className="growth-button"
                  disabled={connecting}
                  onClick={() => setUnlinkConfirmation(true)}
                >
                  解除连接
                </button>
              )}
              {connection.configured ? (
                <button
                  type="button"
                  className="growth-button"
                  disabled={connecting}
                  onClick={() => void refreshConnection()}
                >
                  刷新连接状态
                </button>
              ) : null}
            </div>
          </div>
          {pending && !connection.linked ? (
            <div className="atlas-binding-request">
              {expired ? (
                <p className="atlas-source-note">绑定码已过期，请重新获取。</p>
              ) : (
                <>
                  <div>
                    <span>小程序绑定码</span>
                    <strong className="atlas-binding-code">{pending.code}</strong>
                    <small>有效至 {displayDate(pending.expiresAt)}</small>
                  </div>
                  {pending.status === 'claimed' ? (
                    <div className="atlas-binding-confirm">
                      <p>
                        小程序已提交，核对公开编号：<strong>{pending.publicId}</strong>
                      </p>
                      <button
                        type="button"
                        className="growth-button atlas-primary"
                        disabled={connecting}
                        onClick={() => void connectionAction('confirm')}
                      >
                        确认连接此账号
                      </button>
                    </div>
                  ) : (
                    <p>等待小程序提交，连接状态每 3 秒自动检查。</p>
                  )}
                </>
              )}
            </div>
          ) : null}
          {unlinkConfirmation ? (
            <div className="atlas-binding-confirm">
              <p>解除连接后，两端停止同步。已获得的成就和原有地图记录会保留。</p>
              <button
                type="button"
                className="growth-button"
                disabled={connecting}
                onClick={() => void connectionAction('unlink')}
              >
                确认解除连接
              </button>
              <button
                type="button"
                className="growth-button"
                onClick={() => setUnlinkConfirmation(false)}
              >
                保留连接
              </button>
            </div>
          ) : null}
          {connectionError ? (
            <p className="atlas-connection-error" role="alert">
              {connectionError}
            </p>
          ) : null}
        </DetailSection>
      ) : null}
      {detail ? (
        <AtlasDetail
          badge={detail}
          selected={atlas!.showcaseIds.includes(detail.id)}
          full={full}
          saving={saving}
          onClose={() => setDetailId(null)}
          onSelect={() => toggleShowcase(detail)}
        />
      ) : null}
    </div>
  );
}
