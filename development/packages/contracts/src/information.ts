import type { ScopeRef } from './permissions.js';

export type InformationVisibility = 'public' | 'private';
export type InformationTargetType = 'announcement' | 'consultation';
export type InformationReplyKind = 'reply' | 'supplement';
export type InformationFeedFilter =
  'all' | 'official' | 'public_feedback' | 'mine' | 'in_progress' | 'resolved';

interface InformationFeedItemBase {
  id: string;
  title: string;
  body: string;
  scope: ScopeRef;
  createdAt: string;
  updatedAt: string;
  likeCount: number;
  replyCount: number;
  likedByViewer: boolean;
  canReply: boolean;
  canManage: boolean;
}

export interface InformationAnnouncementFeedItem extends InformationFeedItemBase {
  kind: 'announcement';
  status: 'draft' | 'published' | 'archived';
  ownerUid: string;
  pinned: boolean;
}

export interface InformationConsultationFeedItem extends InformationFeedItemBase {
  kind: 'consultation';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  visibility: InformationVisibility;
  requesterUid: string;
  assigneeUid: string | null;
  dueAt: string | null;
}

export type InformationFeedItem = InformationAnnouncementFeedItem | InformationConsultationFeedItem;

export interface InformationReply {
  id: string;
  targetType: InformationTargetType;
  targetId: string;
  authorUid: string;
  kind: InformationReplyKind;
  body: string;
  createdAt: string;
  updatedAt: string;
}
