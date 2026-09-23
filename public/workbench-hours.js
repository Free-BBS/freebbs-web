(function exposeWorkbenchHours(root) {
  const DEFAULT_HOURS = Object.freeze({ start: 6, end: 24 });
  const HOUR_MS = 60 * 60 * 1000;

  function normalizeHours(value) {
    const hour = (entry) =>
      typeof entry === 'number' || (typeof entry === 'string' && /^\d{1,2}$/.test(entry))
        ? Number(entry)
        : NaN;
    const start = hour(value?.start);
    const end = hour(value?.end);
    return Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      start < end &&
      end <= 24
      ? { start, end }
      : null;
  }

  function storageKey(uid) {
    return uid == null || String(uid).trim() === ''
      ? null
      : `free_bbs_workbench_hours_v1:${encodeURIComponent(String(uid))}`;
  }

  function readHours(storage, uid) {
    try {
      const key = storageKey(uid);
      return (key && normalizeHours(JSON.parse(storage?.getItem(key)))) || { ...DEFAULT_HOURS };
    } catch {
      return { ...DEFAULT_HOURS };
    }
  }

  function saveHours(storage, uid, value) {
    const key = storageKey(uid);
    const hours = normalizeHours(value);
    if (!key || !hours || !storage) return false;
    try {
      storage.setItem(key, JSON.stringify(hours));
      return true;
    } catch {
      return false;
    }
  }

  // Day boundaries are supplied in Asia/Shanghai by the calendar. Never alter the source items.
  function layoutDay(items, dayStart, value) {
    const hours = normalizeHours(value) || DEFAULT_HOURS;
    const dayEnd = dayStart + 24 * HOUR_MS;
    const windowStart = dayStart + hours.start * HOUR_MS;
    const windowEnd = dayStart + hours.end * HOUR_MS;
    const entries = [];
    const outside = [];
    for (const item of items) {
      const start = new Date(item.startAt).getTime();
      const end = new Date(item.endAt).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      if (item.kind === 'deadline') {
        if (end >= dayStart && end < dayEnd) entries.push({ item, start, end, clipped: false });
        continue;
      }
      if (start >= dayEnd || end <= dayStart) continue;
      const dailyStart = Math.max(start, dayStart);
      const dailyEnd = Math.min(end, dayEnd);
      if (item.allDay) {
        entries.push({ item, start: dailyStart, end: dailyEnd, clipped: false });
        continue;
      }
      const visibleStart = Math.max(dailyStart, windowStart);
      const visibleEnd = Math.min(dailyEnd, windowEnd);
      if (visibleStart >= visibleEnd) outside.push(item);
      else {
        entries.push({
          item,
          start: visibleStart,
          end: visibleEnd,
          clipped: visibleStart !== dailyStart || visibleEnd !== dailyEnd,
        });
      }
    }
    entries.sort((left, right) => left.start - right.start || left.end - right.end);
    return { entries, outside, windowStart, windowEnd };
  }

  const api = { DEFAULT_HOURS, normalizeHours, storageKey, readHours, saveHours, layoutDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, { FreeBbsWorkbenchHours: api });
})(typeof window !== 'undefined' ? window : globalThis);
