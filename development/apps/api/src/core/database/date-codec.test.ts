import { describe, expect, it } from 'vitest';

import { decodeUtcDateTime, encodeDateOnly, encodeUtcDateTime } from './date-codec.js';

describe('database date codecs', () => {
  it('decodes MySQL UTC DATETIME without relying on the host timezone', () => {
    expect(decodeUtcDateTime('2026-07-22 08:09:10.123')).toBe('2026-07-22T08:09:10.123Z');
    expect(decodeUtcDateTime(new Date('2026-07-22T08:09:10.123Z'))).toBe(
      '2026-07-22T08:09:10.123Z',
    );
  });

  it('requires timezone-aware instants and preserves DATE values as calendar dates', () => {
    expect(encodeUtcDateTime('2026-07-22T08:09:10.123+08:00')?.toISOString()).toBe(
      '2026-07-22T00:09:10.123Z',
    );
    expect(() => encodeUtcDateTime('2026-07-22 08:09:10')).toThrow('UTC date-time');
    expect(encodeDateOnly('2026-07-22')).toBe('2026-07-22');
    expect(() => encodeDateOnly('2026-7-2')).toThrow('calendar date');
  });
});
