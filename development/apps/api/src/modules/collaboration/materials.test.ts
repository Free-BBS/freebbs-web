import { describe, expect, it } from 'vitest';
import { safeArchiveName } from './materials.js';
describe('material naming', () => {
  it('rejects traversal and reserved Windows paths and preserves readable filenames', () => {
    for (const name of ['../secret', 'a\\b', 'CON.txt', '..', 'a\u0000b', 'a.'])
      expect(() => safeArchiveName(name)).toThrow();
    expect(safeArchiveName(' 2026-党课总结.pdf ')).toBe('2026-党课总结.pdf');
  });
});
