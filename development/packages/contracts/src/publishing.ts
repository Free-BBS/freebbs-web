export const PUBLISHING_CATEGORIES = [
  'article',
  'notices',
  'schedules',
  'public_info',
  'guides',
  'resources',
  'contacts',
  'course_experience',
  'work_experience',
  'practice_channels',
  'book_share',
] as const;
export type PublishingCategory = (typeof PUBLISHING_CATEGORIES)[number];
export interface PublishingContent {
  id: string;
  ownerUid: string;
  departmentId: string | null;
  category: PublishingCategory;
  title: string;
  text: string;
  links: Array<{ label: string; url: string }>;
  images: string[];
  tags: string[];
  course: string;
  year: string;
  author: string;
  recommendation: string;
  schedule: Array<{ date: string; title: string; url: string }>;
  audience: 'all' | 'department';
  status: 'draft' | 'published' | 'archived';
  revision: number;
  createdAt: string;
  updatedAt: string;
  canManage?: boolean;
  likeCount: number;
  ratingCount: number;
  ratingAverage: number;
  liked?: boolean;
  myRating?: number;
}
export interface PublishingList {
  items: PublishingContent[];
  canCreate: boolean;
  availableCategories?: PublishingCategory[];
}
