import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'react-router-dom';

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

const typographyFonts: Record<string, string> = {
  'transistor-lab': '"HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  'zhongsong-study': '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
  'quantum-board': '"HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  'night-oscilloscope': '"Segoe UI", "Microsoft YaHei", sans-serif',
};

function headerTypography(): CSSProperties {
  let preferences: { fontPreset?: string; typeScale?: string } = {};
  try {
    preferences = JSON.parse(
      window.localStorage.getItem('free_bbs_typography_preferences') || '{}',
    );
  } catch {
    // Use the main site's default preset when saved preferences are malformed.
  }
  const scale =
    { standard: 16, comfortable: 17.28, large: 18.88 }[preferences.typeScale || 'comfortable'] ||
    17.28;
  return {
    '--main-site-ui-font':
      typographyFonts[preferences.fontPreset || 'transistor-lab'] ||
      typographyFonts['transistor-lab'],
    '--main-site-ui-size': `${scale}px`,
  } as CSSProperties;
}

function fortune(score: number) {
  if (score >= 90) return { label: '祥瑞', tone: 'great', tagline: 'Absoulute legend' };
  if (score >= 70) return { label: '大吉', tone: 'awful', tagline: 'Absoulute legend' };
  if (score >= 50) return { label: '吉', tone: 'bad', tagline: '闭眼写，随手推' };
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
  const location = useLocation();
  const savedLocation =
    location.pathname === '/shop' || location.pathname === '/inventory'
      ? (location.state as { from?: string } | null)?.from || '/dashboard'
      : `${location.pathname}${location.search}`;
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
  }, [authMode, user.uid, location.pathname]);

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
      <header className="main-site-header" style={headerTypography()}>
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
              <Link className="main-site-shortcut" to="/inventory" state={{ from: savedLocation }}>
                <img src={inventoryIcon} alt="" />
                <span>仓库</span>
              </Link>
              <Link className="main-site-shortcut" to="/shop" state={{ from: savedLocation }}>
                <img src={shopIcon} alt="" />
                <span>商店</span>
              </Link>
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
          className="fortune-modal development-fortune-modal"
          role="presentation"
          style={headerTypography()}
        >
          <div className="fortune-backdrop" onMouseDown={() => setDialogOpen(false)} />
          <section
            className="fortune-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fortune-title"
          >
            <button
              className="fortune-close"
              type="button"
              onClick={() => setDialogOpen(false)}
              aria-label="关闭"
            >
              ×
            </button>
            <h2 className="fortune-title" id="fortune-title">
              签到
            </h2>
            {authMode === 'demo' ? (
              <p className="fortune-record-empty">请登录主站账号后签到。</p>
            ) : (
              <>
                <p className="fortune-date">{loading ? '' : today}</p>
                <div
                  className={`fortune-badge ${checkin && !loading ? `fortune-${fortuneResult.tone}` : ''}`}
                >
                  {loading ? '加载中' : checkin ? fortuneResult.label : '签到'}
                </div>
                <p className="fortune-score">{checkin && !loading ? `今日运势 ${score}` : ''}</p>
                <p className="fortune-tagline">
                  {checkin && !loading ? fortuneResult.tagline : error}
                </p>
                <button
                  className="fortune-checkin-button"
                  type="button"
                  disabled={loading || posting || !checkin || checkin.checkedInToday}
                  onClick={() => void submitCheckin()}
                >
                  {loading
                    ? '加载中'
                    : checkin?.checkedInToday
                      ? '今日已签到'
                      : posting
                        ? '签到中'
                        : today >= '2026-09-16'
                          ? '签到领取磁元'
                          : '签到领取电元'}
                </button>
                <div className="fortune-records" aria-label="签到记录">
                  {loading ? (
                    <p className="fortune-record-empty">正在加载签到记录...</p>
                  ) : checkin?.records?.length ? (
                    checkin.records.map((record) => (
                      <div key={record.date} className="fortune-record-row">
                        <span>{record.date}</span>
                        <strong>连续 {record.streak} 天</strong>
                        <span>{reward(record)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="fortune-record-empty">还没有签到记录。</p>
                  )}
                </div>
                <p className="fortune-chart-caption">签到记录</p>
                {error ? (
                  <button type="button" onClick={() => void openCheckin()}>
                    重试
                  </button>
                ) : null}
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
