import type { ModuleManifest } from '@freebbs-development/contracts';

export const CLUBS_MANIFEST = {
  id: 'clubs',
  name: 'Interest groups',
  description: 'Discover, maintain, join, and leave student interest groups.',
  route: '/interest-groups',
  icon: 'clubs',
  ownerTeam: 'liaison',
  status: 'enabled',
  requiredPermissions: ['clubs.read'],
  order: 40,
} as const satisfies ModuleManifest;
