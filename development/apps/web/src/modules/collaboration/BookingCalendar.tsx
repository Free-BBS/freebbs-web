import { useEffect, useMemo, useState } from 'react';
import type { CollaborationSpace } from '@freebbs-development/contracts';
import './booking-calendar.css';

const dayMilliseconds = 24 * 60 * 60 * 1000;
const shanghaiOffset = 8 * 60 * 60 * 1000;
const dayKey = (time: number) => new Date(time + shanghaiOffset).toISOString().slice(0, 10);
const midnight = (day: string) => Date.parse(`${day}T00:00:00+08:00`);
const clock = (time: number) => new Date(time + shanghaiOffset).toISOString().slice(11, 16);

export function BookingCalendar({
  occupancy,
}: {
  occupancy: NonNullable<CollaborationSpace['bookingOccupancy']>;
}) {
  const [selectedDay, setSelectedDay] = useState(() => dayKey(Date.now()));
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [resource, setResource] = useState('');
  const resources = useMemo(
    () =>
      [...new Set(occupancy.map((booking) => booking.resource))].sort((a, b) =>
        a.localeCompare(b, 'zh-CN'),
      ),
    [occupancy],
  );
  useEffect(() => {
    if (resource && !resources.includes(resource)) setResource('');
  }, [resource, resources]);
  const activeResource = resources.includes(resource) ? resource : '';
  const today = dayKey(Date.now());
  const selectedStart = midnight(selectedDay);
  // Weeks start on Monday; dates and times always use Asia/Shanghai.
  const weekday = new Date(selectedStart + shanghaiOffset).getUTCDay();
  const start =
    mode === 'week' ? selectedStart - ((weekday + 6) % 7) * dayMilliseconds : selectedStart;
  const days = Array.from({ length: mode === 'week' ? 7 : 1 }, (_, index) => {
    const begins = start + index * dayMilliseconds;
    const ends = begins + dayMilliseconds;
    const groups = new Map<string, Array<{ start: number; end: number }>>();
    for (const booking of occupancy) {
      if (activeResource && booking.resource !== activeResource) continue;
      const bookingStart = Date.parse(booking.startsAt);
      const bookingEnd = Date.parse(booking.endsAt);
      if (
        bookingStart >= ends ||
        bookingEnd <= begins ||
        bookingEnd <= bookingStart ||
        !Number.isFinite(bookingStart) ||
        !Number.isFinite(bookingEnd)
      )
        continue;
      const times = groups.get(booking.resource) ?? [];
      times.push({ start: Math.max(begins, bookingStart), end: Math.min(ends, bookingEnd) });
      groups.set(booking.resource, times);
    }
    return {
      date: dayKey(begins),
      begins,
      ends,
      groups: [...groups].sort(([a], [b]) => a.localeCompare(b, 'zh-CN')),
    };
  });
  const move = (direction: number) =>
    setSelectedDay(dayKey(selectedStart + direction * (mode === 'week' ? 7 : 1) * dayMilliseconds));
  return (
    <section className="booking-calendar booking-calendar--refined" aria-label="预约占用日历">
      <header>
        <div>
          <h2>预约占用日历</h2>
          <p>北京时间 · 已成功提交的预约占用资源，仅展示资源与时间。</p>
        </div>
        <div className="booking-calendar-modes" aria-label="日历视图">
          <button type="button" aria-pressed={mode === 'day'} onClick={() => setMode('day')}>
            日视图
          </button>
          <button type="button" aria-pressed={mode === 'week'} onClick={() => setMode('week')}>
            周视图
          </button>
        </div>
      </header>
      <div className="booking-calendar-navigation">
        <button type="button" onClick={() => setSelectedDay(dayKey(Date.now()))}>
          今天
        </button>
        <button type="button" onClick={() => move(-1)}>
          {mode === 'week' ? '上一周' : '上一天'}
        </button>
        <label>
          日历日期
          <input
            aria-label="日历日期"
            type="date"
            value={selectedDay}
            onChange={(event) => {
              if (event.target.value && Number.isFinite(midnight(event.target.value)))
                setSelectedDay(event.target.value);
            }}
          />
        </label>
        <button type="button" onClick={() => move(1)}>
          {mode === 'week' ? '下一周' : '下一天'}
        </button>
        <label className="booking-calendar-filter">
          资源筛选
          <select
            aria-label="资源筛选"
            value={activeResource}
            onChange={(event) => setResource(event.target.value)}
          >
            <option value="">全部资源</option>
            {resources.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="booking-calendar-scroll"
        role="region"
        aria-label={mode === 'week' ? '本周资源占用，可横向滚动' : '当天资源占用'}
        tabIndex={mode === 'week' ? 0 : undefined}
      >
        <div className={`booking-calendar-days booking-calendar-days--${mode}`} aria-live="polite">
          {days.map((day) => (
            <article
              className={`booking-calendar-day${day.date === today ? ' booking-calendar-day--today' : ''}`}
              key={day.date}
              aria-label={`${day.date}资源占用`}
            >
              <h3>
                <time dateTime={day.date} aria-current={day.date === today ? 'date' : undefined}>
                  {day.date}
                </time>
                {day.date === today && <small>今天</small>}
                <span>
                  {new Date(midnight(day.date)).toLocaleDateString('zh-CN', {
                    weekday: 'short',
                    timeZone: 'Asia/Shanghai',
                  })}
                </span>
              </h3>
              {day.groups.length === 0 ? (
                <p className="booking-calendar-free">当天暂无预约占用</p>
              ) : (
                day.groups.map(([resource, times]) => (
                  <div className="booking-calendar-resource" key={resource}>
                    <h4>{resource}</h4>
                    <div className="booking-calendar-axis" aria-hidden="true">
                      <span>00:00</span>
                      <span>12:00</span>
                      <span>24:00</span>
                    </div>
                    <ul>
                      {times
                        .sort((a, b) => a.start - b.start || a.end - b.end)
                        .map((time, index) => (
                          <li key={`${time.start}:${time.end}:${index}`}>
                            <span>
                              {clock(time.start)} —{' '}
                              {time.end === day.ends ? '24:00' : clock(time.end)}
                            </span>
                            <small>已预约</small>
                            <div className="booking-calendar-rail" aria-hidden="true">
                              <span
                                style={{
                                  left: `${((time.start - day.begins) / dayMilliseconds) * 100}%`,
                                  width: `${((time.end - time.start) / dayMilliseconds) * 100}%`,
                                }}
                              />
                            </div>
                          </li>
                        ))}
                    </ul>
                  </div>
                ))
              )}
            </article>
          ))}
        </div>
      </div>
      {mode === 'week' && days.every((day) => day.groups.length === 0) && (
        <p className="booking-calendar-free" role="status">
          本周暂无预约占用
        </p>
      )}
    </section>
  );
}
