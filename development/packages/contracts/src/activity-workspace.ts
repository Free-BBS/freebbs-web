import type { RegistrationSource, UnifiedRegistration } from './collections.js';
export interface ActivityContentBlock {
  id: string;
  kind: 'heading' | 'paragraph' | 'image' | 'video';
  text: string;
  assetId: string | null;
  caption: string;
}
export interface ActivityUpdate {
  id: string;
  label: string;
  occursAt: string;
  description: string;
  authorUid: string;
  createdAt: string;
  updatedAt: string;
}
export interface ActivityRecap {
  id: string;
  title: string;
  blocks: ActivityContentBlock[];
  authorUid: string;
  createdAt: string;
  updatedAt: string;
}
export interface ActivityWorkspaceAsset {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}
export interface ActivityWorkspace {
  schedule?: { startsAt: string | null; endsAt: string | null; finished: boolean };
  source: RegistrationSource;
  activityId: string;
  revision: number;
  activity: UnifiedRegistration;
  intro: ActivityContentBlock[];
  updates: ActivityUpdate[];
  recaps: ActivityRecap[];
  assets: ActivityWorkspaceAsset[];
  following: boolean;
  canEdit: boolean;
  canRecap: boolean;
  ended: boolean;
}
export interface ActivityNotification {
  id: string;
  source: RegistrationSource;
  activityId: string;
  title: string;
  body: string;
  link: string;
  createdAt: string;
  readAt: string | null;
}
export interface ActivityNotificationInbox {
  notifications: ActivityNotification[];
  unreadCount: number;
  nextCursor: string | null;
}
