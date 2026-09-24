const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MYSQL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;
const ZONED_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/i;

function validDate(date: Date, message: string): Date {
  if (Number.isNaN(date.getTime())) throw new TypeError(message);
  // Check the normalized UTC instant, not the year written before an offset.
  if (date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) {
    throw new TypeError('UTC date-time is outside the MySQL DATETIME range');
  }
  return date;
}
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function encodeUtcDateTime(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return new Date(validDate(value, 'Invalid UTC date-time').getTime());
  const match = ZONED_INSTANT.exec(value);
  if (!match) {
    throw new TypeError('UTC date-time must include Z or an explicit numeric offset');
  }
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fraction = '',
    zone,
    offsetSign,
    offsetHourText = '0',
    offsetMinuteText = '0',
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3));
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw new TypeError('Invalid UTC date-time components');
  }
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, milliseconds);
  const offsetDirection = offsetSign === '-' ? -1 : 1;
  const offsetMilliseconds =
    zone.toUpperCase() === 'Z' ? 0 : offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
  return validDate(new Date(local.getTime() - offsetMilliseconds), 'Invalid UTC date-time');
}

export function decodeUtcDateTime(value: unknown): string {
  if (value instanceof Date) return validDate(value, 'Invalid UTC date-time').toISOString();
  if (typeof value !== 'string') throw new TypeError('Invalid UTC date-time from MySQL');
  const mysql = MYSQL_DATETIME.exec(value);
  if (mysql) {
    const [, year, month, day, hour, minute, second, fraction = ''] = mysql;
    const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3));
    const date = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        milliseconds,
      ),
    );
    if (
      date.getUTCFullYear() !== Number(year) ||
      date.getUTCMonth() !== Number(month) - 1 ||
      date.getUTCDate() !== Number(day) ||
      date.getUTCHours() !== Number(hour) ||
      date.getUTCMinutes() !== Number(minute) ||
      date.getUTCSeconds() !== Number(second) ||
      date.getUTCMilliseconds() !== milliseconds
    ) {
      throw new TypeError('Invalid UTC date-time from MySQL');
    }
    return validDate(date, 'Invalid UTC date-time from MySQL').toISOString();
  }
  const encoded = encodeUtcDateTime(value);
  if (!encoded) throw new TypeError('Invalid UTC date-time from MySQL');
  return encoded.toISOString();
}

export function encodeDateOnly(value: string): string {
  const match = DATE_ONLY.exec(value);
  if (!match) throw new TypeError('DATE must be a YYYY-MM-DD calendar date');
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new TypeError('DATE must be a valid calendar date');
  }
  return value;
}

export const decodeDateOnly = encodeDateOnly;
