import { useEffect, useState } from 'react';

import type { UserContext } from '@freebbs-development/contracts';

import calendarIcon from '../assets/main-site/calendar.svg';
import placeholderAvatar from '../assets/main-site/avatar_placeholder.webp';
import electronIcon from '../assets/main-site/electron.svg';
import flameIcon from '../assets/main-site/flame.svg';
import inventoryIcon from '../assets/main-site/inventory.svg';
import magnetronIcon from '../assets/main-site/magnetron.svg';
import moonIcon from '../assets/main-site/moon.svg';
import shopIcon from '../assets/main-site/shop.svg';
import sunIcon from '../assets/main-site/sun.svg';
import type { AuthMode } from '../core/api/client.js';
import type { ThemeMode } from '../core/theme/useMainSiteTheme.js';
import {
  mainSiteHref,
  requestMainSite,
  type CheckinSummary,
  type MainSiteProfile,
} from './main-site-api.js';
import { MainSiteNotifications } from './MainSiteNotifications.js';

interface MainSiteHeaderProps {
  user: UserContext;
  authMode: AuthMode;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
}

function fortune(score: number) {
  if (score >= 90) return { label: '祥瑞', tone: 'great', tagline: 'Absoulute legend' };
  if (score >= 70) return { label: '大吉', tone: 'great', tagline: 'Absoulute legend' };
  if (score >= 50) return { label: '吉', tone: 'good', tagline: '闭眼写，随手推' };
  if (score >= 20)
    return { label: '顺', tone: 'good', tagline: '人生是个泊松过程，一时的等待是为了下一次跳跃' };
  return { label: '平', tone: 'neutral', tagline: '人生是个泊松过程，一时的等待是为了下一次跳跃' };
}

function reward(record: { date: string; rewardElectrons?: number; rewardMagnetic?: number }) {
  if (Number(record.rewardMagnetic) > 0) return `+${record.rewardMagnetic} 磁元`;
  if (Number(record.rewardElectrons) > 0) return `+${record.rewardElectrons} 电元（历史）`;
  return record.date >= '2026-09-16' ? '磁元奖励待核对' : '+0 电元（历史）';
}

function Currency({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value?: number;
  tone: string;
}) {
  return (
    <span
      className={`main-site-currency main-site-currency-${tone}`}
      aria-label={`${label}：${value ?? '—'}`}
      title={label}
    >
      <img src={icon} alt="" />
      <span>{value ?? '—'}</span>
    </span>
  );
}

export function MainSiteHeader({ user, authMode, themeMode, onToggleTheme }: MainSiteHeaderProps) {
  const [profile, setProfile] = useState<MainSiteProfile | null>(null);
  const [checkin, setCheckin] = useState<CheckinSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setProfile(null);
    setCheckin(null);
    if (authMode !== 'main') return;
    let alive = true;
    void Promise.allSettled([
      requestMainSite<{ user: MainSiteProfile }>('/auth/me'),
      requestMainSite<CheckinSummary>('/checkin'),
    ]).then(([profileResult, checkinResult]) => {
      if (!alive) return;
      if (profileResult.status === 'fulfilled' && profileResult.value.user.uid === user.uid) {
        setProfile(profileResult.value.user);
      }
      if (checkinResult.status === 'fulfilled') {
        setCheckin(checkinResult.value);
        if (checkinResult.value.user?.uid === user.uid) setProfile(checkinResult.value.user);
      }
    });
    return () => {
      alive = false;
    };
  }, [authMode, user.uid]);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialogOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen]);

  async function openCheckin() {
    setDialogOpen(true);
    setError('');
    if (authMode !== 'main') return;
    setLoading(true);
    try {
      const summary = await requestMainSite<CheckinSummary>('/checkin');
      setCheckin(summary);
      if (summary.user?.uid === user.uid) setProfile(summary.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '获取签到信息失败。');
    } finally {
      setLoading(false);
    }
  }

  async function submitCheckin() {
    setPosting(true);
    setError('');
    try {
      const result = await requestMainSite<CheckinSummary>('/checkin', { method: 'POST' });
      setCheckin(result.summary ?? result);
      if (result.user?.uid === user.uid) setProfile(result.user);
      window.dispatchEvent(
        new CustomEvent('freebbs:session-change', { detail: { user: result.user } }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '签到未完成，请重试。');
    } finally {
      setPosting(false);
    }
  }

  const score = Number(checkin?.today?.fortuneScore ?? checkin?.todayFortune?.score ?? 0);
  const today = checkin?.today?.date ?? checkin?.todayFortune?.date ?? '';
  const fortuneResult = fortune(score);
  const avatarPath = profile?.avatarPath || user.avatarUrl;
  const avatar = avatarPath?.startsWith('/uploads/')
    ? mainSiteHref(avatarPath)
    : avatarPath || placeholderAvatar;
  const profileName = profile?.username || user.displayName;

  return (
    <>
      <header className="main-site-header">
        <div className="main-site-account">
          <div className="main-site-economy">
            <div className="main-site-shortcuts">
              <button
                className={`main-site-shortcut main-site-checkin${checkin?.checkedInToday ? ' is-complete' : ''}`}
                type="button"
                onClick={() => void openCheckin()}
                aria-label={checkin?.checkedInToday ? '今日已签到' : '签到'}
              >
                <img src={calendarIcon} alt="" />
                <span>签到</span>
              </button>
              <a className="main-site-shortcut" href={mainSiteHref('/inventory')}>
                <img src={inventoryIcon} alt="" />
                <span>仓库</span>
              </a>
              <a className="main-site-shortcut" href={mainSiteHref('/electromagnetic')}>
                <img src={shopIcon} alt="" />
                <span>商店</span>
              </a>
            </div>
            <div className="main-site-currencies">
              <Currency
                icon={electronIcon}
                label="电元"
                tone="electric"
                value={profile?.electrons}
              />
              <Currency
                icon={magnetronIcon}
                label="磁元"
                tone="magnetic"
                value={profile?.manetrons}
              />
              <Currency icon={flameIcon} label="热力" tone="heat" value={profile?.heat} />
            </div>
          </div>
          <div className="main-site-user">
            <div className="main-site-user-copy">
              <strong title={profileName}>{profileName}</strong>
            </div>
            <a
              className="main-site-avatar"
              href={mainSiteHref(`/profile?uid=${encodeURIComponent(user.uid)}`)}
              aria-label="打开我的个人主页"
            >
              <img src={avatar} alt={`${user.displayName}头像`} />
            </a>
          </div>
          <MainSiteNotifications authMode={authMode} userUid={user.uid} />
          <button
            className="main-site-mobile-theme"
            type="button"
            aria-label={themeMode === 'light' ? '切换到暗色模式' : '切换到明亮模式'}
            onClick={onToggleTheme}
          >
            <img src={themeMode === 'light' ? moonIcon : sunIcon} alt="" />
          </button>
        </div>
      </header>
      {dialogOpen ? (
        <div
          className="main-site-dialog"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialogOpen(false);
          }}
        >
          <section
            className="main-site-dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="main-site-dialog-title"
          >
            <button
              className="main-site-dialog-close"
              type="button"
              onClick={() => setDialogOpen(false)}
              aria-label="关闭"
            >
              ×
            </button>
            <h2 id="main-site-dialog-title">签到</h2>
            {authMode === 'demo' ? (
              <p>请登录主站账号后签到。</p>
            ) : (
              <>
                {loading ? (
                  <p role="status">正在加载签到信息…</p>
                ) : checkin ? (
                  <>
                    <p className="main-site-dialog-date">{today}</p>
                    <div className={`main-site-fortune main-site-fortune-${fortuneResult.tone}`}>
                      {fortuneResult.label}
                    </div>
                    <p className="main-site-dialog-score">今日运势 {score}</p>
                    <p className="main-site-dialog-tagline">{fortuneResult.tagline}</p>
                    <button
                      className="main-site-dialog-submit"
                      type="button"
                      disabled={posting || checkin.checkedInToday}
                      onClick={() => void submitCheckin()}
                    >
                      {checkin.checkedInToday
                        ? '今日已签到'
                        : posting
                          ? '签到中…'
                          : today >= '2026-09-16'
                            ? '签到领取磁元'
                            : '签到领取电元'}
                    </button>
                    <div className="main-site-records" aria-label="签到记录">
                      {checkin.records?.length ? (
                        checkin.records.map((record) => (
                          <div key={record.date} className="main-site-record">
                            <span>{record.date}</span>
                            <strong>连续 {record.streak} 天</strong>
                            <span>{reward(record)}</span>
                          </div>
                        ))
                      ) : (
                        <p>还没有签到记录。</p>
                      )}
                    </div>
                    <p className="main-site-record-caption">签到记录</p>
                  </>
                ) : null}
                {error ? (
                  <p className="main-site-dialog-error" role="alert">
                    {error}{' '}
                    <button type="button" onClick={() => void openCheckin()}>
                      重试
                    </button>
                  </p>
                ) : null}
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
