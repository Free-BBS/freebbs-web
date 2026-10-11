import type { CollaborationColumn } from '@freebbs-development/contracts';
import { HttpError } from '../../core/errors/http-error.js';

export function allocatePreferences(
  slots: Array<{ id: string; capacity: number }>,
  entries: Array<{ uid: string; choices: string[] }>,
): Record<string, string> {
  const remaining = new Map(slots.map((slot) => [slot.id, slot.capacity]));
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let rank = 0; rank < Math.max(0, ...entries.map((entry) => entry.choices.length)); rank++) {
    for (const entry of entries) {
      if (result[entry.uid]) continue;
      const id = entry.choices[rank];
      const capacity = id ? (remaining.get(id) ?? 0) : 0;
      if (id && capacity > 0) {
        result[entry.uid] = id;
        remaining.set(id, capacity - 1);
      }
    }
  }
  return result;
}
export function assertBookingAvailable(
  entries: Array<{ resource: string; startsAt: string; endsAt: string }>,
  candidate: { resource: string; startsAt: string; endsAt: string },
) {
  const start = Date.parse(candidate.startsAt);
  const end = Date.parse(candidate.endsAt);
  if (!candidate.resource || !Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new HttpError(400, 'invalid_booking', '请选择资源及有效的开始、结束时间');
  if (
    entries.some(
      (entry) =>
        entry.resource === candidate.resource &&
        Date.parse(entry.startsAt) < end &&
        Date.parse(entry.endsAt) > start,
    )
  )
    throw new HttpError(409, 'booking_conflict', '该资源在这个时间段已有预约，存在时间冲突');
}
export function validateTableRow(columns: CollaborationColumn[], values: Record<string, unknown>) {
  if (Object.keys(values).some((key) => !columns.some((column) => column.id === key)))
    throw new HttpError(400, 'invalid_column', '记录包含不存在的字段');
  for (const column of columns) {
    const value = values[column.id];
    if (value === undefined || value === '') {
      if (column.required) throw new HttpError(400, 'required_column', `请填写${column.label}`);
      continue;
    }
    if (
      (column.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) ||
      (column.kind !== 'number' && typeof value !== 'string') ||
      (column.kind === 'date' &&
        (typeof value !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)))) ||
      (column.kind === 'choice' && !column.options?.includes(String(value)))
    )
      throw new HttpError(400, 'invalid_value', `${column.label}的格式不正确`);
  }
}
