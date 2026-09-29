import type { CommunityPostKind, CommunityTrendingPayload } from '@freebbs-development/contracts';

interface TrendingPost {
  id: string;
  kind: CommunityPostKind;
  title: string;
  ownerUid: string;
  status: string;
  scope: { type: string; id: string };
  createdAt: string;
  updatedAt: string;
}

interface TrendingLike {
  targetType: 'post' | 'comment';
  targetId: string;
  userUid: string;
  status: string;
  createdAt: string;
}

interface TrendingComment {
  postId: string;
  authorUid: string;
  status: string;
  createdAt: string;
}

interface TrendingView {
  postId: string;
  userUid: string;
  status: string;
  bucketStart: string;
}

export interface TrendingSource {
  posts: readonly TrendingPost[];
  likes: readonly TrendingLike[];
  comments: readonly TrendingComment[];
  views: readonly TrendingView[];
}

const windowMilliseconds = 24 * 60 * 60 * 1000;

function inWindow(value: string, lowerBound: number, upperBound: number): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= lowerBound && timestamp <= upperBound;
}

export function calculateTrending(
  posts: readonly TrendingPost[],
  likes: readonly TrendingLike[],
  comments: readonly TrendingComment[],
  views: readonly TrendingView[],
  now: Date,
): CommunityTrendingPayload['items'] {
  const upperBound = now.getTime();
  const lowerBound = upperBound - windowMilliseconds;

  return posts
    .filter(
      (post) => post.status === 'active' && post.scope.type === 'public' && post.scope.id === '*',
    )
    .flatMap((post) => {
      const postLikes = likes.filter(
        (like) =>
          like.targetType === 'post' &&
          like.targetId === post.id &&
          like.userUid !== post.ownerUid &&
          like.status === 'active' &&
          inWindow(like.createdAt, lowerBound, upperBound),
      );
      const uniqueLikes = new Set(postLikes.map(({ userUid }) => userUid)).size;

      const commentCounts = new Map<string, number>();
      const postComments = comments.filter(
        (comment) =>
          comment.postId === post.id &&
          comment.authorUid !== post.ownerUid &&
          comment.status === 'active' &&
          inWindow(comment.createdAt, lowerBound, upperBound),
      );
      for (const comment of postComments) {
        commentCounts.set(
          comment.authorUid,
          Math.min(3, (commentCounts.get(comment.authorUid) ?? 0) + 1),
        );
      }
      const effectiveComments = [...commentCounts.values()].reduce((sum, count) => sum + count, 0);

      const postViews = views.filter(
        (view) =>
          view.postId === post.id &&
          view.userUid !== post.ownerUid &&
          view.status === 'active' &&
          inWindow(view.bucketStart, lowerBound, upperBound),
      );
      const uniqueViews = new Set(postViews.map(({ userUid }) => userUid)).size;
      const raw = uniqueLikes * 3 + effectiveComments * 5 + Math.log(1 + uniqueViews) * 4;
      if (raw <= 0) return [];

      const interactionTimes = [
        ...postLikes.map(({ createdAt }) => Date.parse(createdAt)),
        ...postComments.map(({ createdAt }) => Date.parse(createdAt)),
        ...postViews.map(({ bucketStart }) => Date.parse(bucketStart)),
      ].filter(Number.isFinite);
      const latestInteraction = Math.max(Date.parse(post.updatedAt), ...interactionTimes);
      const hoursSinceInteraction = Math.max(0, (upperBound - latestInteraction) / 3_600_000);
      const score = raw / (hoursSinceInteraction + 2) ** 0.8;
      return [
        {
          postId: post.id,
          title: post.title,
          kind: post.kind,
          score: Number(score.toFixed(3)),
          rankChange: null,
          latestInteraction,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.latestInteraction - left.latestInteraction ||
        left.postId.localeCompare(right.postId),
    )
    .slice(0, 10)
    .map((item) => ({
      postId: item.postId,
      title: item.title,
      kind: item.kind,
      score: item.score,
      rankChange: item.rankChange,
    }));
}

export class CommunityTrendingCache {
  private cached: CommunityTrendingPayload | null = null;

  constructor(
    private readonly load: () => Promise<TrendingSource>,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMilliseconds = 30_000,
  ) {}

  async get(): Promise<CommunityTrendingPayload> {
    const current = this.now();
    if (
      this.cached !== null &&
      current.getTime() - Date.parse(this.cached.generatedAt) < this.ttlMilliseconds
    ) {
      return this.cached;
    }
    try {
      const source = await this.load();
      this.cached = {
        items: calculateTrending(
          source.posts,
          source.likes,
          source.comments,
          source.views,
          current,
        ),
        generatedAt: current.toISOString(),
      };
      return this.cached;
    } catch (error) {
      if (this.cached !== null) return this.cached;
      throw error;
    }
  }
}
