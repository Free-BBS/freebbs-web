import { describe, expect, it } from 'vitest';
import {
  buildCandidates,
  dailyDeck,
  normalizePreferences,
  preferenceKey,
  type Candidate,
} from './model.js';
import { safeMapUrl } from './site-config.js';

const now = new Date('2026-09-14T10:00:00Z');
const config = {
  enabled: true,
  allowedKinds: ['activity', 'knowledge'] as const,
  excludedKeys: [],
  suggestedInterests: ['运动'],
};
const item = (id: string, text = '音乐'): Candidate => ({
  key: `knowledge:${id}`,
  kind: 'knowledge',
  title: text,
  summary: text,
  searchText: text,
  href: `/knowledge/${id}`,
});

describe('daily discovery', () => {
  it('only includes current public content and honors site exclusions', () => {
    const candidates = buildCandidates(
      {
        activities: [
          {
            id: 'future',
            title: '夜跑',
            description: '运动',
            status: 'published',
            startsAt: '2026-09-15T10:00:00Z',
          },
          { id: 'past', title: '已过期', status: 'published', startsAt: '2026-09-12T10:00:00Z' },
          { id: 'invalid', title: '坏日期', status: 'published', startsAt: 'bad' },
          { id: 'draft', title: '草稿', status: 'draft', startsAt: null },
        ],
        knowledge: [
          {
            id: 'guide',
            title: '指南',
            body: '活动流程',
            status: 'published',
            audience: 'general',
          },
          { id: 'private', title: '内部', status: 'published', audience: 'social_org' },
          { id: 'draft', title: '草稿', status: 'draft' },
        ],
      },
      now,
      config,
    );
    expect(candidates.map((entry) => entry.key)).toEqual(['activity:future', 'knowledge:guide']);
  });
  it('uses stable daily ordering, filters kinds/window and can strictly match interests', () => {
    const candidates = [
      item('1', '跑步运动'),
      item('2', '音乐'),
      item('3', '摄影'),
      {
        ...item('4', '运动'),
        key: 'activity:4',
        kind: 'activity' as const,
        startsAt: '2026-12-14T10:00:00Z',
      },
    ];
    const prefs = normalizePreferences({
      interests: ['运动'],
      kinds: ['knowledge', 'activity'],
      explore: false,
      days: 30,
    });
    expect(dailyDeck(candidates, prefs, 'u1', now).map((entry) => entry.key)).toEqual([
      'knowledge:1',
    ]);
    const mixed = { ...prefs, explore: true };
    expect(dailyDeck(candidates, mixed, 'u1', now)).toEqual(
      dailyDeck([...candidates].reverse(), mixed, 'u1', now),
    );
    expect(dailyDeck(candidates, mixed, 'u1', now)).toHaveLength(3);
    expect(new Set(dailyDeck(candidates, mixed, 'u1', now).map((entry) => entry.key)).size).toBe(3);
  });
  it('bounds malformed preferences and isolates account storage', () => {
    expect(
      normalizePreferences({
        kinds: [],
        days: -1,
        interests: ['  跑步 ', '跑步', 12],
        explore: 'no',
      }),
    ).toEqual({
      kinds: ['activity', 'knowledge'],
      interests: ['跑步'],
      days: 30,
      explore: true,
    });
    expect(normalizePreferences(null).interests).toEqual([]);
    expect(preferenceKey('a')).not.toBe(preferenceKey('b'));
  });
  it('accepts HTTPS map links and rejects executable or credential-bearing URLs', () => {
    expect(safeMapUrl(' https://wxaurl.cn/example ')).toBe('https://wxaurl.cn/example');
    for (const value of [
      'javascript:alert(1)',
      '//example.com',
      'https://user:pass@example.com',
      '',
      'weixin://test',
    ])
      expect(safeMapUrl(value)).toBeNull();
  });
});
