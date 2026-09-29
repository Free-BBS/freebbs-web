// Calendar dates supplied by the university's 2026–2027 academic calendar.
// No national make-up workday is inferred to be a teaching day.
const CALENDAR_PRESETS = Object.freeze([
  {
    id: 'tsinghua-2026-autumn',
    name: '清华 2026–2027 秋季学期',
    firstWeekMonday: '2026-09-14',
    holidays: [
      { start: '2026-09-25', end: '2026-09-25', name: '中秋节' },
      { start: '2026-10-01', end: '2026-10-07', name: '国庆节' },
      { start: '2027-01-01', end: '2027-01-01', name: '元旦' },
    ],
  },
  {
    id: 'tsinghua-2027-spring',
    name: '清华 2027 春季学期',
    firstWeekMonday: '2027-02-22',
    holidays: [
      { start: '2027-04-05', end: '2027-04-05', name: '清明节' },
      { start: '2027-04-30', end: '2027-05-05', name: '校庆及劳动节' },
      { start: '2027-06-09', end: '2027-06-09', name: '端午节' },
    ],
  },
]);

const SECTION_CHOICES = Object.freeze({
  2: [
    { count: 2, start: '09:50', end: '11:25' },
    { count: 3, start: '09:50', end: '12:15' },
  ],
  5: [
    { count: 1, start: '17:05', end: '17:50' },
    { count: 2, start: '17:05', end: '18:40' },
  ],
  6: [
    { count: 2, start: '19:20', end: '20:55' },
    { count: 3, start: '19:20', end: '21:45' },
  ],
});

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCFullYear() >= 2000 &&
    date.getUTCFullYear() <= 2200
  );
}

function normalizeCalendarOptions(value = {}, firstWeekMonday = null) {
  const bad = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('校历设置无效');
  const holidayPreset = value.holidayPreset || '';
  const preset = CALENDAR_PRESETS.find((item) => item.id === holidayPreset);
  if (holidayPreset && (!preset || preset.firstWeekMonday !== firstWeekMonday))
    bad('校历预设与第一教学周日期不一致，请核对学期或选择自定义校历');
  const dates = (list = []) => {
    if (!Array.isArray(list) || list.length > 371 || list.some((date) => !validDate(date)))
      bad('例外日期请填写有效的 YYYY-MM-DD 日期，最多 371 天');
    return [...new Set(list)].sort();
  };
  const skipDates = dates(value.skipDates);
  const includeDates = dates(value.includeDates);
  if (skipDates.some((date) => includeDates.includes(date))) bad('同一天不能同时停课和保留上课');
  const entries = value.courseSections || {};
  if (typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length > 500)
    bad('课程节次设置无效');
  const courseSections = Object.create(null);
  for (const [reference, counts] of Object.entries(entries)) {
    if (
      !reference ||
      reference.length > 512 ||
      !counts ||
      typeof counts !== 'object' ||
      Array.isArray(counts)
    )
      bad('课程节次设置无效');
    const next = {};
    for (const [section, count] of Object.entries(counts)) {
      if (
        !Object.hasOwn(SECTION_CHOICES, section) ||
        !SECTION_CHOICES[section].some((item) => item.count === count)
      )
        bad('第 2、6 大节可选 2/3 小节，第 5 大节可选 1/2 小节');
      next[section] = count;
    }
    courseSections[reference] = next;
  }
  return { holidayPreset, skipDates, includeDates, courseSections };
}

function holidayForDate(date, options) {
  if (options.includeDates?.includes(date)) return null;
  if (options.skipDates?.includes(date)) return '自定义停课';
  return (
    CALENDAR_PRESETS.find((item) => item.id === options.holidayPreset)?.holidays.find(
      (item) => date >= item.start && date <= item.end,
    )?.name || null
  );
}

module.exports = { CALENDAR_PRESETS, SECTION_CHOICES, normalizeCalendarOptions, holidayForDate };
