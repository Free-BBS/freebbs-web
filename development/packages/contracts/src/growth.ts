export interface GrowthActivity {
  id: string;
  title: string;
  endsAt: string | null;
  domain: string;
  status: string;
}

export interface GrowthDomainCount {
  key: string;
  label: string;
  count: number;
}

export interface GrowthAchievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
  progress: number;
  target: number;
}

export interface GrowthSummary {
  total: number;
  basis: 'completed_registration';
  byDomain: GrowthDomainCount[];
  achievements: GrowthAchievement[];
  activities: GrowthActivity[];
}
