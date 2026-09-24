import { AUTH_TOKEN_STORAGE_KEY } from '../core/api/client.js';

export function mainSiteHref(path: string): string {
  const origin =
    import.meta.env.MODE === 'development'
      ? (import.meta.env.VITE_MAIN_SITE_ORIGIN || 'http://localhost:3000').replace(/\/+$/, '')
      : '';
  return `${origin}${path}`;
}

export interface MainSiteProfile {
  uid: string;
  username?: string;
  fullName?: string;
  avatarPath?: string;
  role?: string;
  isAdmin?: boolean;
  electrons?: number;
  manetrons?: number;
  heat?: number;
}

export interface CheckinRecord {
  date: string;
  streak: number;
  rewardElectrons?: number;
  rewardMagnetic?: number;
}

export interface CheckinSummary {
  checkedInToday: boolean;
  today?: { date: string; fortuneScore: number } | null;
  todayFortune?: { date: string; score: number };
  records?: CheckinRecord[];
  user?: MainSiteProfile;
  summary?: CheckinSummary;
}

export async function requestMainSite<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim();
  if (!token) throw new Error('请登录主站账号后重试。');
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok)
    throw new Error(payload?.message || `主站请求失败（HTTP ${response.status}）。`);
  if (payload === null) throw new Error('主站返回的数据暂时不可用。');
  return payload;
}
