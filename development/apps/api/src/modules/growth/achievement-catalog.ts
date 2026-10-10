import type { GrowthAchievement, GrowthActivity } from '@freebbs-development/contracts';
import { encodeUtcDateTime } from '../../core/database/date-codec.js';

export const GROWTH_DOMAINS = [
  { key: 'arts', label: '文艺', organization: 'arts_center', title: '舞台拾光者' },
  { key: 'sports', label: '体育', organization: 'sports_center', title: '运动同行者' },
  { key: 'liaison', label: '联络', organization: 'liaison_center', title: '联络搭桥者' },
  {
    key: 'rights',
    label: '权益发展',
    organization: 'rights_development_center',
    title: '权益守护者',
  },
  { key: 'tuanwei', label: '团委', organization: 'tuanwei', title: '青春同行者' },
  { key: 'sast', label: '科创', organization: 'sast', title: '科创探路者' },
  { key: 'tms', label: 'TMS', organization: 'tms', title: '思辨同行者' },
] as const;

const monthFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
});

function endedMonth(value: string | null): string | null {
  try {
    const date = encodeUtcDateTime(value);
    if (!date) return null;
    const parts = monthFormatter.formatToParts(date);
    return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
  } catch {
    // Legacy missing or invalid dates remain undated; never infer a calendar month.
    return null;
  }
}

export function growthAchievements(activities: readonly GrowthActivity[]): GrowthAchievement[] {
  const domainCounts = new Map<string, number>();
  const months = new Set<string>();
  for (const activity of activities) {
    domainCounts.set(activity.domain, (domainCounts.get(activity.domain) ?? 0) + 1);
    const month = endedMonth(activity.endsAt);
    if (month) months.add(month);
  }
  const domains = GROWTH_DOMAINS.filter((domain) => (domainCounts.get(domain.key) ?? 0) > 0).length;
  const badges: Omit<GrowthAchievement, 'unlocked'>[] = [
    ...[
      { id: 'first-step', title: '初次登场', target: 1 },
      { id: 'three-steps', title: '探索新芽', target: 3 },
      { id: 'steady-explorer', title: '持续探索', target: 5 },
      { id: 'ten-steps', title: '校园漫游者', target: 10 },
      { id: 'twenty-steps', title: '探索收藏家', target: 20 },
    ].map((badge) => ({
      ...badge,
      series: 'milestone' as const,
      icon: (
        { 1: 'sprout', 3: 'spark', 5: 'trail', 10: 'flag', 20: 'trophy' } as Record<number, string>
      )[badge.target],
      description: `累积 ${badge.target} 次已结束且未取消的活动报名记录`,
      progress: activities.length,
    })),
    ...GROWTH_DOMAINS.map((domain) => ({
      id: `specialty-${domain.key}`,
      title: domain.title,
      series: 'specialty' as const,
      icon: domain.key,
      domain: domain.key,
      description: `累积 ${domain.label}领域 3 次已结束且未取消的活动报名记录`,
      progress: domainCounts.get(domain.key) ?? 0,
      target: 3,
    })),
    ...[
      { id: 'two-domains', title: '双向探索者', target: 2 },
      { id: 'multi-domain', title: '跨界体验家', target: 3 },
      { id: 'five-domains', title: '多彩收藏家', target: 5 },
    ].map((badge) => ({
      ...badge,
      series: 'diversity' as const,
      icon: ({ 2: 'compass', 3: 'orbit', 5: 'rainbow' } as Record<number, string>)[badge.target],
      description: `在 ${badge.target} 个已知领域拥有已结束且未取消的活动报名记录（不含「其他」）`,
      progress: domains,
    })),
    ...[
      { id: 'two-months', title: '月间拾光', target: 2 },
      { id: 'three-months', title: '时光同行者', target: 3 },
      { id: 'six-months', title: '长程探索者', target: 6 },
    ].map((badge) => ({
      ...badge,
      series: 'rhythm' as const,
      icon: ({ 2: 'calendar', 3: 'moon', 6: 'hourglass' } as Record<number, string>)[badge.target],
      description: `已结束且未取消的活动报名记录覆盖 ${badge.target} 个不同月份（按北京时间的有效结束日期统计，无需连续）`,
      progress: months.size,
    })),
  ];
  return badges.map((badge) => ({ ...badge, unlocked: badge.progress >= badge.target }));
}
