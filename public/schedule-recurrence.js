// Shared by browser previews and server validation; all dates use Beijing time.
(function install(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsScheduleRecurrence = api;
})(typeof window === 'object' ? window : globalThis, () => {
  const DAY = 86400000;
  const dayKey = (time) => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
  function expand({ startAt, endAt, recurrence } = {}) {
    const fail = (message) => {
      throw Object.assign(new Error(message), { status: 400 });
    };
    const start = typeof startAt === 'string' ? Date.parse(startAt) : NaN;
    const end = typeof endAt === 'string' ? Date.parse(endAt) : NaN;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      end - start > DAY ||
      new Date(start).getUTCFullYear() < 2000 ||
      new Date(end).getUTCFullYear() > 2200
    )
      fail('请填写有效起止时间，每次安排不超过 24 小时');
    if (
      !recurrence ||
      !['day', 'week'].includes(recurrence.unit) ||
      !Number.isInteger(recurrence.interval) ||
      recurrence.interval < 1 ||
      recurrence.interval > 365
    )
      fail('请选择重复周期；自定义支持每 1–365 天或周');
    const step = recurrence.interval * (recurrence.unit === 'week' ? 7 : 1) * DAY;
    const hasUntil = Object.hasOwn(recurrence, 'until');
    const hasCount = Object.hasOwn(recurrence, 'count');
    if (hasUntil === hasCount) fail('请选择截止日期或重复次数其中一种结束方式');
    let count = recurrence.count;
    if (hasUntil) {
      const until = recurrence.until;
      const stamp =
        typeof until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(until)
          ? Date.parse(`${until}T00:00:00+08:00`)
          : NaN;
      if (!Number.isFinite(stamp) || dayKey(stamp) !== until || until < dayKey(start))
        fail('重复截止日期不能早于首次安排，请填写有效日期');
      count = Math.floor((stamp + DAY - 1 - start) / step) + 1;
    }
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 200 ||
      (count - 1) * step > 730 * DAY ||
      new Date(end + (count - 1) * step).getUTCFullYear() > 2200
    )
      fail('一次最多生成 200 次安排，重复跨度不超过两年，请缩短日期范围');
    return Array.from({ length: count }, (_, index) => ({
      startAt: new Date(start + index * step).toISOString(),
      endAt: new Date(end + index * step).toISOString(),
    }));
  }
  return { expand };
});
