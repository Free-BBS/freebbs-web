import type { ModuleManifest } from '@freebbs-development/contracts';

export const LIAISON_MANIFEST = {
  id: 'liaison',
  name: '無限机会',
  description: '汇集真实问题委托，支持发现机会、组队协作与成果沉淀。',
  route: '/liaison',
  icon: 'liaison',
  ownerTeam: 'liaison',
  status: 'enabled',
  requiredPermissions: ['liaison.resource.read'],
  order: 60,
} as const satisfies ModuleManifest;
