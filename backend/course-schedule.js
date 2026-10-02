const crypto = require('node:crypto');
const { COURSE_SECTIONS } = require('./course-sections');
const { normalizeHtmlText } = require('./tsinghua-learn-connector');
const {
  CALENDAR_PRESETS,
  SECTION_CHOICES,
  normalizeCalendarOptions,
  holidayForDate,
} = require('./course-calendar-options');
const { loadCourseOverrides, applyOverride } = require('./campus-schedule-overrides');
const { DEFAULTS } = require('../public/academic-calendar');

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

function normalizeTeachingWeeks(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_WEEKS
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
    return {
      start: COURSE_SECTIONS[start][0],
      end: COURSE_SECTIONS[end][1],
      sectionStart: start,
      sectionEnd: end,
    };
  });
}

function parseCourseSchedule(course, { teachingWeeks = null, includeSections = false } = {}) {
  let text = String(course?.scheduleText || '')
    .normalize('NFKC')
    .replace(/[—–－]/g, '-')
    .replace(/[～]/g, '~')
    .replace(/\r/g, '')
    .trim();
  if (!text)
    return {
      sessions: [],
      issue: '此次同步未取得课程时间，可重新同步或在“新增安排”中手动添加课程。',
    };
  if (text.length > 2000) return { sessions: [], issue: '上课时间内容过长，需要核对。' };
  if (/…|\.{3}/.test(text))
    return { sessions: [], issue: '课程时间被截断，请同步完整时间或手动添加。' };
  // Only the known campus provider uses “节” to denote these six large blocks.
  if (course.sectionSystem === 'tsinghua-large') {
    text = text
      .replace(/第([1-6](?:\s*[,、]\s*[1-6])*)节/g, (_, list) =>
        list
          .split(/[,、]/)
          .map((part) => `第${part.trim()}大节`)
          .join('、'),
      )
      .replace(/第([1-6])\s*[-~至到]\s*([1-6])节/g, '第$1-$2大节');
  }
  if (/单双|双单/.test(text))
    return { sessions: [], issue: '单双周说明存在歧义，请分别注明教学周。' };
  if (/停课|调课|补课|不上课|取消|另行|待定|除外|除[^;\n]*周|节假日|\d{1,2}月\d{1,2}/.test(text)) {
    return { sessions: [], issue: '课程含调停课或例外说明，需要核对具体日期后才能加入。' };
  }
  if (/或|(?:星期|周|礼拜)[一二三四五六日天1-7]\s*[,、]\s*[一二三四五六日天1-7]/.test(text)) {
    return { sessions: [], issue: '课程包含可选时段或省略的星期，请完整列出每次上课安排。' };
  }
  // Campus half-semester labels are fixed teaching-week ranges, not the last
  // eight weeks of a configurable calendar (e.g. an 18-week semester).
  text = text.replace(/前(?:八|8)周/g, '第1-8周').replace(/后(?:八|8)周/g, '第9-16周');
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
        const segmentEnd = leadingWeeks && trailing.length ? trailing[0].index : nextIndex;
        let segment = clause.slice(day.index + day[0].length, segmentEnd);
        // Preserve the room belonging to each time, not just one room per course.
        const room = /[,，]\s*([^,，]+)$/.exec(segment);
        let location = '';
        if (room && !/周|节|星期|礼拜|\d\s*:|:\s*\d/.test(room[1])) {
          location = room[1].trim();
          segment = segment.slice(0, room.index);
        }
        const cycleLabels = [...segment.matchAll(/([全单双])周/g)].map((match) => match[1]);
        if (new Set(cycleLabels).size > 1)
          throw new Error('同一时段的全周或单双周说明存在冲突，请核对课程时间。');
        let calendarWeeks = false;
        if (!currentWeeks) {
          if (!cycleLabels.length) throw new Error('缺少明确教学周范围，不能假设整学期每周上课。');
          const count = normalizeTeachingWeeks(teachingWeeks);
          if (!count)
            throw new Error(
              '已读取上课星期与节次，但“全周／单双周”未包含起止周；请填写并确认本学期教学周数。',
            );
          currentWeeks = Array.from({ length: count }, (_, week) => week + 1);
          calendarWeeks = true;
        }
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
          if (!includeSections) {
            delete time.sectionStart;
            delete time.sectionEnd;
          }
          sessions.push({
            weekday: dayNumber,
            weeks: sessionWeeks,
            ...time,
            ...(location ? { location } : {}),
            ...(calendarWeeks ? { weekSource: 'calendar' } : {}),
          });
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
  {
    semesterId,
    firstWeekMonday,
    teachingWeeks = null,
    range,
    fetchedAt = null,
    options = {},
    includeExcluded = false,
  } = {},
) {
  const events = new Map();
  const issues = [];
  const calendarOptions = normalizeCalendarOptions(options, firstWeekMonday);
  let skippedLessons = 0;
  const monday = normalizeMonday(firstWeekMonday);
  const anchor = monday ? Date.parse(`${monday}T00:00:00+08:00`) : null;
  const uniqueCourses = new Map();
  for (const course of Array.isArray(courses) ? courses : []) {
    if (typeof course?.sourceReference === 'string' && course.sourceReference) {
      uniqueCourses.set(course.sourceReference, {
        ...course,
        title: normalizeHtmlText(course.title, 200),
      });
    }
  }
  let parsedCourses = 0;
  for (const course of uniqueCourses.values()) {
    const parsed = parseCourseSchedule(course, { teachingWeeks, includeSections: true });
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
    const occurrences = [];
    for (const session of parsed.sessions) {
      const counts = calendarOptions.courseSections[course.sourceReference] || {};
      const startChoice = SECTION_CHOICES[session.sectionStart]?.find(
        (item) => item.count === counts[session.sectionStart],
      );
      const endChoice = SECTION_CHOICES[session.sectionEnd]?.find(
        (item) => item.count === counts[session.sectionEnd],
      );
      for (const week of session.weeks)
        occurrences.push({
          ...session,
          week,
          location: session.location || course.locationText || '',
          start: startChoice?.start || session.start,
          end: endChoice?.end || session.end,
        });
    }
    const uniqueOccurrences = [
      ...new Map(
        occurrences.map((session) => [
          JSON.stringify([
            session.week,
            session.weekday,
            session.start,
            session.end,
            session.location,
          ]),
          session,
        ]),
      ).values(),
    ];
    uniqueOccurrences.sort(
      (a, b) =>
        a.week - b.week ||
        a.weekday - b.weekday ||
        a.location.localeCompare(b.location) ||
        a.start.localeCompare(b.start),
    );
    const merged = [];
    for (const session of uniqueOccurrences) {
      const previous = merged.at(-1);
      if (
        previous &&
        previous.week === session.week &&
        previous.weekday === session.weekday &&
        previous.location === session.location &&
        previous.sectionEnd &&
        previous.sectionEnd + 1 === session.sectionStart &&
        minutes(session.start) - minutes(previous.end) >= 0 &&
        minutes(session.start) - minutes(previous.end) <= 30
      ) {
        previous.end = session.end;
        previous.sectionEnd = session.sectionEnd;
      } else merged.push({ ...session });
    }
    for (const session of merged) {
      const { week } = session;
      const day = anchor + ((week - 1) * 7 + session.weekday - 1) * DAY_MS;
      const startAt = new Date(day + minutes(session.start) * 60000);
      const endAt = new Date(day + minutes(session.end) * 60000);
      const calendarHoliday = holidayForDate(
        new Date(day + 8 * 3600000).toISOString().slice(0, 10),
        calendarOptions,
      );
      if (calendarHoliday) {
        skippedLessons += 1;
        if (!includeExcluded) continue;
      }
      if (range && (startAt >= range.end || endAt <= range.start)) continue;
      const reference = crypto
        .createHash('sha256')
        .update(
          JSON.stringify([
            semesterId,
            course.sourceReference,
            week,
            session.weekday,
            session.sectionStart ? `section:${session.sectionStart}` : session.start,
            session.sectionEnd ? `section:${session.sectionEnd}` : session.end,
          ]),
        )
        .digest('hex')
        .slice(0, 32);
      events.set(reference, {
        publicId: `cs_${reference}`,
        courseScheduleReference: reference,
        courseReference: course.sourceReference,
        semesterId,
        calendarHoliday,
        sectionStart: session.sectionStart || null,
        sectionEnd: session.sectionEnd || null,
        title: course.title || '未命名课程',
        description: session.location || course.locationText || '',
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
  return {
    events: [...events.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    issues,
    parsedCourses,
    totalCourses: uniqueCourses.size,
    skippedLessons,
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
    `SELECT s.semester_id, s.calendar_copy_json,
            JSON_EXTRACT(s.calendar_copy_json, '$.courses') AS courses_json,
            JSON_UNQUOTE(JSON_EXTRACT(s.calendar_copy_json, '$.fetchedAt')) AS fetched_at,
            s.sync_status,
            JSON_EXTRACT(s.calendar_copy_json, '$.generation') AS snapshot_generation,
            JSON_EXTRACT(s.calendar_copy_json, '$.generation') AS connector_generation,
            settings.connector_generation AS settings_generation,
            DATE_FORMAT(settings.first_week_monday, '%Y-%m-%d') AS first_week_monday,
            settings.teaching_weeks, settings.options_json
     FROM campus_learn_semester_snapshots s
     LEFT JOIN campus_course_calendar_settings settings ON settings.user_id = s.user_id
       AND settings.semester_id = s.semester_id AND settings.connector_generation > 0
     WHERE s.user_id = ? AND s.calendar_copy_json IS NOT NULL
       ${semesterId ? 'AND s.semester_id = ?' : ''}
     ORDER BY s.fetched_at DESC`,
    semesterId ? [userId, semesterId] : [userId],
  );
  // Synced courses belong to the local user, independently of the live grant.
  // Keep the snapshot generation for calendar settings and personal edits; never
  // reinterpret it as the latest connection generation after expiry/revocation.
  return rows
    .map((row) => {
      const copy =
        typeof row.calendar_copy_json === 'string'
          ? JSON.parse(row.calendar_copy_json)
          : row.calendar_copy_json;
      if (!copy) return row;
      return {
        ...row,
        savedEvents: copy.events,
        settings_generation: copy.generation,
        first_week_monday: copy.firstWeekMonday,
        teaching_weeks: copy.teachingWeeks,
        options_json: copy.options || {},
      };
    })
    .filter(
      (row) =>
        Number(row.snapshot_generation) > 0 &&
        Number(row.snapshot_generation) === Number(row.connector_generation) &&
        Number.isFinite(new Date(row.fetched_at).getTime()),
    );
}

function rowMonday(row) {
  const saved = Number(row.settings_generation) > 0 ? normalizeMonday(row.first_week_monday) : null;
  return saved || DEFAULTS[row.semester_id]?.firstWeekMonday || null;
}

function rowTeachingWeeks(row) {
  const saved =
    Number(row.settings_generation) > 0 ? normalizeTeachingWeeks(row.teaching_weeks) : null;
  return saved || DEFAULTS[row.semester_id]?.teachingWeeks || null;
}

function rowOptions(row) {
  if (!(Number(row.settings_generation) > 0) || !row.options_json) {
    const preset = DEFAULTS[row.semester_id];
    return preset && rowMonday(row) === preset.firstWeekMonday
      ? { holidayPreset: preset.holidayPreset }
      : {};
  }
  return typeof row.options_json === 'string' ? JSON.parse(row.options_json) : row.options_json;
}

async function listCourseSchedules(
  pool,
  userId,
  range,
  status = '',
  { includeDeleted = false } = {},
) {
  if (status && status !== 'confirmed') return [];
  const start = new Date(range?.start);
  const end = new Date(range?.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new TypeError('A valid course calendar range is required');
  }
  const rows = await loadSnapshots(pool, userId);
  const overrides = rows.length ? await loadCourseOverrides(pool, userId) : new Map();
  const events = new Map();
  for (const row of rows) {
    const projected = Array.isArray(row.savedEvents)
      ? { events: row.savedEvents }
      : projectCourseSchedules(parseCoursesColumn(row.courses_json), {
          semesterId: row.semester_id,
          firstWeekMonday: rowMonday(row),
          teachingWeeks: rowTeachingWeeks(row),
          options: rowOptions(row),
          includeExcluded: true,
          fetchedAt: row.fetched_at,
        });
    for (const original of projected.events) {
      const override = overrides.get(original.publicId);
      const { importedSeriesKey } = require('./schedule-series');
      const seriesKey = importedSeriesKey(original);
      const patch = override
        ? typeof override.patch_json === 'string'
          ? JSON.parse(override.patch_json)
          : override.patch_json
        : {};
      const policyRow = overrides.get(`cs_series_${seriesKey.slice(7)}`);
      const policy = policyRow
        ? typeof policyRow.patch_json === 'string'
          ? JSON.parse(policyRow.patch_json)
          : policyRow.patch_json
        : {};
      const exception = Boolean(override && !patch.seriesManaged);
      const deleted = Boolean(
        patch.deleted ||
        (policy.suppressedFrom && original.startAt >= policy.suppressedFrom && !exception),
      );
      const event = applyOverride(
        {
          ...original,
          connectorGeneration: Number(row.connector_generation),
          seriesKey,
          originalStartAt: original.startAt,
          originalEndAt: original.endAt,
        },
        includeDeleted && patch.deleted
          ? { ...override, patch_json: { ...patch, deleted: false } }
          : override,
      );
      if (
        !event ||
        (deleted && !includeDeleted) ||
        (original.calendarHoliday && event.startAt === original.startAt)
      )
        continue;
      if (new Date(event.startAt) >= end || new Date(event.endAt) <= start) continue;
      if (!events.has(event.publicId))
        events.set(event.publicId, { ...event, deleted, exception, personalPatch: patch });
    }
  }
  return [...events.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

async function readCourseCalendar(pool, userId, semesterId) {
  if (!validSemester(semesterId)) throw Object.assign(new Error('学期标识无效'), { status: 400 });
  const [row] = await loadSnapshots(pool, userId, semesterId);
  if (!row)
    return {
      semesterId,
      imported: false,
      firstWeekMonday: DEFAULTS[semesterId]?.firstWeekMonday || null,
      teachingWeeks: DEFAULTS[semesterId]?.teachingWeeks || null,
      options: normalizeCalendarOptions(),
      presets: CALENDAR_PRESETS,
      sectionChoices: SECTION_CHOICES,
      courses: [],
      issues: [
        {
          courseReference: null,
          title: '课程课表',
          message: '确认接入后，课程会保存为个人安排。',
        },
      ],
      parsedCourses: 0,
      totalCourses: 0,
      scheduledLessons: 0,
      syncStatus: null,
      fetchedAt: null,
    };
  const firstWeekMonday = rowMonday(row);
  const teachingWeeks = rowTeachingWeeks(row);
  const options = rowOptions(row);
  const courses = parseCoursesColumn(row.courses_json);
  const result = projectCourseSchedules(courses, {
    semesterId,
    firstWeekMonday,
    teachingWeeks,
    options,
    fetchedAt: row.fetched_at,
  });
  return {
    semesterId,
    imported: true,
    firstWeekMonday,
    teachingWeeks,
    options: normalizeCalendarOptions(options, firstWeekMonday),
    presets: CALENDAR_PRESETS,
    sectionChoices: SECTION_CHOICES,
    courses: courses
      .map((course) => ({
        reference: course.sourceReference,
        title: normalizeHtmlText(course.title, 200),
        sections: [
          ...new Set(
            parseCourseSchedule(course, { teachingWeeks, includeSections: true }).sessions.flatMap(
              (session) =>
                session.sectionStart
                  ? Array.from(
                      { length: session.sectionEnd - session.sectionStart + 1 },
                      (_, i) => session.sectionStart + i,
                    )
                  : [],
            ),
          ),
        ].filter((section) => Object.hasOwn(SECTION_CHOICES, section)),
      }))
      .filter((course) => course.sections.length),
    skippedLessons: result.skippedLessons,
    issues: result.issues,
    parsedCourses: result.parsedCourses,
    totalCourses: result.totalCourses,
    scheduledLessons: result.events.length,
    syncStatus: row.sync_status,
    fetchedAt: new Date(row.fetched_at).toISOString(),
  };
}

async function saveCourseCalendar(pool, userId, settings = {}) {
  const { semesterId, firstWeekMonday, teachingWeeks } = settings;
  const providedWeeks = Object.hasOwn(settings, 'teachingWeeks');
  const count = normalizeTeachingWeeks(teachingWeeks);
  const providedOptions = Object.hasOwn(settings, 'options');
  const options = providedOptions
    ? normalizeCalendarOptions(settings.options, firstWeekMonday)
    : null;
  if (providedWeeks && teachingWeeks !== null && count === null)
    throw Object.assign(new Error('教学周数必须是 1–53 的整数；不确定时可留空'), { status: 400 });
  if (!validSemester(semesterId) || !normalizeMonday(firstWeekMonday)) {
    throw Object.assign(new Error('请提供有效学期和第一教学周的周一日期（YYYY-MM-DD）'), {
      status: 400,
    });
  }
  const [result] = await pool.execute(
    `INSERT INTO campus_course_calendar_settings (user_id, semester_id, connector_generation, first_week_monday, teaching_weeks, options_json)
     SELECT s.user_id, s.semester_id, s.connector_generation, ?, ?, ?
     FROM campus_learn_semester_snapshots s
     WHERE s.semester_id = ? AND s.user_id = ? AND s.connector_generation > 0
     ON DUPLICATE KEY UPDATE
       options_json = IF(?, VALUES(options_json),
         IF(campus_course_calendar_settings.first_week_monday <> VALUES(first_week_monday),
           JSON_SET(COALESCE(campus_course_calendar_settings.options_json, JSON_OBJECT()), '$.holidayPreset', ''),
           campus_course_calendar_settings.options_json)),
       teaching_weeks = IF(?, VALUES(teaching_weeks), campus_course_calendar_settings.teaching_weeks),
       connector_generation = VALUES(connector_generation),
       first_week_monday = VALUES(first_week_monday), updated_at = CURRENT_TIMESTAMP`,
    [
      firstWeekMonday,
      count,
      options ? JSON.stringify(options) : null,
      semesterId,
      userId,
      providedOptions ? 1 : 0,
      providedWeeks ? 1 : 0,
    ],
  );
  if (!result.affectedRows) {
    const existing = await readCourseCalendar(pool, userId, semesterId);
    if (
      existing.firstWeekMonday === firstWeekMonday &&
      (!providedWeeks || existing.teachingWeeks === count) &&
      (!providedOptions || JSON.stringify(existing.options) === JSON.stringify(options))
    )
      return existing;
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
  normalizeTeachingWeeks,
  validSemester,
};
