import type { ModuleManifest } from '@freebbs-development/contracts';

export const KNOWLEDGE_MANIFEST = {
  id: 'knowledge',
  name: '经验库',
  description: '沉淀流程、问答、联系人和活动复盘。',
  route: '/knowledge',
  icon: 'knowledge',
  ownerTeam: 'platform-core',
  status: 'enabled',
  requiredPermissions: ['knowledge.read'],
  order: 20,
} as const satisfies ModuleManifest;
