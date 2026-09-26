import type { ModuleId, ModuleManifest, ModuleStatus } from '@freebbs-development/contracts';

import adminIcon from '../assets/icons/admin.svg';
import dashboardIcon from '../assets/icons/dashboard.svg';
import eventsIcon from '../assets/icons/events.svg';
import financeIcon from '../assets/icons/finance.svg';
import growthIcon from '../assets/icons/growth.svg';
import informationIcon from '../assets/icons/information.svg';
import knowledgeIcon from '../assets/icons/knowledge.svg';
import liaisonIcon from '../assets/icons/liaison.svg';
import collectionsIcon from '../assets/icons/collections.svg';
import sportsIcon from '../assets/icons/sports.svg';
import {
  hasPresentationPermission,
  isSuperAdmin,
  type PresentationUser,
} from '../core/permissions/Can.js';

export type ModuleStateOverrides = Partial<
  Record<ModuleId, ModuleStatus | boolean | { enabled: boolean }>
>;

export const MODULE_MANIFESTS: readonly ModuleManifest[] = [
  {
    id: 'dashboard',
    name: '工作台',
    description: '集中查看平台动态、待办事项与常用入口。',
    route: '/dashboard',
    icon: dashboardIcon,
    ownerTeam: '平台核心组',
    status: 'enabled',
    requiredPermissions: [],
    order: 0,
  },
  {
    id: 'knowledge',
    name: '经验库',
    description: '沉淀组织经验、工作流程与培养资料。',
    route: '/knowledge',
    icon: knowledgeIcon,
    ownerTeam: '平台核心组',
    status: 'enabled',
    requiredPermissions: [],
    order: 6,
  },
  {
    id: 'information',
    name: '信息与咨询',
    description: '公开信息、接受咨询并跟踪反馈处理。',
    route: '/information',
    icon: informationIcon,
    ownerTeam: '权益发展团队',
    status: 'enabled',
    requiredPermissions: [],
    order: 5,
  },
  {
    id: 'growth',
    name: '个人成长档案',
    description: '汇总个人活动参与、领域经历与成就称号。',
    route: '/growth',
    icon: growthIcon,
    ownerTeam: '平台核心组',
    status: 'enabled',
    requiredPermissions: [],
    order: 7,
  },
  {
    id: 'events',
    name: '無活动',
    description: '发起活动、报名参与并跟踪活动流程。',
    route: '/events',
    icon: eventsIcon,
    ownerTeam: '活动团队',
    status: 'enabled',
    requiredPermissions: [],
    order: 1,
  },
  {
    id: 'collections',
    name: '萬事集',
    description: '汇集活动报名、内容橱窗与灵活的信息收集工具。',
    route: '/collections',
    icon: collectionsIcon,
    ownerTeam: '平台核心组',
    status: 'enabled',
    requiredPermissions: [],
    order: 3,
  },
  {
    id: 'liaison',
    name: '無限机会',
    description: '在机会委托酒馆发现真实课题，与伙伴组队协作。',
    route: '/liaison',
    icon: liaisonIcon,
    ownerTeam: '联络团队',
    status: 'enabled',
    requiredPermissions: [],
    order: 4,
  },
  {
    id: 'sports',
    name: '無体育',
    description: '查看马杯赛程、体育代表队与队伍风采。',
    route: '/sports',
    icon: sportsIcon,
    ownerTeam: '体育团队',
    status: 'enabled',
    requiredPermissions: [],
    order: 2,
  },
  {
    id: 'finance',
    name: '财务治理',
    description: '记录预决算并支持财务汇总与治理。',
    route: '/finance',
    icon: financeIcon,
    ownerTeam: '财务治理团队',
    status: 'enabled',
    requiredPermissions: ['finance.record.read'],
    order: 8,
  },
  {
    id: 'admin',
    name: '管理员模块',
    description: '维护发展端用户的组织身份卡片。',
    route: '/admin',
    icon: adminIcon,
    ownerTeam: '平台核心组',
    status: 'enabled',
    requiredPermissions: ['admin.manage'],
    order: 9,
  },
] as const;

export function resolveModuleStatus(
  manifest: ModuleManifest,
  overrides?: ModuleStateOverrides,
): ModuleStatus {
  const override = overrides?.[manifest.id];

  if (typeof override === 'boolean') {
    return override ? 'enabled' : 'disabled';
  }

  if (typeof override === 'object') {
    return override.enabled ? 'enabled' : 'disabled';
  }

  return override ?? manifest.status;
}

export function visibleModuleManifests(
  user: PresentationUser,
  overrides?: ModuleStateOverrides,
): readonly ModuleManifest[] {
  return MODULE_MANIFESTS.filter(
    (manifest) =>
      manifest.id !== 'dashboard' &&
      resolveModuleStatus(manifest, overrides) === 'enabled' &&
      (manifest.id !== 'admin' || isSuperAdmin(user)) &&
      manifest.requiredPermissions.every((permission) =>
        hasPresentationPermission(user, permission),
      ),
  ).sort((left, right) => left.order - right.order);
}
