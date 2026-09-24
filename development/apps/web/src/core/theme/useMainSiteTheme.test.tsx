import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useMainSiteTheme } from './useMainSiteTheme.js';

afterEach(() => {
  localStorage.clear();
  document.body.classList.remove('theme-light', 'theme-dark');
});

describe('useMainSiteTheme', () => {
  it('uses the main-site storage key and applies a stored light theme', () => {
    localStorage.setItem('free_bbs_theme_mode', 'light');

    const { result } = renderHook(() => useMainSiteTheme());

    expect(result.current.mode).toBe('light');
    expect(document.body).toHaveClass('theme-light');
    expect(document.body).not.toHaveClass('theme-dark');
  });

  it('defaults to dark and persists theme changes for the main site', () => {
    const { result } = renderHook(() => useMainSiteTheme());

    expect(result.current.mode).toBe('dark');
    expect(document.body).toHaveClass('theme-dark');

    act(() => result.current.toggle());

    expect(result.current.mode).toBe('light');
    expect(localStorage.getItem('free_bbs_theme_mode')).toBe('light');
    expect(document.body).toHaveClass('theme-light');
  });

  it('follows a theme change made in another main-site tab', () => {
    const { result } = renderHook(() => useMainSiteTheme());

    localStorage.setItem('free_bbs_theme_mode', 'light');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'free_bbs_theme_mode',
          newValue: 'light',
        }),
      );
    });

    expect(result.current.mode).toBe('light');
    expect(document.body).toHaveClass('theme-light');
  });
});
