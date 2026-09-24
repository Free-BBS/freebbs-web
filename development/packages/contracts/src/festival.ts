import type { UserContext } from './auth.js';
import type { RoleKey } from './modules.js';

export type FestivalSubmissionStatus = 'private' | 'pending' | 'approved' | 'rejected';

export interface FestivalSubmission {
  id: string;
  title: string;
  description: string;
  authorName: string;
  ownerUid: string;
  status: FestivalSubmissionStatus;
  displayConsent: boolean;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewNote: string;
  canViewMedia: boolean;
}

export interface FestivalSubmissionList {
  items: FestivalSubmission[];
  page: number;
  pageSize: number;
  total: number;
  canReview: boolean;
  maxUploadBytes: number;
}

const reviewerRoles: readonly RoleKey[] = [
  'department.arts_member',
  'department.arts_director',
  'domain.arts_lead',
  'affiliation.tuanwei_lead',
  'platform.super_admin',
];

export function canReviewFestival(user: Pick<UserContext, 'roles'> | null | undefined): boolean {
  return user?.roles.some((role) => reviewerRoles.includes(role)) ?? false;
}
