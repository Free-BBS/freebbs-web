import { describe, expect, it, vi } from 'vitest';

import { calculateTrending, CommunityTrendingCache } from './trending.js';

const now = new Date('2026-09-29T12:00:00.000Z');

function post(
  id: string,
  ownerUid: string,
  createdAt: string,
  status: 'active' | 'hidden' = 'active',
) {
  return {
    id,
    kind: 'daily' as const,
    title: id,
    ownerUid,
    status,
    scope: { type: 'public', id: '*' },
    createdAt,
    updatedAt: createdAt,
  };
}

describe('community trending', () => {
  it('ranks only recent public activity and ignores author self-interactions', () => {
    const posts = [
      post('popular', 'owner-a', '2026-09-29T08:00:00.000Z'),
      post('hidden', 'owner-b', '2026-09-29T09:00:00.000Z', 'hidden'),
      post('old', 'owner-c', '2026-09-27T09:00:00.000Z'),
    ];
    const likes = [
      {
        targetType: 'post' as const,
        targetId: 'popular',
        userUid: 'fan-a',
        status: 'active',
        createdAt: '2026-09-29T11:00:00.000Z',
      },
      {
        targetType: 'post' as const,
        targetId: 'popular',
        userUid: 'owner-a',
        status: 'active',
        createdAt: '2026-09-29T11:30:00.000Z',
      },
      {
        targetType: 'post' as const,
        targetId: 'hidden',
        userUid: 'fan-a',
        status: 'active',
        createdAt: '2026-09-29T11:30:00.000Z',
      },
      {
        targetType: 'post' as const,
        targetId: 'old',
        userUid: 'fan-a',
        status: 'active',
        createdAt: '2026-09-27T11:30:00.000Z',
      },
    ];
    const comments = Array.from({ length: 5 }, (_, index) => ({
      postId: 'popular',
      authorUid: 'fan-b',
      status: 'active',
      createdAt: `2026-09-29T11:0${index}:00.000Z`,
    }));
    const views = [
      {
        postId: 'popular',
        userUid: 'fan-c',
        status: 'active',
        bucketStart: '2026-09-29T11:00:00.000Z',
      },
      {
        postId: 'popular',
        userUid: 'fan-c',
        status: 'active',
        bucketStart: '2026-09-29T11:30:00.000Z',
      },
      {
        postId: 'popular',
        userUid: 'owner-a',
        status: 'active',
        bucketStart: '2026-09-29T11:30:00.000Z',
      },
    ];

    const result = calculateTrending(posts, likes, comments, views, now);

    expect(result.map(({ postId }) => postId)).toEqual(['popular']);
    expect(result[0]?.score).toBeGreaterThan(0);
    expect(result[0]?.score).toBeLessThan(100);
  });

  it('uses freshness to break comparable engagement and returns at most ten items', () => {
    const posts = Array.from({ length: 12 }, (_, index) =>
      post(
        `post-${index}`,
        `owner-${index}`,
        new Date(now.getTime() - index * 3_600_000).toISOString(),
      ),
    );
    const likes = posts.map((item) => ({
      targetType: 'post' as const,
      targetId: item.id,
      userUid: 'fan',
      status: 'active',
      createdAt: item.createdAt,
    }));

    const result = calculateTrending(posts, likes, [], [], now);

    expect(result).toHaveLength(10);
    expect(result[0]?.postId).toBe('post-0');
  });

  it('reuses a successful result for thirty seconds', async () => {
    let clock = now.getTime();
    const load = vi.fn().mockResolvedValue({ posts: [], likes: [], comments: [], views: [] });
    const cache = new CommunityTrendingCache(load, () => new Date(clock));

    const first = await cache.get();
    clock += 29_000;
    const second = await cache.get();
    clock += 2_000;
    await cache.get();

    expect(second).toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
    expect(first.generatedAt).toBe(now.toISOString());
  });
});
