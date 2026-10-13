export type AchievementFamily =
  'daily' | 'learning' | 'creation' | 'campus' | 'contribution' | 'map';

export const MINIAPP_ACHIEVEMENT_IDS = [
  'first-step',
  'steady-explorer',
  'ten-steps',
  'two-domains',
  'multi-domain',
  'two-months',
  'three-months',
  'map-landmarks-3',
  'map-night',
  'pioneer_call',
] as const;

export interface AtlasAchievement {
  id: string;
  title: string;
  description: string;
  family: AchievementFamily;
  icon: string;
  unlocked: boolean;
  progress: number;
  target: number;
  available: boolean;
  source: string;
  earnedAt?: string;
}

export interface MapBindingRequest {
  id: string;
  code: string;
  expiresAt: string;
  status: 'pending' | 'claimed' | 'confirmed' | 'expired';
  publicId?: string;
}

export interface MapConnectionStatus {
  configured: boolean;
  linked: boolean;
  publicId?: string;
  lastSyncedAt?: string;
  pending?: MapBindingRequest;
}

export interface MapEvidenceInput {
  id: string;
  landmarkId: string;
  periodId: string;
  type: 'activity' | 'landmark' | 'special';
  title: string;
  occurredAt: string;
  domain: 'arts' | 'sports' | 'liaison' | 'rights' | 'tuanwei' | 'sast' | 'tms' | 'other';
  activityId?: string;
  /** Compatibility field for old evidence; new incoming grants are ignored. */
  mapBadgeIds?: string[];
}

export interface MapEvidence extends MapEvidenceInput {
  uid: string;
  subjectHash: string;
  updatedAt: string;
}

export interface LearningAchievementEvidence {
  checkinDays: number;
  circuitCleared: number;
  circuitTotal: number;
  ownedAchievementIds: string[];
}

export interface AchievementAtlas {
  version: 1;
  uid: string;
  achievements: AtlasAchievement[];
  /** Separate metadata keeps the miniapp catalog small without losing selected web-only badges. */
  showcaseAchievements?: AtlasAchievement[];
  /** Earned retired badges remain collectible without filling the current catalog. */
  archivedAchievements?: AtlasAchievement[];
  showcaseIds: Array<string | null>;
  showcaseRevision: number;
  map: MapConnectionStatus;
  counts: { registration: number; verifiedActivity: number; mapExploration: number };
  sources: { learning: 'ready' | 'unavailable' | 'not_configured' };
  updatedAt: string;
}
