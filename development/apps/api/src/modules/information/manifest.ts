import type { ModuleManifest } from '@freebbs-development/contracts';

export const INFORMATION_MANIFEST = {
  id: 'information',
  name: '信息与咨询',
  description: '发布透明信息并承接同学咨询。',
  route: '/information',
  icon: 'information',
  ownerTeam: 'liaison-rights',
  status: 'enabled',
  requiredPermissions: ['information.announcement.read'],
  order: 30,
} as const satisfies ModuleManifest;
