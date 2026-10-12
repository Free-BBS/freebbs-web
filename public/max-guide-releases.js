// Shared browser/CommonJS manifest. Append release records instead of reusing an
// existing id: each account keeps a separate receipt for every published tour.
(() => {
  const GUIDE_VERSION = 'max-v5';
  const LEGACY_GUIDE_VERSIONS = Object.freeze(['max-v1', 'max-v2', 'max-v3', 'max-v4']);
  const RELEASES = Object.freeze([
    Object.freeze({
      id: 'guide-depth-2026-09',
      title: '跟 Max 深入探索新功能',
      description: '逐项认识已经开放的学习、讨论、计划与社区功能。',
      publishedAt: '2026-09-21',
      // Keep the published order independent of the current catalogue's default
      // short tour; saved numeric progress must not drift on a later release.
      stepIds: Object.freeze([
        'world-atlas',
        'world-mathematics',
        'world-island-overview',
        'workbench-ai-plan',
        'inventory-recycling',
        'inventory-ledger-entry',
        'inventory-ledger',
        'profile-ranch',
        'profile-wool',
      ]),
      highlights: Object.freeze([
        '逐项了解学习世界、课程知识地图与 Max 的使用方式',
        '认识个人计划、讨论互动与社区参与',
        '探索鱼骨回收、钱包账本与账号装扮',
        '认识牧场羊毛、永久橡胶棒与摩擦换电元',
      ]),
    }),
    Object.freeze({
      id: 'guide-community-2026-09',
      title: '跟 Max 认识发展端与活动报名',
      description: '了解发展端建设状态、活动报名的当前入口，以及上线后的整合方向。',
      publishedAt: '2026-09-21',
      stepIds: Object.freeze([
        'development-status',
        'development-activities-plan',
        'activities-entry',
        'activities-browse',
        'activities-receipt',
      ]),
      highlights: Object.freeze([
        '认识仍在建设的发展端与规划中的同学服务',
        '找到当前独立的活动报名入口，了解报名条件与回执查询',
        '明确发展端上线后，活动报名将整合进入发展端',
      ]),
    }),
    Object.freeze({
      id: 'guide-layout-2026-09',
      title: '跟 Max 认识新版布局',
      description: '从顶栏到侧栏，认识签到月历、实验室、规划入口与独立牧场',
      publishedAt: '2026-09-27',
      stepIds: Object.freeze([
        'shell-search',
        'shell-checkin',
        'shell-account',
        'shell-navigation',
        'laboratory-circuit',
        'laboratory-tools',
        'laboratory-planned',
        'creative-workshop-plan',
        'pbl-plan',
        'shell-assets',
        'profile-ranch',
        'profile-wool',
      ]),
      highlights: Object.freeze([
        '按当前页面顺序认识搜索、签到、设置与导航',
        '分清实验室已开放工具与规划中的运行环境',
        '从个人主页进入独立牧场，查看羊毛与收藏',
      ]),
    }),
    Object.freeze({
      id: 'guide-essentials-2026-10',
      title: '学习、讨论、计划，按需要开始',
      description: '用简短导引认识三个主要功能，其他工具按需要探索。',
      publishedAt: '2026-10-01',
      stepIds: Object.freeze([
        'world-atlas',
        'discussion-filters',
        'workbench-week',
        'handbook-other-features',
      ]),
      highlights: Object.freeze([
        '从课程地图阅读知识点',
        '在讨论区交流问题与思路',
        '在工作台安排自己的时间',
      ]),
    }),
    Object.freeze({
      id: 'guide-pages-2026-10-08',
      title: '一页一站，按需要认识其他功能',
      description: '用八个简洁画面认识讨论、计划、实验与社区入口，不自动操作业务。',
      publishedAt: '2026-10-08',
      stepIds: Object.freeze([
        'discussion-overview-202610',
        'workbench-overview-202610',
        'laboratory-overview-202610',
        'creative-overview-202610',
        'pbl-overview-202610',
        'max-overview-202610',
        'development-overview-202610',
        'shop-overview-202610',
      ]),
      highlights: Object.freeze([
        '学习导引保留，其他页面各用一个画面说明',
        '区分已有功能与建设中的创意工坊、PBL 和发展端',
        '可随时暂停、跳站或从手册重看，不代为发布、生成或兑换',
      ]),
    }),
  ]);
  const manifest = Object.freeze({
    GUIDE_VERSION,
    LEGACY_GUIDE_VERSIONS,
    RELEASES,
    LATEST_RELEASE: RELEASES.at(-1) || null,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = manifest;
  if (typeof window !== 'undefined') window.FreeBbsGuideReleases = manifest;
})();
