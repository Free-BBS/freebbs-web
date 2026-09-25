import { expect, it } from 'vitest';

import { encodeUtcDateTime } from './date-codec.js';

it('validates zoned local calendar and time components before offset normalization', () => {
  expect(() => encodeUtcDateTime('2026-02-31T08:09:10.123Z')).toThrow('UTC date-time');
  expect(() => encodeUtcDateTime('2026-04-31T08:09:10.123+08:00')).toThrow('UTC date-time');
  expect(() => encodeUtcDateTime('2026-07-22T24:09:10.123Z')).toThrow('UTC date-time');
  expect(() => encodeUtcDateTime('2026-07-22T08:09:10.123+24:00')).toThrow('UTC date-time');
  expect(encodeUtcDateTime('2026-07-22T11:04:05.006+08:00')?.toISOString()).toBe(
    '2026-07-22T03:04:05.006Z',
  );
});
