// Shared browser/CommonJS manifest. Append release records instead of reusing an
// existing id: each account keeps a separate receipt for every published tour.
(() => {
  const GUIDE_VERSION = 'max-v2';
  const LEGACY_GUIDE_VERSIONS = Object.freeze(['max-v1']);
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
