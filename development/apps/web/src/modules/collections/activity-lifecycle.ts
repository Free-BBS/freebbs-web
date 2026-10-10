import type { UnifiedRegistration } from '@freebbs-development/contracts';

export type ActivityStateKey = 'open' | 'upcoming' | 'closed' | 'ended';
export function activityState(
  item: UnifiedRegistration,
  now = Date.now(),
): { key: ActivityStateKey; label: string } {
  const ended =
    ['finished', 'ended', 'archived', 'cancelled'].includes(item.activityStatus ?? '') ||
    Boolean(item.endsAt && Date.parse(item.endsAt) <= now);
  if (ended) return { key: 'ended', label: '活动已结束' };
  if (item.status === 'upcoming') return { key: 'upcoming', label: '活动预告' };
  if (item.status === 'closed') return { key: 'closed', label: '报名已截止' };
  return { key: 'open', label: '正在报名' };
}
export function sortActivities(items: UnifiedRegistration[]): UnifiedRegistration[] {
  const time = (item: UnifiedRegistration) => Date.parse(item.startsAt || item.opensAt || '') || 0;
  return [...items].sort((a, b) => time(b) - time(a) || a.title.localeCompare(b.title, 'zh-CN'));
}
export function activityDate(value: string | null | undefined): string {
  if (!value || Number.isNaN(Date.parse(value))) return '待公布';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
export function localDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function timelineDate(value: string): string {
  if (Number.isNaN(Date.parse(value))) return '待公布';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (key: string) => parts.find((item) => item.type === key)?.value ?? '';
  return `${part('month')}.${part('day')} ${part('hour')}:${part('minute')}`;
}
