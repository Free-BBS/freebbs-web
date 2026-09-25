import { describe, expect, it } from 'vitest';

import liaisonCss from './liaison.css?raw';

describe('liaison noticeboard style contract', () => {
  it('keeps the noticeboard light brown and darkens its cork surface on hover', () => {
    expect(liaisonCss).toContain('linear-gradient(145deg, #c39761, #a97742)');
    expect(liaisonCss).toContain('linear-gradient(145deg, #ad7d4c, #7f5130)');
  });

  it('gives opportunity detail labels and copy enough internal spacing', () => {
    expect(liaisonCss).toMatch(
      /\.noticeboard-panel \.opportunity-detail-facts > div\s*\{[\s\S]*?gap:\s*14px;[\s\S]*?padding:\s*22px 24px;/,
    );
  });
});
