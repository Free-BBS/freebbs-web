import { describe, expect, it } from 'vitest';

import componentsCss from './components.css?raw';
import shellCss from './shell.css?raw';
import financeCss from './finance.css?raw';
import sportsCss from './sports.css?raw';
import themeCss from './theme.css?raw';
import tokensCss from './tokens.css?raw';

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)
      ?.map((channel) => Number.parseInt(channel, 16) / 255);
    if (!channels || channels.length !== 3)
      throw new Error(`Expected a hex color, received ${hex}`);
    const [red, green, blue] = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('dark-theme contrast contract', () => {
  it('uses a normal-width interface font for Latin text across development pages', () => {
    expect(tokensCss).toMatch(/--font-ui:\s*'Segoe UI'/);
    expect(tokensCss).toContain("--font-latin: 'Segoe UI', Arial, Helvetica, sans-serif;");
    for (const stylesheet of [tokensCss, sportsCss, financeCss]) {
      expect(stylesheet).not.toMatch(/Syne|Bahnschrift|DIN Alternate|Arial Narrow/);
    }
  });

  it('provides a light treatment for external sidebar SVG images', () => {
    expect(themeCss).toMatch(
      /body\.theme-dark \.module-icon img,[\s\S]*?filter:\s*brightness\(0\) invert\(1\)/,
    );
  });

  it('keeps the administrator module on shared semantic surfaces', () => {
    expect(shellCss).toContain('.development-directory-layout');
    expect(shellCss).toContain('grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);');
    expect(shellCss).toContain('background: var(--surface-raised);');
    expect(shellCss).toContain('border: 1px solid var(--border-subtle);');
    expect(componentsCss).not.toContain('--admin-paper');
    expect(themeCss).not.toContain('--admin-paper');
  });

  it('keeps shared learning-area surfaces and actions in the semantic token contract', () => {
    for (const token of [
      '--surface-page:',
      '--surface-raised:',
      '--surface-muted:',
      '--border-subtle:',
      '--action-primary:',
      '--action-primary-text:',
    ]) {
      expect(tokensCss).toContain(token);
      expect(themeCss).toContain(token);
    }
    expect(tokensCss).toContain('--radius-sm: 12px;');
    expect(tokensCss).toContain('--radius-lg: 18px;');
  });

  it('keeps sidebar hover and active navigation text above the normal-text contrast threshold', () => {
    expect(tokensCss).toContain('--nav-link-hover-background: #175267;');
    expect(tokensCss).toContain('--nav-link-hover-text: #ffffff;');
    expect(tokensCss).toContain('--nav-link-active-background: #075d68;');
    expect(tokensCss).toContain('--nav-link-active-text: #ffffff;');
    expect(themeCss).toContain('--nav-link-hover-background: #175267;');
    expect(themeCss).toContain('--nav-link-active-background: #287a8b;');
    expect(contrastRatio('#ffffff', '#175267')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', '#075d68')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', '#287a8b')).toBeGreaterThanOrEqual(4.5);
    expect(shellCss).toContain('background: var(--nav-link-hover-background);');
    expect(shellCss).toContain('color: var(--nav-link-hover-text);');
    expect(shellCss).toContain('background: var(--nav-link-active-background);');
    expect(shellCss).toContain('color: var(--nav-link-active-text);');
  });
});
