const crypto = require('node:crypto');
const { COURSE_SECTIONS } = require('./course-sections');

const DAY_MS = 86400000;
const MAX_WEEKS = 53;
const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const NUMBER = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

function validSemester(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,32}$/.test(value);
}

function normalizeMonday(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1 &&
    date.getUTCFullYear() >= 2000 &&
    date.getUTCFullYear() <= 2200
    ? value
    : null;
}

function parseWeeks(expression, parity) {
  const weeks = new Set();
  for (const part of expression.replace(/\s/g, '').split(/[,、]/)) {
    const match = /^(\d{1,2})(?:[-~至到](\d{1,2}))?$/.exec(part);
    if (!match) throw new Error('教学周格式无法识别，请核对周次。');
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end > MAX_WEEKS || end < start) {
      throw new Error('教学周必须在 1–53 周内且按起止顺序排列。');
    }
    for (let week = start; week <= end; week += 1) {
      if (!parity || (parity === '单' ? week % 2 === 1 : week % 2 === 0)) weeks.add(week);
    }
  }
  if (!weeks.size) throw new Error('周次和单双周条件没有匹配的教学周。');
  return [...weeks].sort((a, b) => a - b);
}

function minutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function parseTimes(text) {
  const explicit = [
    ...text.matchAll(
      /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)\s*[-~至到]\s*([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g,
    ),
  ];
  if (explicit.length) {
    if (/[大小]?节/.test(text))
      throw new Error('同一时段混用了钟点和节次，请核对后使用一种时间格式。');
    let remainder = text;
    for (const match of explicit) remainder = remainder.replace(match[0], '');
    if (/\d\s*:|:\s*\d/.test(remainder))
      throw new Error('部分上课钟点无法识别，请核对全部起止时间。');
    return explicit.map((match) => {
      const start = `${match[1].padStart(2, '0')}:${match[2]}`;
      const end = `${match[3].padStart(2, '0')}:${match[4]}`;
      if (minutes(end) <= minutes(start)) throw new Error('上课结束时间必须晚于开始时间。');
      return { start, end };
    });
  }
  const sections = [
    ...text.matchAll(
      /(?<![\d一二三四五六七八九十])第?([1-6一二三四五六])\s*(?:[-~至到]\s*([1-6一二三四五六]))?\s*大节/g,
    ),
  ];
  if (!sections.length || /第?\d+(?:[-~至到]\d+)?\s*(?:小节|节)/.test(text)) {
    throw new Error('缺少明确起止时间或第 1–6 大节；普通“节/小节”尚未配置时间映射。');
  }
  let remainder = text;
  for (const match of sections) remainder = remainder.replace(match[0], '');
  if (/大节|\d\s*:|:\s*\d/.test(remainder))
    throw new Error('部分节次或钟点无法识别，请核对全部上课时间。');
  return sections.map((match) => {
    if (/[\d一二三四五六][、,]\s*$/.test(text.slice(0, match.index))) {
      throw new Error('多个大节请分别写明，例如“第1大节、第3大节”。');
    }
    const start = NUMBER[match[1]] || Number(match[1]);
    const end = NUMBER[match[2]] || Number(match[2] || start);
    if (end < start) throw new Error('大节结束序号必须不早于开始序号。');
    return { start: COURSE_SECTIONS[start][0], end: COURSE_SECTIONS[end][1] };
  });
}

function parseCourseSchedule(course) {
  const text = String(course?.scheduleText || '')
    .normalize('NFKC')
    .replace(/[—–－]/g, '-')
    .replace(/[～]/g, '~')
    .replace(/\r/g, '')
    .trim();
  if (!text) return { sessions: [], issue: '网络学堂尚未提供该课程的上课时间。' };
  if (text.length > 2000) return { sessions: [], issue: '上课时间内容过长，需要核对。' };
  if (/单双|双单/.test(text))
    return { sessions: [], issue: '单双周说明存在歧义，请分别注明教学周。' };
  if (/停课|调课|补课|不上课|取消|另行|待定|除外|除[^;\n]*周|节假日|\d{1,2}月\d{1,2}/.test(text)) {
    return { sessions: [], issue: '课程含调停课或例外说明，需要核对具体日期后才能加入。' };
  }
  if (/或|(?:星期|周|礼拜)[一二三四五六日天1-7]\s*[,、]\s*[一二三四五六日天1-7]/.test(text)) {
    return { sessions: [], issue: '课程包含可选时段或省略的星期，请完整列出每次上课安排。' };
  }
  const sessions = [];
  try {
    for (const clause of text.split(/[;\n]+/).filter((part) => part.trim())) {
      const days = [...clause.matchAll(/(?:星期|礼拜|周)([一二三四五六日天1-7])/g)];
      if (!days.length) throw new Error('缺少可识别的上课星期。');
      const weekMatches = [
        ...clause.matchAll(
          /(?<![\d:\-~至到])第?((?:\d{1,2}\s*(?:[-~至到]\s*\d{1,2})?)(?:\s*[,、]\s*\d{1,2}\s*(?:[-~至到]\s*\d{1,2})?)*)\s*(?:教学)?周(?:\s*\(?\s*([单双])\s*周?\s*\)?)?/g,
        ),
      ];
      let remainder = clause;
      for (const match of weekMatches) remainder = remainder.replace(match[0], '#');
      if (/\d[\d\-~至到,、\s]*周/.test(remainder))
        throw new Error('部分教学周无法识别，请核对完整周次。');
      const leadingWeeks = weekMatches[0]?.index < days[0].index;
      if (leadingWeeks && weekMatches.some((match) => match.index > days.at(-1).index)) {
        throw new Error('教学周同时出现在星期前后，无法可靠确认对应关系，请分行注明每次课。');
      }
      let currentWeeks = null;
      for (let index = 0; index < days.length; index += 1) {
        const day = days[index];
        const previousIndex = index ? days[index - 1].index : -1;
        const nextIndex = days[index + 1]?.index ?? clause.length;
        const preceding = weekMatches.filter(
          (match) => match.index > previousIndex && match.index < day.index,
        );
        const trailing = weekMatches.filter(
          (match) => match.index > day.index && match.index < nextIndex,
        );
        const selectedWeeks = leadingWeeks ? preceding : trailing;
        if (selectedWeeks.length) {
          currentWeeks = [
            ...new Set(
              selectedWeeks.flatMap((weekMatch) => {
                const prefix = clause.slice(Math.max(0, weekMatch.index - 3), weekMatch.index);
                const parity = weekMatch[2] || /([单双])周?\s*$/.exec(prefix)?.[1];
                return parseWeeks(weekMatch[1], parity);
              }),
            ),
          ].sort((a, b) => a - b);
        } else if (!leadingWeeks) currentWeeks = null;
        if (!currentWeeks) throw new Error('缺少明确教学周范围，不能假设整学期每周上课。');
        const segmentEnd = leadingWeeks && trailing.length ? trailing[0].index : nextIndex;
        const segment = clause.slice(day.index + day[0].length, segmentEnd);
        const parityTokens = [...segment.matchAll(/([单双])(?:周|(?=\)))/g)].map(
          (match) => match[1],
        );
        if (new Set(parityTokens).size > 1 || /单双周/.test(segment)) {
          throw new Error('单双周说明存在歧义，请分别注明教学周。');
        }
        const parity = parityTokens[0];
        const sessionWeeks = parity
          ? currentWeeks.filter((week) => (parity === '单' ? week % 2 === 1 : week % 2 === 0))
          : currentWeeks;
        if (!sessionWeeks.length) throw new Error('周次和单双周条件没有匹配的教学周。');
        const dayNumber = WEEKDAY[day[1]] || Number(day[1]);
        for (const time of parseTimes(segment)) {
          sessions.push({ weekday: dayNumber, weeks: sessionWeeks, ...time });
        }
      }
    }
    return { sessions, issue: null };
  } catch (error) {
    return { sessions: [], issue: error.message };
  }
}

function projectCourseSchedules(
  courses,
  { semesterId, firstWeekMonday, range, fetchedAt = null } = {},
) {
  const events = new Map();
  const issues = [];
  const monday = normalizeMonday(firstWeekMonday);
  const anchor = monday ? Date.parse(`${monday}T00:00:00+08:00`) : null;
  const uniqueCourses = new Map();
  for (const course of Array.isArray(courses) ? courses : []) {
    if (typeof course?.sourceReference === 'string' && course.sourceReference) {
      uniqueCourses.set(course.sourceReference, course);
    }
  }
  let parsedCourses = 0;
  for (const course of uniqueCourses.values()) {
    const parsed = parseCourseSchedule(course);
    const issue = parsed.issue || (!monday ? '请先设置该学期第一教学周的周一日期。' : null);
    if (!parsed.issue) parsedCourses += 1;
    if (issue) {
      issues.push({ courseReference: course.sourceReference, title: course.title, message: issue });
      continue;
    }
    if (course.calendarSyncWarning) {
      issues.push({
        courseReference: course.sourceReference,
        title: course.title,
        message: course.calendarSyncWarning,
      });
    }
    for (const session of parsed.sessions) {
      for (const week of session.weeks) {
        const day = anchor + ((week - 1) * 7 + session.weekday - 1) * DAY_MS;
        const startAt = new Date(day + minutes(session.start) * 60000);
        const endAt = new Date(day + minutes(session.end) * 60000);
        if (range && (startAt >= range.end || endAt <= range.start)) continue;
        const reference = crypto
          .createHash('sha256')
          .update(
            JSON.stringify([
              semesterId,
              course.sourceReference,
              week,
              session.weekday,
              session.start,
              session.end,
            ]),
          )
          .digest('hex')
          .slice(0, 32);
        events.set(reference, {
          publicId: `cs_${reference}`,
          courseScheduleReference: reference,
          courseReference: course.sourceReference,
          semesterId,
          title: course.title || '未命名课程',
          description: [course.locationText, course.teacher, `第 ${week} 教学周`]
            .filter(Boolean)
            .join(' · '),
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          allDay: false,
          timezone: 'Asia/Shanghai',
          kind: 'course',
          sourceType: 'network_classroom',
          status: 'confirmed',
          updatedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
        });
      }
    }
  }
  return {
    events: [...events.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    issues,
    parsedCourses,
    totalCourses: uniqueCourses.size,
  };
}

function parseCoursesColumn(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadSnapshots(pool, userId, semesterId) {
  const [rows] = await pool.execute(
    `SELECT s.semester_id, s.courses_json, s.fetched_at, s.sync_status,
            s.connector_generation AS snapshot_generation, c.generation AS connector_generation,
            c.connected_at, settings.connector_generation AS settings_generation,
            DATE_FORMAT(settings.first_week_monday, '%Y-%m-%d') AS first_week_monday
     FROM campus_learn_semester_snapshots s
     INNER JOIN user_campus_connectors c ON c.user_id = s.user_id
       AND c.provider = 'tsinghua-learn' AND c.generation = s.connector_generation
     LEFT JOIN campus_course_calendar_settings settings ON settings.user_id = s.user_id
       AND settings.semester_id = s.semester_id AND settings.connector_generation = c.generation
     WHERE s.user_id = ? AND c.status IN ('active_verified', 'active_unverified', 'reauthorization_required')
       AND c.connected_at IS NOT NULL AND s.fetched_at >= c.connected_at
       ${semesterId ? 'AND s.semester_id = ?' : ''}
     ORDER BY s.fetched_at DESC`,
    semesterId ? [userId, semesterId] : [userId],
  );
  // Retain an application-level check as well as SQL scoping, including legacy snapshots.
  return rows.filter(
    (row) =>
      Number(row.snapshot_generation) > 0 &&
      Number(row.snapshot_generation) === Number(row.connector_generation) &&
      row.connected_at &&
      new Date(row.fetched_at) >= new Date(row.connected_at),
  );
}

function rowMonday(row) {
  return Number(row.settings_generation) === Number(row.connector_generation)
    ? normalizeMonday(row.first_week_monday)
    : null;
}

async function listCourseSchedules(pool, userId, range, status = '') {
  if (status && status !== 'confirmed') return [];
  const start = new Date(range?.start);
  const end = new Date(range?.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new TypeError('A valid course calendar range is required');
  }
  const rows = await loadSnapshots(pool, userId);
  const events = new Map();
  for (const row of rows) {
    const projected = projectCourseSchedules(parseCoursesColumn(row.courses_json), {
      semesterId: row.semester_id,
      firstWeekMonday: rowMonday(row),
      range: { start, end },
      fetchedAt: row.fetched_at,
    });
    for (const event of projected.events)
      if (!events.has(event.publicId)) events.set(event.publicId, event);
  }
  return [...events.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

async function readCourseCalendar(pool, userId, semesterId) {
  if (!validSemester(semesterId)) throw Object.assign(new Error('学期标识无效'), { status: 400 });
  const [row] = await loadSnapshots(pool, userId, semesterId);
  if (!row)
    return {
      semesterId,
      firstWeekMonday: null,
      issues: [
        {
          courseReference: null,
          title: '课程课表',
          message: '请先连接网络学堂并重新同步该学期课程。',
        },
      ],
      parsedCourses: 0,
      totalCourses: 0,
      scheduledLessons: 0,
      syncStatus: null,
      fetchedAt: null,
    };
  const firstWeekMonday = rowMonday(row);
  const result = projectCourseSchedules(parseCoursesColumn(row.courses_json), {
    semesterId,
    firstWeekMonday,
    fetchedAt: row.fetched_at,
  });
  return {
    semesterId,
    firstWeekMonday,
    issues: result.issues,
    parsedCourses: result.parsedCourses,
    totalCourses: result.totalCourses,
    scheduledLessons: result.events.length,
    syncStatus: row.sync_status,
    fetchedAt: new Date(row.fetched_at).toISOString(),
  };
}

async function saveCourseCalendar(pool, userId, { semesterId, firstWeekMonday } = {}) {
  if (!validSemester(semesterId) || !normalizeMonday(firstWeekMonday)) {
    throw Object.assign(new Error('请提供有效学期和第一教学周的周一日期（YYYY-MM-DD）'), {
      status: 400,
    });
  }
  const [result] = await pool.execute(
    `INSERT INTO campus_course_calendar_settings (user_id, semester_id, connector_generation, first_week_monday)
     SELECT c.user_id, s.semester_id, c.generation, ?
     FROM user_campus_connectors c
     INNER JOIN campus_learn_semester_snapshots s ON s.user_id = c.user_id
       AND s.connector_generation = c.generation AND s.semester_id = ?
     WHERE c.user_id = ? AND c.provider = 'tsinghua-learn'
       AND c.status IN ('active_verified', 'active_unverified', 'reauthorization_required')
       AND c.connected_at IS NOT NULL AND s.fetched_at >= c.connected_at
     ON DUPLICATE KEY UPDATE connector_generation = VALUES(connector_generation),
       first_week_monday = VALUES(first_week_monday), updated_at = CURRENT_TIMESTAMP`,
    [firstWeekMonday, semesterId, userId],
  );
  if (!result.affectedRows) {
    const existing = await readCourseCalendar(pool, userId, semesterId);
    if (existing.firstWeekMonday === firstWeekMonday) return existing;
    throw Object.assign(new Error('请先连接网络学堂并重新同步该学期课程'), { status: 409 });
  }
  return readCourseCalendar(pool, userId, semesterId);
}

module.exports = {
  listCourseSchedules,
  readCourseCalendar,
  saveCourseCalendar,
  projectCourseSchedules,
  parseCourseSchedule,
  normalizeMonday,
  validSemester,
};
