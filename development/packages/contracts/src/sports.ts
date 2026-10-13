import type { ScopeRef } from './permissions.js';

export interface SportsTeamHomepage {
  teamId: string;
  html: string | null;
  originalFilename: string | null;
  revision: number;
  updatedAt: string | null;
  editor: { uid: string; displayName: string; avatarUrl: string | null } | null;
  canEdit: boolean;
}

export interface SportsCapabilities {
  canCreate: boolean;
}

export type SportsMatchStatus = 'upcoming' | 'live' | 'ended';

export interface SportsMatch {
  id: string;
  title: string;
  coverUrl: string | null;
  startsAt: string;
  endsAt: string;
  location: string;
  result: string | null;
  liveUrl: string | null;
  replayUrl: string | null;
  ownerUid: string;
  scope: ScopeRef;
  status: string;
  createdAt: string;
  updatedAt: string;
  matchStatus: SportsMatchStatus;
}

export interface SportsTeamShowcase {
  id: string;
  teamId: string;
  markdown: string;
  updatedByUid: string;
  ownerUid: string;
  scope: ScopeRef;
  status: string;
  createdAt: string;
  updatedAt: string;
}
