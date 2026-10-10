import { useEffect, useState, type CSSProperties } from 'react';

// Import the DOM-free contract used by the main site; never duplicate font stacks.
import '../../../../../public/typography-preferences.js';

const typography = globalThis.freeBbsTypographyPreferences;

export const MAIN_SITE_TYPOGRAPHY_STORAGE_KEY = typography.STORAGE_KEY;

export function readMainSiteTypography(readStoredPreferences: () => string | null) {
  return typography.mainSiteVariables(typography.read(readStoredPreferences));
}

export const TYPOGRAPHY_STORAGE_KEY = MAIN_SITE_TYPOGRAPHY_STORAGE_KEY;

export function mainSiteTypography(): CSSProperties {
  const preferences = typography.read(() => window.localStorage.getItem(TYPOGRAPHY_STORAGE_KEY));
  const variables = typography.cssVariables(preferences);
  return {
    ...typography.mainSiteVariables(preferences),
    '--font-body': variables['--font-zh-body'],
    '--font-latin': variables['--font-latin'],
    '--font-body-weight': variables['--font-zh-body-weight'],
    '--font-serif': variables['--font-zh-title'],
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
