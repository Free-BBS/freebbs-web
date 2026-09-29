const DEFAULTS = Object.freeze({
  enabled: true,
  dayStart: '09:00',
  dayEnd: '21:00',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  focusMinutes: 60,
  breakMinutes: 15,
  dailyMaxMinutes: 120,
  restWindows: [
    { start: '12:00', end: '13:00' },
    { start: '18:00', end: '19:00' },
  ],
});

const PREFERENCES_TABLE = `CREATE TABLE IF NOT EXISTS workbench_planning_preferences (
  user_id BIGINT NOT NULL PRIMARY KEY,
  preferences_json JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`;

function clockMinutes(value, allowMidnight = false) {
  if (allowMidnight && value === '24:00') return 1440;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function normalizePreferences(value = DEFAULTS) {
  const fail = () => {
    throw Object.assign(
      new Error('请检查规划偏好：时间需在同一天内，至少选择一天，休息时段最多 4 段。'),
      { status: 400 },
    );
  };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(DEFAULTS, key))
  )
    fail();
  const result = { ...DEFAULTS, ...value };
  const start = clockMinutes(result.dayStart);
  const end = clockMinutes(result.dayEnd, true);
  if (
    typeof result.enabled !== 'boolean' ||
    start === null ||
    end === null ||
    end - start < 15 ||
    !Array.isArray(result.weekdays) ||
    !result.weekdays.length ||
    result.weekdays.length > 7 ||
    result.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
    ![30, 45, 60, 90, 120].includes(result.focusMinutes) ||
    ![0, 5, 10, 15, 30].includes(result.breakMinutes) ||
    !Number.isInteger(result.dailyMaxMinutes) ||
    result.dailyMaxMinutes < 30 ||
    result.dailyMaxMinutes > 480 ||
    result.dailyMaxMinutes % 15 !== 0 ||
    !Array.isArray(result.restWindows) ||
    result.restWindows.length > 4
  )
    fail();
  result.weekdays = [...new Set(result.weekdays)].sort((a, b) => a - b);
  result.restWindows = result.restWindows.map((window) => {
    if (
      !window ||
      typeof window !== 'object' ||
      Object.keys(window).some((key) => !['start', 'end'].includes(key))
    )
      fail();
    const a = clockMinutes(window.start);
    const b = clockMinutes(window.end, true);
    if (a === null || b === null || a >= b) fail();
    return { start: window.start, end: window.end };
  });
  return result;
}

async function readPreferences(pool, userId) {
  const [rows] = await pool.execute(
    'SELECT preferences_json FROM workbench_planning_preferences WHERE user_id = ?',
    [userId],
  );
  const value = rows[0]?.preferences_json;
  return {
    preferences: normalizePreferences(
      typeof value === 'string' ? JSON.parse(value) : value || DEFAULTS,
    ),
    saved: Boolean(value),
  };
}

async function savePreferences(pool, userId, value) {
  const preferences = normalizePreferences(value);
  await pool.execute(
    `INSERT INTO workbench_planning_preferences (user_id, preferences_json)
    VALUES (?, ?) ON DUPLICATE KEY UPDATE preferences_json = VALUES(preferences_json)`,
    [userId, JSON.stringify(preferences)],
  );
  return { preferences, saved: true };
}

const MINUTE = 60000;
const DAY = 86400000;
const OFFSET = 8 * 60 * MINUTE;
const midnight = (date) => Math.floor((date.getTime() + OFFSET) / DAY) * DAY - OFFSET;

// Pure local arithmetic: no event titles/notes are sent to the model to find gaps.
function availableWindows(existing, now, days, preferences, restriction = {}) {
  const p = normalizePreferences(preferences);
  const start = Math.max(
    clockMinutes(p.dayStart),
    clockMinutes(restriction.dayStart ?? p.dayStart),
  );
  const end = Math.min(
    clockMinutes(p.dayEnd, true),
    clockMinutes(restriction.dayEnd ?? p.dayEnd, true),
  );
  if (start >= end) return [];
  const buffer = p.breakMinutes * MINUTE;
  const busy = existing
    .filter((item) => item.kind !== 'deadline')
    .map((item) => ({
      start: new Date(item.startAt || item.start_at).getTime() - buffer,
      end: new Date(item.endAt || item.end_at).getTime() + buffer,
    }))
    .filter(
      (item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start,
    );
  const result = [];
  for (let day = 0; day < days; day += 1) {
    const base = midnight(now) + day * DAY;
    const weekday = new Date(base + OFFSET).getUTCDay() || 7;
    if (!p.weekdays.includes(weekday)) continue;
    const windowStart = Math.max(
      base + start * MINUTE,
      Math.ceil(now.getTime() / (15 * MINUTE)) * 15 * MINUTE,
    );
    const windowEnd = base + end * MINUTE;
    const occupied = [
      ...busy,
      ...p.restWindows.map((rest) => ({
        start: base + clockMinutes(rest.start) * MINUTE,
        end: base + clockMinutes(rest.end, true) * MINUTE,
      })),
    ]
      .filter((item) => item.start < windowEnd && item.end > windowStart)
      .sort((a, b) => a.start - b.start);
    let cursor = windowStart;
    for (const item of [...occupied, { start: windowEnd, end: windowEnd }]) {
      const gapEnd = Math.min(item.start, windowEnd);
      if (gapEnd - cursor >= 15 * MINUTE)
        result.push({
          startAt: new Date(cursor).toISOString(),
          endAt: new Date(gapEnd).toISOString(),
          day,
        });
      cursor = Math.max(cursor, item.end);
      if (cursor >= windowEnd) break;
    }
  }
  return result;
}

function planWithPreferences(extraction, existing, now, preferences) {
  const p = normalizePreferences(preferences);
  const windows = availableWindows(existing, now, extraction.days, p, extraction);
  const used = new Map();
  // Count earlier plans in the same preview AND already confirmed planner events.
  for (const item of existing) {
    if (!item.planned && item.source_type !== 'agent' && item.sourceType !== 'agent') continue;
    if (
      item.kind === 'deadline' ||
      ['planner:deadline', 'planner:weekly'].includes(item.source_reference)
    )
      continue;
    const a = new Date(item.startAt || item.start_at).getTime();
    const b = new Date(item.endAt || item.end_at).getTime();
    for (let day = 0; day < extraction.days; day += 1) {
      const base = midnight(now) + day * DAY;
      used.set(
        day,
        (used.get(day) || 0) + Math.max(0, Math.min(b, base + DAY) - Math.max(a, base)) / MINUTE,
      );
    }
  }
  let remaining = extraction.totalMinutes;
  const suggestions = [];
  for (const gap of windows) {
    let cursor = Date.parse(gap.startAt);
    const end = Date.parse(gap.endAt);
    while (remaining > 0) {
      const duration =
        Math.floor(
          Math.min(
            p.focusMinutes,
            remaining,
            p.dailyMaxMinutes - (used.get(gap.day) || 0),
            (end - cursor) / MINUTE,
          ) / 15,
        ) * 15;
      if (duration < 15) break;
      suggestions.push({
        title: extraction.title.trim(),
        description: extraction.description?.trim() || '',
        startAt: new Date(cursor).toISOString(),
        endAt: new Date(cursor + duration * MINUTE).toISOString(),
        planned: true,
      });
      remaining -= duration;
      used.set(gap.day, (used.get(gap.day) || 0) + duration);
      cursor += (duration + p.breakMinutes) * MINUTE;
    }
    if (!remaining) break;
  }
  if (remaining)
    throw Object.assign(
      new Error(
        `按你的规划偏好，还差 ${remaining} 分钟空档。可以延长规划天数、减少任务量，或调整偏好。已有安排不会被移动。`,
      ),
      { status: 422 },
    );
  return suggestions;
}

module.exports = {
  DEFAULTS,
  PREFERENCES_TABLE,
  normalizePreferences,
  clockMinutes,
  readPreferences,
  savePreferences,
  availableWindows,
  planWithPreferences,
};
