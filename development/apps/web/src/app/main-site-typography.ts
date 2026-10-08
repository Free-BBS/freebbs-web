import { useEffect, useState, type CSSProperties } from 'react';

export const TYPOGRAPHY_STORAGE_KEY = 'free_bbs_typography_preferences';

// Keep these roles aligned with public/typography.js; the contract test covers every preset.
const fonts = {
  'transistor-lab': {
    title: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
    body: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
    ui: '"HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    latin: '"Segoe UI", "Source Sans Pro", Arial, sans-serif',
    weight: 400,
  },
  'zhongsong-study': {
    title: '"Source Han Serif SC", "Noto Serif SC", "STZhongsong", "华文中宋", serif',
    body: '"Source Han Serif SC Light", "Noto Serif SC Light", "Noto Serif SC", "STSong", "SimSun", serif',
    ui: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
    latin: '"Source Sans Pro", "Segoe UI", Arial, sans-serif',
    weight: 300,
  },
  'quantum-board': {
    title: '"Noto Serif SC", "Source Han Serif SC", "STZhongsong", serif',
    body: '"HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    ui: '"HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    latin: '"Segoe UI", Arial, sans-serif',
    weight: 400,
  },
  'night-oscilloscope': {
    title: '"Syne", "Noto Serif SC", "Source Han Serif SC", serif',
    body: '"Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif',
    ui: '"Segoe UI", "Microsoft YaHei", sans-serif',
    latin: '"Syne", "Segoe UI", Arial, sans-serif',
    weight: 400,
  },
} as const;

export function mainSiteTypography(): CSSProperties {
  let preferences: { fontPreset?: unknown; typeScale?: unknown } = {};
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(TYPOGRAPHY_STORAGE_KEY) || '{}');
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) preferences = stored;
  } catch {
    // A malformed or unavailable setting must not stop rendering the development site.
  }
  const preset =
    typeof preferences.fontPreset === 'string' && Object.hasOwn(fonts, preferences.fontPreset)
      ? fonts[preferences.fontPreset as keyof typeof fonts]
      : fonts['transistor-lab'];
  const scales = { standard: 16, comfortable: 17.28, large: 18.88 };
  const scale =
    typeof preferences.typeScale === 'string' && Object.hasOwn(scales, preferences.typeScale)
      ? scales[preferences.typeScale as keyof typeof scales]
      : scales.comfortable;
  return {
    '--main-site-ui-font': preset.ui,
    '--main-site-ui-size': `${scale}px`,
    '--main-site-type-scale': String(scale / 16),
    '--font-ui': preset.ui,
    '--font-display': preset.title,
    '--font-body': preset.body,
    '--font-latin': preset.latin,
    '--font-body-weight': String(preset.weight),
    // Legacy decorative cards use this alias; they follow the same selected title font.
    '--font-serif': preset.title,
  } as CSSProperties;
}

export function useMainSiteTypography(): CSSProperties {
  const [typography, setTypography] = useState(mainSiteTypography);
  useEffect(() => {
    const root = document.documentElement;
    const previousSize = root.style.fontSize;
    const size = Number.parseFloat(
      String(typography['--main-site-ui-size' as keyof CSSProperties]),
    );
    root.style.fontSize = `${(size / 16) * 100}%`;
    return () => {
      root.style.fontSize = previousSize;
    };
  }, [typography]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === TYPOGRAPHY_STORAGE_KEY || event.key === null) {
        setTypography(mainSiteTypography());
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return typography;
}
