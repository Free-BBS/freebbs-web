import type { ModuleManifest } from '@freebbs-development/contracts';

export const SPORTS_MANIFEST = {
  id: 'sports',
  name: '無体育',
  description: '马杯赛程、体育代表队与队伍风采。',
  route: '/sports',
  icon: 'sports',
  ownerTeam: 'sports',
  status: 'enabled',
  requiredPermissions: ['sports.team.read'],
  order: 70,
} as const satisfies ModuleManifest;
