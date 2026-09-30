(function exposeCalendar(root) {
  const HOUR = 3600000;
  const HOUR_HEIGHT = 48;
  function deadlineState(value, completed = false, now = Date.now()) {
    if (completed) return 'done';
    if (!value || !Number.isFinite(Date.parse(value))) return 'none';
    const remaining = Date.parse(value) - now;
    if (remaining < 0) return 'overdue';
    if (remaining <= 24 * HOUR) return 'critical';
    if (remaining <= 72 * HOUR) return 'soon';
    return 'safe';
  }
  function deadlineRemaining(value, completed = false, now = Date.now()) {
    if (completed) return '已完成';
    if (!value || !Number.isFinite(Date.parse(value))) return '截止时间待确认';
    const remaining = Date.parse(value) - now;
    if (remaining === 0) return '已到截止时间';
    const prefix = remaining > 0 ? '剩余：' : '已逾期：';
    if (Math.abs(remaining) < 60000) return `${prefix}不到 1 分钟`;
    const minutes = remaining > 0 ? Math.ceil(remaining / 60000) : Math.floor(-remaining / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const rest = minutes % 60;
    if (days) return `${prefix}${days} 天${hours ? ` ${hours} 小时` : ''}`;
    if (hours) return `${prefix}${hours} 小时${rest ? ` ${rest} 分钟` : ''}`;
    return `${prefix}${rest} 分钟`;
  }
  function colorIndex(item) {
    const key =
      item.seriesKey ||
      (item.courseReference
        ? `course:${item.semesterId || ''}:${item.courseReference}`
        : `${item.kind || 'event'}:${String(item.title || '')
            .normalize('NFKC')
            .trim()
            .replace(/\s+/g, ' ')}`);
    let hash = 0;
    for (const char of key) hash = (hash * 31 + char.codePointAt(0)) % 4294967296;
    return hash % 6;
  }
  // Exact, half-open intervals. DDLs are instants, not occupied study time.
  function conflicts(items, from = -Infinity, to = Infinity) {
    const timed = items
      .filter(
        (item) =>
          !item.allDay &&
          item.kind !== 'deadline' &&
          !item.completed &&
          (!item.status || item.status === 'confirmed'),
      )
      .map((item) => ({
        item,
        start: Math.max(Date.parse(item.startAt), from),
        end: Math.min(Date.parse(item.endAt), to),
      }))
      .filter(
        (entry) =>
          Number.isFinite(entry.start) && Number.isFinite(entry.end) && entry.start < entry.end,
      )
      .sort(
        (a, b) =>
          a.start - b.start ||
          a.end - b.end ||
          String(a.item.publicId).localeCompare(String(b.item.publicId)),
      );
    const pairs = [];
    for (let i = 0; i < timed.length; i += 1) {
      for (let j = i + 1; j < timed.length && timed[j].start < timed[i].end; j += 1) {
        const a = timed[i];
        const b = timed[j];
        if (a.item.publicId === b.item.publicId) continue;
        pairs.push({
          a: a.item,
          b: b.item,
          start: Math.max(a.start, b.start),
          end: Math.min(a.end, b.end),
        });
      }
    }
    return pairs;
  }
  function timeBlock(start, end, windowStart, pixelsPerHour = HOUR_HEIGHT) {
    const top = ((start - windowStart) / HOUR) * pixelsPerHour;
    const bottom = ((end - windowStart) / HOUR) * pixelsPerHour;
    return { top, end: bottom, height: Math.max(0, bottom - top) };
  }
  function displayTimeBlock(start, end, windowStart, pixelsPerHour = HOUR_HEIGHT) {
    const actual = timeBlock(start, end, windowStart, pixelsPerHour);
    const height = Math.max(pixelsPerHour / 2, actual.height);
    return { top: actual.top, end: actual.top + height, height, expanded: height > actual.height };
  }
  function overviewHourHeight(availableHeight, headingHeight, durationHours = 16) {
    // Reserve a half-hour display box below midnight without moving any hour tick.
    return Math.max(
      16,
      Math.min(
        HOUR_HEIGHT,
        Math.floor(((availableHeight - headingHeight - 24 - 2) / durationHours) * 100) / 100,
      ),
    );
  }
  function shortEventGroups(entries) {
    const short = entries.filter((entry) => entry.endMs - entry.startMs <= HOUR / 2);
    const long = entries.filter((entry) => entry.endMs - entry.startMs > HOUR / 2);
    const components = [];
    for (const entry of [...short].sort((a, b) => a.top - b.top)) {
      const previous = components.at(-1);
      if (previous && entry.top < previous.end - 0.01) {
        previous.short.push(entry);
        previous.end = Math.max(previous.end, entry.end);
      } else components.push({ short: [entry], top: entry.top, end: entry.end });
    }
    return components
      .map((component) => ({
        ...component,
        members: [
          ...component.short,
          ...long.filter(
            (entry) => entry.top < component.end - 0.01 && entry.end > component.top + 0.01,
          ),
        ].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs),
      }))
      .filter((component) => component.members.length > 1);
  }
  const api = {
    HOUR_HEIGHT,
    deadlineState,
    deadlineRemaining,
    colorIndex,
    conflicts,
    timeBlock,
    displayTimeBlock,
    overviewHourHeight,
    shortEventGroups,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsWorkbenchCalendar = api;
})(typeof window !== 'undefined' ? window : globalThis);
