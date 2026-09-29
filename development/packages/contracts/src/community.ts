import type { ScopeRef } from './permissions.js';

export const COMMUNITY_POST_KINDS = ['daily', 'wish', 'festival_showcase'] as const;
export type CommunityPostKind = (typeof COMMUNITY_POST_KINDS)[number];

export const COMMUNITY_CHANNELS = ['all', 'daily', 'wishes', 'student_festival', 'rights'] as const;
export type CommunityChannel = (typeof COMMUNITY_CHANNELS)[number];

export const COMMUNITY_WISH_STATUSES = ['collecting', 'responded', 'planning', 'realized'] as const;
export type CommunityWishStatus = (typeof COMMUNITY_WISH_STATUSES)[number];

export type CommunityDisplayMode = 'named' | 'anonymous';
export type CommunityContentStatus = 'active' | 'hidden' | 'deleted' | 'frozen';

export interface CommunityAuthor {
  mode: CommunityDisplayMode;
  displayName: string;
  avatarUrl: string | null;
  isViewer: boolean;
}

export interface CommunityCapabilities {
  canEdit: boolean;
  canDelete: boolean;
  canComment: boolean;
  canSupplement: boolean;
  canReport: boolean;
  canModerate: boolean;
  canRespondToWish: boolean;
  canTransitionWish: boolean;
  canRequestConversion: boolean;
  canApproveConversion: boolean;
}

export interface CommunityFeedItem {
  id: string;
  kind: CommunityPostKind;
  title: string;
  body: string;
  tags: string[];
  author: CommunityAuthor;
  status: CommunityContentStatus;
  wishStatus: CommunityWishStatus | null;
  officialResponse: string | null;
  conversionStatus: 'none' | 'requested' | 'approved' | null;
  linkedActivityId: string | null;
  createdAt: string;
  updatedAt: string;
  likeCount: number;
  commentCount: number;
  likedByViewer: boolean;
  capabilities: CommunityCapabilities;
}

export interface CommunityComment {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  author: CommunityAuthor;
  status: CommunityContentStatus;
  createdAt: string;
  updatedAt: string;
  likeCount: number;
  likedByViewer: boolean;
}

export interface CommunitySupplement {
  id: string;
  postId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityThreadDetail {
  item: CommunityFeedItem;
  comments: CommunityComment[];
  supplements: CommunitySupplement[];
}

export interface CommunityTrendingItem {
  postId: string;
  title: string;
  kind: CommunityPostKind;
  score: number;
  rankChange: number | null;
}

export interface CommunityTrendingPayload {
  items: CommunityTrendingItem[];
  generatedAt: string;
}

export interface CreateCommunityPostInput {
  kind: Extract<CommunityPostKind, 'daily' | 'wish'>;
  title: string;
  body: string;
  tags: string[];
  displayMode: CommunityDisplayMode;
}

export interface CreateCommunityCommentInput {
  body: string;
  parentId: string | null;
  displayMode: CommunityDisplayMode;
}

export interface CommunityWishConversionInput {
  title: string;
  description: string;
  organizationId: string;
  startsAt: string | null;
}

export interface CommunityWishTransitionInput {
  to: CommunityWishStatus;
}

export interface CommunityPostRecordShape {
  ownerUid: string;
  scope: ScopeRef;
}
