import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import type { UserContext } from '@freebbs-development/contracts';

import calendarIcon from '../assets/main-site/calendar.svg';
import placeholderAvatar from '../assets/main-site/avatar_placeholder.webp';
import electronIcon from '../assets/main-site/electron.svg';
import flameIcon from '../assets/main-site/flame.svg';
import gearIcon from '../assets/main-site/gear.svg';
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
import { MODULE_MANIFESTS } from './module-manifests.js';
import { mainSiteTypography } from './main-site-typography.js';
export { mainSiteTypography } from './main-site-typography.js';

interface MainSiteHeaderProps {
  user: UserContext;
  authMode: AuthMode;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
}

function beijingToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function developmentTitle(pathname: string): string {
  if (pathname === '/dashboard' || pathname === '/') return '发展端 / 开始探索';
  if (pathname.startsWith('/inventory')) return '仓库';
  if (pathname.startsWith('/shop')) return '商店';
  if (pathname.startsWith('/profile')) return '个人主页';
  if (pathname.startsWith('/ranch-dye')) return '牧场染坊';
  if (pathname.startsWith('/ranch-gallery')) return '羊群广场';
  if (pathname.startsWith('/ranch')) return '电子牧场';
  if (pathname.startsWith('/settings')) return '设置';
  if (pathname.startsWith('/organizations')) return '风采展示';
  return (
    MODULE_MANIFESTS.find(
      (module) => pathname === module.route || pathname.startsWith(`${module.route}/`),
    )?.name || '发展端'
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" />
      <path d="m15 15 5 5" />
    </svg>
  );
}

function fortune(score: number) {
  if (score >= 90) return { label: '祥瑞', tone: 'great', tagline: 'Absolute legend' };
  if (score >= 70) return { label: '大吉', tone: 'awful', tagline: 'Absolute legend' };
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

function CheckinCalendar({ summary }: { summary: CheckinSummary }) {
  const today = summary.todayFortune?.date || summary.today?.date || beijingToday();
  const currentMonth = today.slice(0, 7);
  const oldestMonth = useMemo(() => {
    const first = new Date(`${today}T00:00:00Z`);
    first.setUTCDate(first.getUTCDate() - 365);
    if (first.getUTCDate() !== 1) first.setUTCMonth(first.getUTCMonth() + 1, 1);
    return first.toISOString().slice(0, 7);
  }, [today]);
  const [month, setMonth] = useState(currentMonth);
  const [detail, setDetail] = useState('点击日期查看签到详情 · 按北京时间记录');

  useEffect(() => {
    setMonth(currentMonth);
    setDetail('点击日期查看签到详情 · 按北京时间记录');
  }, [currentMonth]);

  const records = useMemo(
    () => new Map((summary.records || []).map((record) => [record.date, record])),
    [summary.records],
  );
  const [year, monthNumber] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const checked = Array.from(records.keys()).filter((date) => date.startsWith(`${month}-`)).length;

  function moveMonth(step: number) {
    setMonth(new Date(Date.UTC(year, monthNumber - 1 + step, 1)).toISOString().slice(0, 7));
    setDetail('点击日期查看签到详情 · 按北京时间记录');
  }

  return (
    <div className="fortune-records" id="fortune-records" aria-label="签到记录">
      <div className="checkin-month-heading">
        <button
          type="button"
          aria-label="上个月"
          disabled={month <= oldestMonth}
          onClick={() => moveMonth(-1)}
        >
          ‹
        </button>
        <strong>{`${year} 年 ${monthNumber} 月`}</strong>
        <button
          type="button"
          aria-label="下个月"
          disabled={month >= currentMonth}
          onClick={() => moveMonth(1)}
        >
          ›
        </button>
      </div>
      <p className="checkin-month-summary">本月已签到 {checked} 天 · 灰色为未签到</p>
      <div
        className="checkin-calendar"
        role="grid"
        aria-label={`${year} 年 ${monthNumber} 月签到日历`}
      >
        {['一', '二', '三', '四', '五', '六', '日'].map((label) => (
          <span className="checkin-weekday" key={label}>
            {label}
          </span>
        ))}
        {Array.from({ length: offset }, (_, index) => (
          <span aria-hidden="true" key={`blank-${index}`} />
        ))}
        {Array.from({ length: dayCount }, (_, index) => {
          const day = index + 1;
          const date = `${month}-${String(day).padStart(2, '0')}`;
          const record = records.get(date);
          const result = record ? fortune(Number(record.fortuneScore || 0)) : null;
          const dayDetail = record
            ? `${date} · ${result?.label} · 连续 ${Number(record.streak || 0)} 天 · ${reward(record)}`
            : `${date} · ${date > today ? '尚未到来' : '未签到'}`;
          return (
            <button
              className={`checkin-day ${result ? `fortune-${result.tone}` : 'is-unchecked'}${date === today ? ' is-today' : ''}`}
              type="button"
              key={date}
              aria-label={dayDetail}
              aria-current={date === today ? 'date' : undefined}
              title={dayDetail}
              onClick={() => setDetail(dayDetail)}
            >
              {day}
            </button>
          );
        })}
      </div>
      <p className="checkin-day-detail" aria-live="polite">
        {detail}
      </p>
    </div>
  );
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
      <header className="main-site-header" style={mainSiteTypography()}>
        <h1 className="main-site-header-title">{developmentTitle(location.pathname)}</h1>
        <div className="main-site-account">
          <a
            className="main-site-search main-site-tool-button"
            href={mainSiteHref('/search')}
            aria-label="全站搜索"
            title="全站搜索"
          >
            <SearchIcon />
          </a>
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
            <Link
              className="main-site-avatar"
              to="/profile"
              state={{ from: savedLocation }}
              aria-label="打开我的个人主页"
            >
              <img src={avatar} alt={`${user.displayName}头像`} />
            </Link>
          </div>
          <div className="main-site-tools">
            <Link
              className="main-site-settings main-site-tool-button"
              to="/settings"
              state={{ from: savedLocation }}
              aria-label="设置"
              title="设置"
            >
              <img src={gearIcon} alt="" />
            </Link>
            <button
              className="main-site-desktop-theme main-site-tool-button"
              type="button"
              aria-label={themeMode === 'light' ? '切换到暗色模式' : '切换到明亮模式'}
              onClick={onToggleTheme}
            >
              <img src={themeMode === 'light' ? moonIcon : sunIcon} alt="" />
            </button>
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
        </div>
      </header>
      {dialogOpen ? (
        <div
          className="fortune-modal development-fortune-modal"
          role="presentation"
          style={mainSiteTypography()}
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
                {loading ? (
                  <div className="fortune-records" aria-label="签到记录">
                    <p className="fortune-record-empty">正在加载签到记录...</p>
                  </div>
                ) : checkin ? (
                  <CheckinCalendar summary={checkin} />
                ) : (
                  <div className="fortune-records" aria-label="签到记录">
                    <p className="fortune-record-empty">签到记录暂时不可用。</p>
                  </div>
                )}
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
