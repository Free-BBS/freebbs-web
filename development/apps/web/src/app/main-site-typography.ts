export const MAIN_SITE_TYPOGRAPHY_STORAGE_KEY = 'free_bbs_typography_preferences';

const typographyFonts = {
  'transistor-lab': {
    title: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
    ui: '"HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  },
  'zhongsong-study': {
    title: '"Source Han Serif SC", "Noto Serif SC", "STZhongsong", "华文中宋", serif',
    ui: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
  },
  'quantum-board': {
    title: '"Noto Serif SC", "Source Han Serif SC", "STZhongsong", serif',
    ui: '"HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  },
  'night-oscilloscope': {
    title: '"Syne", "Noto Serif SC", "Source Han Serif SC", serif',
    ui: '"Segoe UI", "Microsoft YaHei", sans-serif',
  },
};

const typographyScales = { standard: 16, comfortable: 17.28, large: 18.88 };

function isOwnKey<T extends object>(presets: T, value: unknown): value is Extract<keyof T, string> {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(presets, value);
}

function normalizePreferences(preferences: unknown) {
  const value =
    preferences !== null && typeof preferences === 'object' && !Array.isArray(preferences)
      ? (preferences as Record<string, unknown>)
      : {};
  return {
    fontPreset: isOwnKey(typographyFonts, value.fontPreset) ? value.fontPreset : 'transistor-lab',
    typeScale: isOwnKey(typographyScales, value.typeScale) ? value.typeScale : 'comfortable',
  } as const;
}

export function readMainSiteTypography(readStoredPreferences: () => string | null) {
  let storedPreferences: unknown = {};
  try {
    storedPreferences = JSON.parse(readStoredPreferences() || '{}');
  } catch {
    // Keep the default preset when saved preferences or storage are unavailable.
  }
  const preferences = normalizePreferences(storedPreferences);
  const scale = typographyScales[preferences.typeScale];
  const fonts = typographyFonts[preferences.fontPreset];
  return {
    '--main-site-ui-font': fonts.ui,
    '--main-site-ui-size': `${scale}px`,
    '--main-site-type-scale': String(scale / 16),
    '--font-ui': fonts.ui,
    '--font-display': fonts.title,
  };
}
