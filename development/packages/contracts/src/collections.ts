import type { SocialOrganizationId } from './organizations.js';

export type RegistrationSource = 'learning_survey' | 'development_activity' | 'native_collection';

export type CollectionFieldKind =
  | 'instructions'
  | 'identity'
  | 'short_text'
  | 'long_text'
  | 'single_choice'
  | 'multiple_choice'
  | 'datetime'
  | 'file'
  | 'image'
  | 'video'
  | 'audio';

export type CollectionRuleKind =
  | 'audience'
  | 'required'
  | 'attempt_limit'
  | 'upload_count'
  | 'file_types'
  | 'file_size'
  | 'title_pattern'
  | 'schedule'
  | 'capacity';

export interface CollectionRule {
  id: string;
  kind: CollectionRuleKind;
  value: string | number | boolean | string[] | { start?: string; end?: string };
}

export interface CollectionField {
  id: string;
  kind: CollectionFieldKind;
  label: string;
  helpText: string;
  options: string[];
  rules: CollectionRule[];
}

export interface CollectionSchema {
  title: string;
  description: string;
  fields: CollectionField[];
  formRules: CollectionRule[];
}

export type CollectionStatus = 'draft' | 'published' | 'closed' | 'archived';

export interface CollectionFormSummary {
  id: string;
  title: string;
  description: string;
  coverUrl: string | null;
  organizationId: SocialOrganizationId | null;
  status: CollectionStatus;
  opensAt: string | null;
  closesAt: string | null;
  capacity: number | null;
  responseCount: number;
  canManage: boolean;
  schema?: CollectionSchema;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionResponseSummary {
  id: string;
  formId: string;
  formTitle: string;
  source: RegistrationSource;
  submittedAt: string;
  status: 'submitted' | 'cancelled';
}

export interface UnifiedRegistration {
  id: string;
  source: RegistrationSource;
  title: string;
  description: string;
  organizer: string;
  coverUrl: string | null;
  opensAt: string | null;
  closesAt: string | null;
  location: string | null;
  capacity: number | null;
  registrationCount: number | null;
  registered: boolean;
  status: 'open' | 'upcoming' | 'closed';
  schema?: CollectionSchema;
}

export interface ShowcaseArticle {
  id: string;
  title: string;
  excerpt: string;
  body: string;
  coverUrl: string | null;
  externalUrl: string | null;
  organizationName: string;
  publishedAt: string;
  likeCount: number;
  liked: boolean;
}

export interface CollectionsDashboardPayload {
  featured: UnifiedRegistration[];
  showcase: ShowcaseArticle[];
  canCreate: boolean;
}
