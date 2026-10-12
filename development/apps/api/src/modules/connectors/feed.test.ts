import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { syncArticleFeed, feedIsDue } from './feed.js';
import { featureStorage } from '../../core/database/feature-storage.js';
import type { PublishingContent } from '@freebbs-development/contracts';

it.each(['draft', 'published', 'archived'] as const)(
  'preserves editorial %s status and department audience during refresh',
  async (status) => {
    const directory = await mkdtemp(join(tmpdir(), 'feed-editorial-'));
    const environment = {
      DEVELOPMENT_ARTICLE_FEED_URL: 'https://feed.example/articles',
      DEVELOPMENT_FEED_OWNER_UID: 'publisher',
      DEVELOPMENT_FEED_DEPARTMENT_ID: 'student_union.rights_development_center',
    };
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'editorial',
              title: 'New title',
              url: 'https://example.com/post',
              publishedAt: '2026-10-01T12:00:00Z',
            },
          ],
        }),
      );
    try {
      await syncArticleFeed(directory, environment, fetcher);
      const storage = featureStorage<PublishingContent>(directory, 'publishing');
      const article = (await storage.list())[0]!;
      expect(article.status).toBe('published');
      expect(article.audience).toBe('all');
      await storage.change(article.id, (previous) => ({
        record: { ...previous!, status, audience: 'department' },
        result: null,
      }));
      await syncArticleFeed(directory, environment, fetcher);
      expect(await storage.get(article.id)).toMatchObject({
        status,
        audience: 'department',
        title: 'New title',
        revision: 2,
      });
      expect(await storage.list()).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it('uses stable opaque route-safe IDs scoped to the source and preserves original external IDs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feed-route-'));
  const ids = ['posts/42', 'https://example.com/posts/42?lang=zh#heading', 'post?lang=zh#fragment'];
  const environment = {
    DEVELOPMENT_ARTICLE_FEED_URL: 'https://feed.example/articles',
    DEVELOPMENT_FEED_OWNER_UID: 'publisher',
  };
  const fetcher = async () =>
    new Response(
      JSON.stringify({
        items: ids.map((id) => ({
          id,
          title: id,
          url: 'https://example.com/post',
          publishedAt: '2026-10-01T12:00:00Z',
        })),
      }),
    );
  try {
    const storage = featureStorage<PublishingContent & { feedId: string }>(directory, 'publishing');
    await syncArticleFeed(directory, environment, fetcher);
    const first = await storage.list();
    expect(first.map((article) => article.feedId).sort()).toEqual([...ids].sort());
    for (const article of first) {
      expect(article.id).toMatch(/^feed-[a-f0-9]{64}$/);
      expect(
        new URL(`/publishing/${article.id}`, 'https://local.example').pathname.split('/'),
      ).toHaveLength(3);
    }
    await syncArticleFeed(directory, environment, fetcher);
    expect((await storage.list()).map((article) => article.id).sort()).toEqual(
      first.map((article) => article.id).sort(),
    );
    await syncArticleFeed(
      directory,
      { ...environment, DEVELOPMENT_ARTICLE_FEED_URL: 'https://other.example/articles' },
      fetcher,
    );
    expect(await storage.list()).toHaveLength(6);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('imports configured HTTPS articles idempotently and preserves reactions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'article-feed-'));
  const environment = {
    DEVELOPMENT_ARTICLE_FEED_URL: 'https://feed.example/articles',
    DEVELOPMENT_FEED_OWNER_UID: 'publisher',
  };
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'post-1',
              title: '无限之声',
              url: 'https://mp.weixin.qq.com/s/example',
              summary: '新栏目',
              publishedAt: '2026-10-01T12:00:00Z',
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  try {
    expect(await syncArticleFeed(directory, environment, fetcher)).toEqual({ imported: 1 });
    const storage = featureStorage<{
      id: string;
      reactions: Array<{ uid: string; liked: boolean; rating: number }>;
    }>(directory, 'publishing');
    const item = (await storage.list())[0]!;
    await storage.change(item.id, (record) => ({
      record: { ...record!, reactions: [{ uid: 'reader', liked: true, rating: 0 }] },
      result: null,
    }));
    await syncArticleFeed(directory, environment, fetcher);
    expect(await storage.list()).toHaveLength(1);
    expect((await storage.get(item.id))?.reactions).toHaveLength(1);
    expect(fetcher).toHaveBeenCalled();
    expect(feedIsDue(new Date('2026-10-10T11:59:00Z'), '')).toBe(false);
    expect(feedIsDue(new Date('2026-10-10T12:00:00Z'), '')).toBe(true);
    expect(feedIsDue(new Date('2026-10-10T13:00:00Z'), '2026-10-10')).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('rejects unconfigured feeds and unsafe article links without creating published records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'invalid-feed-'));
  try {
    await expect(syncArticleFeed(directory, {})).rejects.toMatchObject({
      code: 'connector_not_configured',
    });
    await expect(
      syncArticleFeed(
        directory,
        {
          DEVELOPMENT_ARTICLE_FEED_URL: 'https://feed.example',
          DEVELOPMENT_FEED_OWNER_UID: 'publisher',
        },
        async () =>
          new Response(
            JSON.stringify({
              items: [
                {
                  id: 'x',
                  title: 'x',
                  url: 'javascript:alert(1)',
                  publishedAt: '2026-10-01T12:00:00Z',
                },
              ],
            }),
          ),
      ),
    ).rejects.toMatchObject({ code: 'feed_invalid' });
    expect(await featureStorage<{ id: string }>(directory, 'publishing').list()).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
