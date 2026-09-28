(function init(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FreeBbsAcademicCalendar = factory();
})(typeof window === 'undefined' ? globalThis : window, () => {
  const DEFAULTS = Object.freeze({
    '2026-2027-1': Object.freeze({
      firstWeekMonday: '2026-09-14',
      teachingWeeks: 16,
      holidayPreset: 'tsinghua-2026-autumn',
    }),
  });
  const calendars = new Map(Object.entries(DEFAULTS));
  function format(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (key) => parts.find((part) => part.type === key).value;
    const day = Date.parse(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
      new Date(day).getUTCDay()
    ];
    const label = `${Number(get('month'))}月${Number(get('day'))}日`;
    for (const calendar of [...calendars.values()].reverse()) {
      const offset = Math.floor(
        (day - Date.parse(`${calendar.firstWeekMonday}T00:00:00Z`)) / 86400000,
      );
      if (offset >= 0 && offset < calendar.teachingWeeks * 7)
        return `${label} 校历第${Math.floor(offset / 7) + 1}周${weekday}`;
    }
    return `${label} ${weekday}`;
  }
  function setSemester(value) {
    if (value?.semesterId && value.firstWeekMonday && value.teachingWeeks)
      calendars.set(value.semesterId, {
        firstWeekMonday: value.firstWeekMonday,
        teachingWeeks: value.teachingWeeks,
      });
  }
  function reset() {
    calendars.clear();
    Object.entries(DEFAULTS).forEach(([id, value]) => calendars.set(id, value));
  }
  return { DEFAULTS, format, setSemester, reset };
});
