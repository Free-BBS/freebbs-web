import type { ModuleManifest } from '@freebbs-development/contracts';

export const FINANCE_MANIFEST = {
  id: 'finance',
  name: 'Finance governance',
  description: 'Manage auditable budgets and settlements in integer cents.',
  route: '/finance',
  icon: 'finance',
  ownerTeam: 'rights-development',
  status: 'enabled',
  requiredPermissions: ['finance.record.read'],
  order: 80,
} as const satisfies ModuleManifest;
