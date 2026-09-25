import { expect, it } from 'vitest';

import { decodeUtcDateTime, encodeDateOnly } from './date-codec.js';

it('rejects impossible MySQL UTC timestamps and calendar dates', () => {
  expect(() => decodeUtcDateTime('2026-02-31 08:09:10.123')).toThrow('Invalid UTC date-time');
  expect(() => encodeDateOnly('2026-02-31')).toThrow('valid calendar date');
});
