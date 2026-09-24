import type { ModuleManifest } from '@freebbs-development/contracts';
import { EVENTS_MANIFEST } from '../../modules/events/manifest.js';
import { FINANCE_MANIFEST } from '../../modules/finance/manifest.js';
import { INFORMATION_MANIFEST } from '../../modules/information/manifest.js';
import { KNOWLEDGE_MANIFEST } from '../../modules/knowledge/manifest.js';
import { LIAISON_MANIFEST } from '../../modules/liaison/manifest.js';
import { SPORTS_MANIFEST } from '../../modules/sports/manifest.js';

export const MODULE_MANIFESTS: readonly ModuleManifest[] = [
  {
    id: 'dashboard',
    name: '工作台',
    description: '汇总平台入口、动态与待办。',
    route: '/dashboard',
    icon: 'dashboard',
    ownerTeam: 'platform-core',
    status: 'enabled',
    requiredPermissions: ['dashboard.read'],
    order: 10,
  },
  KNOWLEDGE_MANIFEST,

  INFORMATION_MANIFEST,

  {
    id: 'growth',
    name: 'Personal growth archive',
    description: 'Private participation history and earned achievement titles.',
    route: '/growth',
    icon: 'growth',
    ownerTeam: 'platform-core',
    status: 'enabled',
    requiredPermissions: [],
    order: 70,
  },

  EVENTS_MANIFEST,

  LIAISON_MANIFEST,

  SPORTS_MANIFEST,
  FINANCE_MANIFEST,

  {
    id: 'admin',
    name: '权限与模块管理',
    description: '管理模块、角色、标签与审计记录。',
    route: '/admin',
    icon: 'admin',
    ownerTeam: 'platform-core',
    status: 'enabled',
    requiredPermissions: ['admin.manage'],
    order: 90,
  },
] as const;
