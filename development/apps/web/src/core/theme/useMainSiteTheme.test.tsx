import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMainSiteTheme } from './useMainSiteTheme.js';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
  document.body.classList.remove('theme-light', 'theme-dark');
});

describe('useMainSiteTheme', () => {
  it('uses the main-site storage key and applies a stored light theme', () => {
    localStorage.setItem('free_bbs_theme_mode', 'light');
    const writes = vi.spyOn(Storage.prototype, 'setItem');

    const { result } = renderHook(() => useMainSiteTheme());

    expect(result.current.mode).toBe('light');
    expect(document.body).toHaveClass('theme-light');
    expect(document.body).not.toHaveClass('theme-dark');
    expect(writes).not.toHaveBeenCalled();
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
    const writes = vi.spyOn(Storage.prototype, 'setItem');
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
    expect(writes).not.toHaveBeenCalled();
  });

  it('keeps theme toggles usable when reading and writing storage both throw', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });
    const { result } = renderHook(() => useMainSiteTheme());
    expect(result.current.mode).toBe('dark');
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('light');
    expect(document.body).toHaveClass('theme-light');
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('dark');
    expect(document.body).toHaveClass('theme-dark');
  });

  it('uses an applied parent preference immediately when embedded storage is unavailable', () => {
    const parentBody = document.createElement('body');
    parentBody.classList.add('theme-light');
    const parent = { document: { body: parentBody }, postMessage: vi.fn() };
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window);
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });
    const { result } = renderHook(() => useMainSiteTheme());
    expect(result.current.mode).toBe('light');
    expect(document.body).toHaveClass('theme-light');
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: 'freebbs:theme-request' },
      window.location.origin,
    );
  });

  it('follows storage removal and clearing without writing the received preference back', () => {
    localStorage.setItem('free_bbs_theme_mode', 'light');
    const { result } = renderHook(() => useMainSiteTheme());
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'dark' }));
    });
    expect(result.current.mode).toBe('light');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'free_bbs_theme_mode' }));
    });
    expect(result.current.mode).toBe('dark');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'free_bbs_theme_mode', newValue: 'light' }),
      );
    });
    localStorage.clear();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    expect(result.current.mode).toBe('dark');
    expect(writes).not.toHaveBeenCalled();
  });

  it('synchronizes its direct same-origin commerce frames and rejects unrelated messages', () => {
    const first = document.createElement('iframe');
    const second = document.createElement('iframe');
    document.body.append(first, second);
    const firstMessages = vi.spyOn(first.contentWindow!, 'postMessage');
    const secondMessages = vi.spyOn(second.contentWindow!, 'postMessage');
    const { result } = renderHook(() => useMainSiteTheme());
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const receive = (data: object, source: Window | null, origin = window.location.origin) => {
      act(() => window.dispatchEvent(new MessageEvent('message', { data, source, origin })));
    };
    receive({ type: 'freebbs:theme-request' }, first.contentWindow);
    expect(firstMessages).toHaveBeenLastCalledWith(
      { type: 'freebbs:theme-sync', mode: 'dark' },
      window.location.origin,
    );
    receive({ type: 'freebbs:theme-sync', mode: 'light' }, window);
    receive(
      { type: 'freebbs:theme-sync', mode: 'light' },
      first.contentWindow,
      'https://other.test',
    );
    receive({ type: 'freebbs:theme-sync', mode: 'system' }, first.contentWindow);
    expect(result.current.mode).toBe('dark');
    receive({ type: 'freebbs:theme-sync', mode: 'light' }, first.contentWindow);
    expect(result.current.mode).toBe('light');
    expect(document.body).toHaveClass('theme-light');
    expect(secondMessages).toHaveBeenLastCalledWith(
      { type: 'freebbs:theme-sync', mode: 'light' },
      window.location.origin,
    );
    expect(firstMessages).toHaveBeenCalledTimes(1);
    expect(writes).not.toHaveBeenCalled();
    receive({ type: 'freebbs:theme-sync', mode: 'light' }, first.contentWindow);
    expect(secondMessages).toHaveBeenCalledTimes(1);
    act(() => result.current.toggle());
    expect(firstMessages).toHaveBeenLastCalledWith(
      { type: 'freebbs:theme-sync', mode: 'dark' },
      window.location.origin,
    );
    expect(writes).toHaveBeenCalledTimes(1);
  });
});
