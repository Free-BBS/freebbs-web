import type { ScopeRef } from './permissions.js';

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
