import { describe, expect, it } from 'vitest';
import { allocatePreferences, assertBookingAvailable, validateTableRow } from './domain.js';
describe('organization collaboration rules', () => {
  it('assigns ranked choices fairly without exceeding capacities', () => {
    const slots = [
      { id: 'a', capacity: 1 },
      { id: 'b', capacity: 2 },
    ];
    const result = allocatePreferences(slots, [
      { uid: 'first', choices: ['a', 'b'] },
      { uid: 'second', choices: ['a', 'b'] },
      { uid: 'third', choices: ['b'] },
    ]);
    expect(result).toEqual({ first: 'a', second: 'b', third: 'b' });
    expect(allocatePreferences(slots, [{ uid: 'x', choices: ['missing'] }])).toEqual({});
  });
  it('rejects intersecting reservations but allows adjacent sessions', () => {
    const reservations = [
      { resource: 'room', startsAt: '2026-10-10T10:00:00Z', endsAt: '2026-10-10T11:00:00Z' },
    ];
    expect(() =>
      assertBookingAvailable(reservations, {
        resource: 'room',
        startsAt: '2026-10-10T10:30:00Z',
        endsAt: '2026-10-10T12:00:00Z',
      }),
    ).toThrow(/冲突/);
    expect(() =>
      assertBookingAvailable(reservations, {
        resource: 'room',
        startsAt: '2026-10-10T11:00:00Z',
        endsAt: '2026-10-10T12:00:00Z',
      }),
    ).not.toThrow();
  });
  it('checks shared table column types and rejects extra keys', () => {
    const columns = [{ id: 'count', label: '人数', kind: 'number' as const, required: true }];
    expect(() => validateTableRow(columns, { count: '人数' })).toThrow();
    expect(() => validateTableRow(columns, { count: 12, private: 'x' })).toThrow();
    expect(() => validateTableRow(columns, { count: 12 })).not.toThrow();
  });
});
