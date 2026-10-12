import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { departmentById, type PublishingContent } from '@freebbs-development/contracts';
import { featureStorage } from '../../core/database/feature-storage.js';
import { HttpError } from '../../core/errors/http-error.js';
import { safePublishingUrl } from '../publishing/domain.js';

interface StoredArticle extends PublishingContent {
  reactions: Array<{ uid: string; liked: boolean; rating: number }>;
  feedId?: string;
}
interface FeedRun {
  id: string;
  date: string;
  status: 'running' | 'completed' | 'failed';
  at: string;
  error: string;
  imported: number;
}
const feed = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            title: z.string().trim().min(1).max(160),
            url: z.string().max(2048).refine(safePublishingUrl),
            summary: z.string().max(4000).default(''),
            publishedAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export function feedDate(now: Date) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function feedIsDue(now: Date, lastDate: string) {
  return (
    new Date(now.getTime() + 8 * 60 * 60 * 1000).getUTCHours() >= 20 && lastDate !== feedDate(now)
  );
}
export async function syncArticleFeed(
  directory: string,
  environment: NodeJS.ProcessEnv,
  fetcher: typeof fetch = fetch,
) {
  const address = environment.DEVELOPMENT_ARTICLE_FEED_URL;
  const ownerUid = environment.DEVELOPMENT_FEED_OWNER_UID;
  if (!address || !ownerUid)
    throw new HttpError(503, 'connector_not_configured', '栏目供稿接口与发布账号尚未配置');
  if (!safePublishingUrl(address))
    throw new HttpError(503, 'connector_invalid', '栏目供稿接口须使用HTTPS');
  const departmentId = environment.DEVELOPMENT_FEED_DEPARTMENT_ID ?? null;
  if (departmentId && !departmentById(departmentId))
    throw new HttpError(503, 'connector_invalid', '栏目所属部门无效');
  let input: unknown;
  try {
    const response = await fetcher(address, {
      headers: {
        Accept: 'application/json',
        ...(environment.DEVELOPMENT_ADAPTER_TOKEN
          ? { Authorization: `Bearer ${environment.DEVELOPMENT_ADAPTER_TOKEN}` }
          : {}),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || !response.body) throw new Error('feed unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1024 * 1024) throw new Error('feed too large');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(502, 'feed_unavailable', '栏目供稿接口暂不可用');
  }
  const parsed = feed.safeParse(input);
  if (
    !parsed.success ||
    new Set(parsed.data.items.map((item) => item.id)).size !== parsed.data.items.length
  )
    throw new HttpError(502, 'feed_invalid', '供稿数据格式或文章链接无效');
  const storage = featureStorage<StoredArticle>(directory, 'publishing');
  for (const article of parsed.data.items) {
    const id = `feed-${createHash('sha256')
      .update(JSON.stringify([address, article.id]))
      .digest('hex')}`;
    await storage.change(id, (previous) => ({
      record: {
        id,
        ownerUid,
        departmentId,
        category: 'article',
        title: article.title,
        text: article.summary,
        links: [{ label: '阅读原文', url: article.url }],
        images: [],
        tags: ['无限之声'],
        course: '',
        year: '',
        author: '无限之声',
        recommendation: '',
        schedule: [],
        audience: previous?.audience ?? 'all',
        status: previous?.status ?? 'published',
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? article.publishedAt,
        updatedAt: new Date().toISOString(),
        reactions: previous?.reactions ?? [],
        likeCount: 0,
        ratingCount: 0,
        ratingAverage: 0,
        feedId: article.id,
      },
      result: null,
    }));
  }
  return { imported: parsed.data.items.length };
}
/** Only configured runtimes poll. Scheduling is fixed to 20:00 Asia/Shanghai. */
export function startFeedScheduler(
  directory: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (
    !directory ||
    !environment.DEVELOPMENT_ARTICLE_FEED_URL ||
    !environment.DEVELOPMENT_FEED_OWNER_UID ||
    (environment.NODE_ENV === 'production' && !isAbsolute(directory))
  )
    return () => {};
  const state = featureStorage<FeedRun>(directory, 'feed-runs');
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const now = new Date();
      const date = feedDate(now);
      if (!feedIsDue(now, (await state.get('daily'))?.date ?? '')) return;
      const claimed = await state.change('daily', (current) =>
        current?.date === date
          ? { record: current, result: false }
          : {
              record: {
                id: 'daily',
                date,
                status: 'running',
                at: now.toISOString(),
                error: '',
                imported: 0,
              },
              result: true,
            },
      );
      if (!claimed) return;
      try {
        const result = await syncArticleFeed(directory, environment);
        await state.change('daily', (current) => ({
          record: { ...current!, status: 'completed', imported: result.imported },
          result: null,
        }));
      } catch {
        await state.change('daily', (current) => ({
          record: {
            ...current!,
            status: 'failed',
            error: '栏目更新失败，请检查授权供稿接口后手动重试',
          },
          result: null,
        }));
      }
    } catch {
      console.error('[development-feed] scheduled update could not complete');
    } finally {
      busy = false;
    }
  };
  const interval = setInterval(() => void tick(), 60000);
  interval.unref();
  void tick();
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}
