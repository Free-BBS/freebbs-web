import type { ModuleManifest } from '@freebbs-development/contracts';

export const EVENTS_MANIFEST = {
  id: 'events',
  name: 'Events',
  description: 'Manage activities and personal registrations.',
  route: '/events',
  icon: 'events',
  ownerTeam: 'cross-domain',
  status: 'enabled',
  requiredPermissions: ['events.read'],
  order: 50,
} as const satisfies ModuleManifest;
