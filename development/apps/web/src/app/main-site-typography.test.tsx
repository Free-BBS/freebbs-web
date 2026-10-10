import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { mainSiteTypography } from './MainSiteHeader.js';
import { useMainSiteTypography, TYPOGRAPHY_STORAGE_KEY } from './main-site-typography.js';

const sharedScript = readFileSync(resolve(process.cwd(), '../public/typography.js'), 'utf8');

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-font-preset');
  document.documentElement.removeAttribute('data-type-scale');
});

describe('main-site typography throughout development', () => {
  it('applies the saved reading scale to content and updates it across embedded settings', () => {
    localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify({ typeScale: 'standard' }));
    const { unmount } = renderHook(useMainSiteTypography);
    expect(document.documentElement.style.fontSize).toBe('100%');
    act(() => {
      localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify({ typeScale: 'large' }));
      window.dispatchEvent(new StorageEvent('storage', { key: TYPOGRAPHY_STORAGE_KEY }));
    });
    expect(document.documentElement.style.fontSize).toBe('118%');
    unmount();
    expect(document.documentElement.style.fontSize).toBe('');
  });
  it.each(['transistor-lab', 'zhongsong-study', 'quantum-board', 'night-oscilloscope'])(
    'matches the learning site display, body, ui and Latin fonts for %s',
    (fontPreset) => {
      localStorage.setItem(
        'free_bbs_typography_preferences',
        JSON.stringify({ fontPreset, typeScale: 'comfortable' }),
      );
      new Function(sharedScript)();
      const actual = mainSiteTypography() as Record<string, string>;
      for (const [role, sharedRole] of [
        ['--font-display', '--font-zh-title'],
        ['--font-ui', '--font-zh-ui'],
        ['--font-body', '--font-zh-body'],
        ['--font-latin', '--font-latin'],
      ]) {
        expect(actual[role]).toBe(document.documentElement.style.getPropertyValue(sharedRole));
      }
      expect(actual['--font-serif']).toBe(actual['--font-display']);
    },
  );

  it.each(['null', '[]', '{"fontPreset":"constructor"}', '{invalid'])(
    'falls back safely for invalid stored preference %s',
    (stored) => {
      localStorage.setItem('free_bbs_typography_preferences', stored);
      expect(() => mainSiteTypography()).not.toThrow();
      expect((mainSiteTypography() as Record<string, string>)['--font-display']).toContain(
        'Noto Sans SC',
      );
    },
  );
});
