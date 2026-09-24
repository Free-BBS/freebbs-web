import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const stylesDirectory = resolve(process.cwd(), 'apps/web/src/styles');

describe('featured card title typography', () => {
  it('uses the same compact scale for sports and festival titles', () => {
    const sports = readFileSync(`${stylesDirectory}/sports.css`, 'utf8');
    const festival = readFileSync(`${stylesDirectory}/festival.css`, 'utf8');

    expect(sports).toMatch(
      /\.ma-cup-copy strong\s*\{[\s\S]*?font-size:\s*clamp\(1\.75rem, 3\.2vw, 2\.75rem\)/,
    );
    expect(festival).toMatch(
      /\.festival-entrance strong\s*\{[\s\S]*?font-size:\s*clamp\(1\.75rem, 3\.2vw, 2\.75rem\)[\s\S]*?white-space:\s*nowrap/,
    );
  });
});
