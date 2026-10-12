import type {
  CommunityChannel,
  CommunityFeedItem,
  CommunityWishStatus,
} from '@freebbs-development/contracts';

export const COMMUNITY_CHANNEL_OPTIONS: ReadonlyArray<{
  value: CommunityChannel;
  label: string;
}> = [
  { value: 'all', label: '综合' },
  { value: 'daily', label: '校园日常' },
  { value: 'wishes', label: '新生许愿池' },
  { value: 'student_festival', label: '电子系春晚' },
  { value: 'rights', label: '生权反馈' },
];

const wishLabels: Readonly<Record<CommunityWishStatus, string>> = {
  collecting: '征集中',
  responded: '已回应',
  planning: '筹备中',
  realized: '已实现',
};

export function wishStatusLabel(status: CommunityWishStatus): string {
  return wishLabels[status];
}

export function toggleFeedLike(item: CommunityFeedItem): CommunityFeedItem {
  const likedByViewer = !item.likedByViewer;
  return {
    ...item,
    likedByViewer,
    likeCount: Math.max(0, item.likeCount + (likedByViewer ? 1 : -1)),
  };
}
