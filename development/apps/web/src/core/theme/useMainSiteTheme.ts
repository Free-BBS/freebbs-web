import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

export const MAIN_SITE_THEME_STORAGE_KEY = 'free_bbs_theme_mode';

function storedThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  return window.localStorage.getItem(MAIN_SITE_THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

function applyThemeMode(mode: ThemeMode): void {
  document.body.classList.toggle('theme-light', mode === 'light');
  document.body.classList.toggle('theme-dark', mode === 'dark');
}

export function useMainSiteTheme(): { mode: ThemeMode; toggle: () => void } {
  const [mode, setMode] = useState<ThemeMode>(storedThemeMode);

  useEffect(() => {
    applyThemeMode(mode);
    window.localStorage.setItem(MAIN_SITE_THEME_STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === MAIN_SITE_THEME_STORAGE_KEY) {
        setMode(event.newValue === 'light' ? 'light' : 'dark');
      } else if (event.key === null) {
        setMode(storedThemeMode());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback(() => {
    setMode((current) => (current === 'light' ? 'dark' : 'light'));
  }, []);

  return { mode, toggle };
}
