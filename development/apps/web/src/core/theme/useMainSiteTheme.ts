import { useCallback, useEffect, useRef, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

export const MAIN_SITE_THEME_STORAGE_KEY = 'free_bbs_theme_mode';

function storedThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    return window.localStorage.getItem(MAIN_SITE_THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return document.body.classList.contains('theme-light') ? 'light' : 'dark';
  }
}

function applyThemeMode(mode: ThemeMode): void {
  document.body.classList.toggle('theme-light', mode === 'light');
  document.body.classList.toggle('theme-dark', mode === 'dark');
}

function initialThemeMode(): ThemeMode {
  if (typeof window !== 'undefined' && window.parent !== window) {
    try {
      const parentBody = window.parent.document.body;
      if (parentBody?.classList.contains('theme-light')) return 'light';
      if (parentBody?.classList.contains('theme-dark')) return 'dark';
    } catch {
      // Cross-origin embedding falls back to the page's own preference.
    }
  }
  return storedThemeMode();
}

function themePeers(): Window[] {
  const peers = Array.from(document.querySelectorAll('iframe'), (frame) => frame.contentWindow);
  if (window.parent !== window) peers.push(window.parent);
  return peers.filter((peer): peer is Window => peer !== null);
}

function sendTheme(peer: Window, mode: ThemeMode): void {
  peer.postMessage({ type: 'freebbs:theme-sync', mode }, window.location.origin);
}

function broadcastTheme(mode: ThemeMode, source?: MessageEventSource | null): void {
  themePeers().forEach((peer) => {
    if (peer !== source) sendTheme(peer, mode);
  });
}

export function useMainSiteTheme(): { mode: ThemeMode; toggle: () => void } {
  const [mode, setMode] = useState<ThemeMode>(initialThemeMode);
  const currentMode = useRef(mode);

  useEffect(() => {
    applyThemeMode(currentMode.current);
    const synchronize = (next: ThemeMode, source?: MessageEventSource | null) => {
      const changed = currentMode.current !== next;
      currentMode.current = next;
      applyThemeMode(next);
      setMode(next);
      if (changed) broadcastTheme(next, source);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === MAIN_SITE_THEME_STORAGE_KEY) {
        synchronize(event.newValue === 'light' ? 'light' : 'dark');
      } else if (event.key === null) {
        synchronize(storedThemeMode());
      }
    };
    const onMessage = (event: MessageEvent) => {
      const peer = themePeers().find((candidate) => candidate === event.source);
      if (event.origin !== window.location.origin || !peer) return;
      if (event.data?.type === 'freebbs:theme-request') sendTheme(peer, currentMode.current);
      else if (
        event.data?.type === 'freebbs:theme-sync' &&
        (event.data.mode === 'light' || event.data.mode === 'dark')
      )
        synchronize(event.data.mode, peer);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('message', onMessage);
    if (window.parent !== window)
      window.parent.postMessage({ type: 'freebbs:theme-request' }, window.location.origin);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = currentMode.current === 'light' ? 'dark' : 'light';
    currentMode.current = next;
    applyThemeMode(next);
    setMode(next);
    try {
      window.localStorage.setItem(MAIN_SITE_THEME_STORAGE_KEY, next);
    } catch {
      // Keep the selection usable even when storage is unavailable.
    }
    broadcastTheme(next);
  }, []);

  return { mode, toggle };
}
