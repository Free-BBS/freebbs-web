const crypto = require('node:crypto');
const express = require('express');
const { COURSE_SECTIONS } = require('./course-sections');
const { listCourseSchedules: defaultListCourseSchedules } = require('./course-schedule');

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MAX_PLAN_DAYS = 30;
const MAX_HORIZON_DAYS = 371;
const MAX_SUGGESTIONS = 52;
const MAX_TASKS = 3;
// Inline this server-owned limit: mysql2 execute() binds JS numbers as DOUBLE.
const MAX_EVENTS = 500;
const MAX_PROMPT_LENGTH = 600;
const SHANGHAI_OFFSET_MS = 8 * 60 * MINUTE_MS;
const CHINESE_DIGITS = Object.freeze({
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
});
const WEEKDAYS = Object.freeze({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 });

function smallNumber(value) {
  if (/^\d+$/.test(String(value))) return Number(value);
  if (/^\d+(?:\.\d+)$/.test(String(value))) return Number(value);
  if (value === '十') return 10;
  if (String(value).startsWith('十')) return 10 + (CHINESE_DIGITS[String(value).slice(1)] || 0);
  if (String(value).endsWith('十')) return (CHINESE_DIGITS[String(value)[0]] || 0) * 10;
  if (/^[二三四五]十[一二三四五六七八九]$/.test(String(value)))
    return CHINESE_DIGITS[String(value)[0]] * 10 + CHINESE_DIGITS[String(value)[2]];
  return CHINESE_DIGITS[value] || null;
}

function dateKeyFromParts(year, month, day) {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseMentionedDate(message, now) {
  const todayKey = localDateKey(now);
  const [year, month] = todayKey.split('-').map(Number);
  const full = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]?/.exec(message);
  if (full) {
    const specifiedYear = full[1] ? Number(full[1]) : year;
    let key = dateKeyFromParts(specifiedYear, Number(full[2]), Number(full[3]));
    if (!full[1] && key && key < todayKey)
      key = dateKeyFromParts(specifiedYear + 1, Number(full[2]), Number(full[3]));
    return key;
  }
  const relative = /(今天|明天|后天)/.exec(message);
  if (relative)
    return localDateKey(
      new Date(shanghaiMidnight(todayKey) + { 今天: 0, 明天: 1, 后天: 2 }[relative[1]] * DAY_MS),
    );
  const numberedDay = /(?:^|\D)(\d{1,2})[日号]/.exec(message);
  if (numberedDay) {
    const target = Number(numberedDay[1]);
    let key = dateKeyFromParts(year, month, target);
    if (key && key < todayKey) {
      const next = new Date(Date.UTC(year, month, 1));
      key = dateKeyFromParts(next.getUTCFullYear(), next.getUTCMonth() + 1, target);
    }
    return key;
  }
  const weekly = /(?:每周|每星期|周常)([一二三四五六日天])/.exec(message);
  if (weekly) {
    const todayWeekday =
      ((new Date(shanghaiMidnight(todayKey) + SHANGHAI_OFFSET_MS).getUTCDay() + 6) % 7) + 1;
    const offset = (WEEKDAYS[weekly[1]] - todayWeekday + 7) % 7;
    return localDateKey(new Date(shanghaiMidnight(todayKey) + offset * DAY_MS));
  }
  return null;
}

function parseMentionedTime(message, inheritedPeriod) {
  const section = /第([一二三四五六1-6])大节/.exec(message);
  if (section) {
    const [start, end] = COURSE_SECTIONS[smallNumber(section[1])];
    return { startMinutes: parseClock(start), endMinutes: parseClock(end) };
  }
  const clock =
    /(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})(?::(\d{2})|点(?:(半)|(\d{1,2})分?)?)/.exec(
      message,
    );
  if (!clock) return null;
  let hour = Number(clock[2]);
  let minute = Number(clock[5] || 0);
  if (clock[4]) minute = 30;
  if (clock[3]) minute = Number(clock[3]);
  if (hour > 23 || minute > 59) return null;
  const period = clock[1] || inheritedPeriod;
  if (['下午', '傍晚', '晚上'].includes(period) && hour < 12) hour += 12;
  if (period === '凌晨' && hour === 12) hour = 0;
  return { startMinutes: hour * 60 + minute };
}

function cleanTitle(message) {
  return message
    .replace(/接下来[一二两三四五六七八九十\d]+天/g, '')
    .replace(/(?:(?:连续|持续|共)\s*[一二两三四五六七八九十\d]+\s*周)/g, '')
    .replace(/(?:每周|每星期|周常)[一二三四五六日天]/g, '')
    .replace(/(?:之后)?(?:每周|每星期|周常)(?:都有)?/g, '')
    .replace(/(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]?|\d{1,2}[日号]|今天|明天|后天/g, '')
    .replace(/第[一二三四五六1-6]大节/g, '')
    .replace(
      /(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*\d{1,2}(?::\d{2}|点(?:半|\d{1,2}分?)?)/g,
      '',
    )
    .replace(/(?:持续时间|持续|共计|约)\s*[一二两三四五六七八九十\d.]+\s*(?:小时|分钟)/g, '')
    .replace(/[一二两三四五六七八九十\d.]+\s*(?:小时|分钟)/g, '')
    .replace(/^(?:在|于|安排)\s*/, '')
    .replace(/^从?起?/, '')
    .replace(/(?:之前|以前|截止)/g, '')
    .replace(/^[，,。\s]+|[，,。\s]+$/g, '')
    .replace(/^(?:(?:请)?(?:帮我|替我)|我(?:们)?|想要|需要|要)+/, '')
    .replace(/^开(?=.+会$)/, '')
    .trim();
}

const TIME_MENTION = /第[一二三四五六1-6]大节|\d{1,2}(?::\d{2}|点(?:半|\d{1,2}分?)?)/g;
const PERIOD_MENTION = /(凌晨|早上|上午|中午|下午|傍晚|晚上)/;
const DATE_MENTION =
  /(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]?|\d{1,2}[日号]|今天|明天|后天|(?:每周|每星期|周常)[一二三四五六日天]/;
const DURATION_MENTION = /(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(小时|分钟)/;

function isLocationClause(value) {
  return /^(?:在|于)?[\p{L}\d -]*(?:楼|馆|教室|会议室|报告厅|实验室|操场|[一二三四五六]教)[\p{L}\d -]*$/u.test(
    value.trim(),
  );
}

function splitScheduleTasks(message) {
  let sharedDuration;
  let taskText = message;
  // A shared duration must be explicitly scoped to every task; a duration belonging
  // to the final meeting must never silently fill in earlier missing durations.
  const shared =
    /(?:^|[，,；;。\n])\s*(?:(?:这|以上)?[两二三四五六七八九十\d]+(?:个|项|场|件)?(?:会|会议|活动|任务|安排|事情|事)?\s*)?(?:都(?:是|为|持续)?|均(?:为|是|持续)?|各(?:自)?(?:持续)?|每(?:个|项|场)(?:持续)?)\s*(?:持续(?:时间)?|约)?\s*(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(小时|分钟)\s*[。！!]?\s*$/.exec(
      message,
    );
  if (shared) {
    sharedDuration = `${shared[1]}${shared[2]}`;
    taskText = message.slice(0, shared.index);
  }
  const parts = [];
  const chunks = taskText.split(
    /([，,；;。\n]|然后|另外|还有|以及|并且|同时|(?:再|和)(?=\s*(?:我|要|在|于|今天|明天|后天|\d|第|每周|每星期|周常|接下来|凌晨|早上|上午|中午|下午|傍晚|晚上)))/,
  );
  let current = '';
  let separator = '';
  let inNotes = false;
  for (let index = 0; index < chunks.length; index += 1) {
    if (index % 2) {
      separator = chunks[index];
      continue;
    }
    const chunk = chunks[index].trim();
    if (!chunk) continue;
    const isNote = /^(?:地点\/备注|地点|备注|说明)\s*[：:]/.test(chunk);
    const isDurationContinuation = /^(?:持续(?:时间)?|连续|共计|共|约|之后每周|每周都有)/.test(
      chunk,
    );
    const hasDurationTask =
      !isDurationContinuation && DURATION_MENTION.test(chunk) && Boolean(cleanTitle(chunk));
    const hasAnchor =
      !isNote &&
      ([...chunk.matchAll(TIME_MENTION)].length > 0 ||
        DATE_MENTION.test(chunk) ||
        /接下来\s*[一二两三四五六七八九十\d]+\s*天/.test(chunk) ||
        hasDurationTask);
    const currentHasAnchor =
      [...current.matchAll(TIME_MENTION)].length > 0 ||
      /接下来\s*[一二两三四五六七八九十\d]+\s*天/.test(current);
    const continuation =
      isNote ||
      isLocationClause(chunk) ||
      isDurationContinuation ||
      (DURATION_MENTION.test(chunk) &&
        /^(?:\d|[一二两三四五六七八九十])/.test(chunk) &&
        !hasAnchor);
    const independent =
      hasAnchor ||
      (!inNotes &&
        !continuation &&
        (/[；;。\n]/.test(separator) ||
          /^(?:还(?:要|有)|另外|再|以及|并且)/.test(chunk) ||
          separator.length > 1));
    if (current && currentHasAnchor && independent) {
      parts.push(current);
      current = chunk;
      inNotes = false;
    } else {
      current += (current ? separator : '') + chunk;
    }
    if (isNote) inNotes = true;
  }
  if (current) parts.push(current);
  return { parts, sharedDuration };
}

function parseSingleKnownScheduleMessage(message, now, context = {}) {
  let text = String(message || '').trim();
  const notes = /(?:^|[，,；;\n])\s*(?:地点\/备注|地点|备注|说明)\s*[：:]\s*([\s\S]+)$/.exec(text);
  if (notes) {
    const known = parseSingleKnownScheduleMessage(text.slice(0, notes.index), now, context);
    return known ? { ...known, description: notes[1].trim() } : null;
  }
  const descriptions = [];
  text = text.replace(/([，,；;\n])([^，,；;\n]+)/g, (whole, separator, clause) => {
    if (!isLocationClause(clause)) return whole;
    descriptions.push(clause.trim().replace(/^(?:在|于)/, ''));
    return '';
  });
  const description = descriptions.length ? { description: descriptions.join('；') } : {};
  // Unlabeled extra clauses may contain another task or instructions. Only keep
  // continuations whose meaning is unambiguous to this deterministic parser.
  const clauses = text.split(/[，,；;\n]/).filter((clause) => clause.trim());
  if (
    clauses
      .slice(1)
      .some(
        (clause) =>
          !/^(?:\s*(?:持续(?:时间)?|连续|共计|共|约|之后每周|每周都有)|\s*(?:\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(?:小时|分钟)\s*$)/.test(
            clause,
          ),
      )
  )
    return null;
  // Multiple clock mentions can be a range or unsplit tasks. Both require the
  // Agent to understand the whole sentence instead of selecting its first clock.
  if ([...text.matchAll(TIME_MENTION)].length > 1) return null;
  const plan =
    /接下来\s*([一二两三四五六七八九十\d]+)\s*天[\s\S]*?([一二两三四五六七八九十\d]+(?:\.\d+)?)\s*(小时|分钟)/.exec(
      text,
    );
  if (plan) {
    // Let the Agent extract availability constraints instead of silently using 09:00–21:00.
    if (
      /(?:凌晨|早上|上午|中午|下午|傍晚|晚上|夜间|白天|周末|工作日|每天|每日|每晚|只|避开|不要|不能|不超过|点|[:：])/.test(
        text,
      )
    )
      return null;
    const days = smallNumber(plan[1]);
    const amount = smallNumber(plan[2]);
    const title = cleanTitle(text);
    if (days && amount && title)
      return {
        kind: 'plan',
        title,
        days,
        totalMinutes: amount * (plan[3] === '小时' ? 60 : 1),
        ...description,
      };
  }
  const dateKey = DATE_MENTION.test(text) ? parseMentionedDate(text, now) : context.dateKey;
  const clock = parseMentionedTime(text, context.period);
  if (!dateKey || !clock) return null;
  const title = cleanTitle(text);
  if (!title) return null;
  let start = shanghaiMidnight(dateKey) + clock.startMinutes * MINUTE_MS;
  const deadline = /(?:之前|以前|截止|ddl|DDL)/.test(text);
  if (deadline) {
    return {
      kind: 'deadline',
      title,
      description: descriptions.join('；') || '截止时间',
      startAt: new Date(start - MINUTE_MS).toISOString(),
      endAt: new Date(start).toISOString(),
    };
  }
  const duration =
    /(?:持续(?:时间)?|共计|约)?\s*(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(小时|分钟)/.exec(
      text + (context.sharedDuration ? `，${context.sharedDuration}` : ''),
    );
  const minutes = duration ? smallNumber(duration[1]) * (duration[2] === '小时' ? 60 : 1) : null;
  const endMinutes = clock.endMinutes ?? (minutes ? clock.startMinutes + minutes : null);
  if (!endMinutes) return null;
  const weekly = /(?:每周|每星期|周常)/.test(text);
  if (weekly) {
    const count = /(?:持续|连续|共)\s*([一二两三四五六七八九十\d]+)\s*周/.exec(text);
    if (!count) return null;
    if (start <= now.getTime()) start += 7 * DAY_MS;
    return {
      kind: 'weekly',
      title,
      startAt: new Date(start).toISOString(),
      endAt: new Date(start + (endMinutes - clock.startMinutes) * MINUTE_MS).toISOString(),
      weeks: smallNumber(count[1]),
      ...description,
    };
  }
  return {
    kind: 'event',
    title,
    startAt: new Date(start).toISOString(),
    endAt: new Date(shanghaiMidnight(dateKey) + endMinutes * MINUTE_MS).toISOString(),
    ...description,
  };
}

function parseKnownScheduleMessage(message, now = new Date()) {
  const text = String(message || '').trim();
  const { parts, sharedDuration } = splitScheduleTasks(text);
  if (parts.length > MAX_TASKS) {
    throw Object.assign(new Error('一句话最多安排 3 件独立任务，请拆成多次添加。'), {
      status: 422,
    });
  }
  // Preserve arbitrary punctuation in explicitly labeled notes for a single task.
  if (parts.length <= 1) return parseSingleKnownScheduleMessage(text, now);
  const context = { sharedDuration };
  const tasks = [];
  for (const part of parts) {
    const ownDate = parseMentionedDate(part, now);
    const ownPeriod = PERIOD_MENTION.exec(part)?.[1];
    if (ownDate && ownDate !== context.dateKey) context.period = undefined;
    if (ownDate) context.dateKey = ownDate;
    if (ownPeriod) context.period = ownPeriod;
    const task = parseSingleKnownScheduleMessage(part, now, context);
    if (!task) return null;
    tasks.push(task);
  }
  return { kind: 'batch', tasks };
}

function localDateKey(value) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shanghaiMidnight(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS;
}

function parseClock(value, fallback) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || fallback));
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

function overlaps(left, right) {
  return (
    new Date(left.startAt).getTime() < new Date(right.endAt).getTime() &&
    new Date(left.endAt).getTime() > new Date(right.startAt).getTime()
  );
}

function parseAgentAnswer(payload) {
  const answer = payload?.answer || payload?.content || payload?.message || '';
  if (typeof answer === 'object' && answer !== null) return answer;
  const clean = String(answer)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(clean);
  } catch {
    throw Object.assign(new Error('AI 没有给出可用的时间信息，请补充日期、时长后重试。'), {
      status: 422,
    });
  }
}

function validateSuggestion(value, now = new Date()) {
  const title = typeof value?.title === 'string' ? value.title.trim() : '';
  const description = typeof value?.description === 'string' ? value.description.trim() : '';
  const start = new Date(value?.startAt);
  const end = new Date(value?.endAt);
  const lower = now.getTime() - MINUTE_MS;
  const upper = shanghaiMidnight(localDateKey(now)) + MAX_HORIZON_DAYS * DAY_MS;
  const kind = ['event', 'weekly', 'deadline'].includes(value?.kind) ? value.kind : 'event';
  if (
    !title ||
    title.length > 200 ||
    (value?.description != null && typeof value.description !== 'string') ||
    description.length > 4000 ||
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start.getTime() < lower ||
    end.getTime() <= start.getTime() ||
    end.getTime() - start.getTime() > 12 * 60 * MINUTE_MS ||
    (kind === 'deadline' && end.getTime() - start.getTime() !== MINUTE_MS) ||
    end.getTime() > upper
  ) {
    throw Object.assign(new Error('计划时间或标题无效，请检查后再确认。'), { status: 400 });
  }
  return {
    title,
    description,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    kind,
  };
}

function buildPlan(extraction, existing, now = new Date()) {
  const title = typeof extraction?.title === 'string' ? extraction.title.trim() : '';
  const description =
    typeof extraction?.description === 'string'
      ? extraction.description.trim()
      : '由工作台 Max 根据现有日程空档建议。';
  const days = Number(extraction?.days);
  const totalMinutes = Number(extraction?.totalMinutes);
  const dayStart = parseClock(extraction?.dayStart, '09:00');
  const dayEnd = parseClock(extraction?.dayEnd, '21:00');
  if (
    !title ||
    title.length > 200 ||
    (extraction?.description != null && typeof extraction.description !== 'string') ||
    description.length > 4000 ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > MAX_PLAN_DAYS ||
    !Number.isInteger(totalMinutes) ||
    totalMinutes < 15 ||
    totalMinutes > 2400 ||
    totalMinutes % 15 !== 0 ||
    dayStart === null ||
    dayEnd === null ||
    dayStart >= dayEnd ||
    dayEnd - dayStart < 30
  ) {
    throw Object.assign(new Error('请说明要做的事、接下来几天及总共多少小时。'), { status: 422 });
  }

  const suggestions = [];
  const occupied = existing.map((item) => ({
    startAt: new Date(item.startAt || item.start_at).toISOString(),
    endAt: new Date(item.endAt || item.end_at).toISOString(),
  }));
  let remaining = totalMinutes;
  const today = shanghaiMidnight(localDateKey(now));
  for (let day = 0; day < days && remaining > 0; day += 1) {
    const midnight = today + day * DAY_MS;
    const windowStart = Math.max(
      midnight + dayStart * MINUTE_MS,
      Math.ceil(now.getTime() / (15 * MINUTE_MS)) * 15 * MINUTE_MS,
    );
    const windowEnd = midnight + dayEnd * MINUTE_MS;
    const dailyTarget = Math.min(360, Math.ceil(remaining / (days - day) / 15) * 15);
    let plannedToday = 0;
    let cursor = windowStart;
    while (remaining > 0 && plannedToday < dailyTarget && cursor + 15 * MINUTE_MS <= windowEnd) {
      let next;
      for (const item of occupied) {
        const itemStart = new Date(item.startAt).getTime();
        const itemEnd = new Date(item.endAt).getTime();
        if (
          itemEnd > cursor &&
          itemStart < windowEnd &&
          (!next || itemStart < new Date(next.startAt).getTime())
        )
          next = item;
      }
      const freeEnd = Math.min(windowEnd, next ? new Date(next.startAt).getTime() : windowEnd);
      if (freeEnd <= cursor) {
        cursor = next
          ? Math.max(cursor + 15 * MINUTE_MS, new Date(next.endAt).getTime())
          : windowEnd;
        continue;
      }
      const available = Math.floor((freeEnd - cursor) / (15 * MINUTE_MS)) * 15;
      const minutes = Math.min(120, remaining, dailyTarget - plannedToday, available);
      if (minutes < 15) {
        cursor = freeEnd + 15 * MINUTE_MS;
        continue;
      }
      const item = {
        title,
        description,
        startAt: new Date(cursor).toISOString(),
        endAt: new Date(cursor + minutes * MINUTE_MS).toISOString(),
      };
      suggestions.push(item);
      occupied.push(item);
      remaining -= minutes;
      plannedToday += minutes;
      cursor += (minutes + 15) * MINUTE_MS;
    }
  }
  if (remaining > 0) {
    throw Object.assign(new Error(`现有空档不足，还差 ${remaining} 分钟。请放宽天数或可用时段。`), {
      status: 422,
    });
  }
  return suggestions;
}

function buildPreview(extraction, existing, now = new Date()) {
  const kind = extraction?.kind;
  let suggestions;
  if (kind === 'batch') {
    const { tasks } = extraction;
    if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > MAX_TASKS) {
      throw Object.assign(
        new Error('一句话最多安排 3 件独立任务，请提供 1–3 件任务或拆成多次添加。'),
        { status: 422 },
      );
    }
    if (tasks.some((task) => !['event', 'weekly', 'deadline', 'plan'].includes(task?.kind))) {
      throw Object.assign(new Error('每件任务都需完整说明日期、时间或时长，不能嵌套批量任务。'), {
        status: 422,
      });
    }
    const expanded = new Array(tasks.length);
    const occupied = [...existing];
    // Reserve every fixed event first, including those occurring after a plan in
    // the sentence. Then each plan also avoids all earlier plans in this batch.
    for (let index = 0; index < tasks.length; index += 1) {
      if (tasks[index].kind === 'plan') continue;
      expanded[index] = buildPreview(tasks[index], occupied, now).suggestions;
      occupied.push(...expanded[index].filter((item) => item.kind !== 'deadline'));
    }
    for (let index = 0; index < tasks.length; index += 1) {
      if (tasks[index].kind !== 'plan') continue;
      expanded[index] = buildPreview(tasks[index], occupied, now).suggestions;
      occupied.push(...expanded[index]);
    }
    suggestions = expanded.flat();
  } else if (kind === 'event' || kind === 'deadline') {
    suggestions = [validateSuggestion(extraction, now)];
  } else if (kind === 'weekly') {
    const weeks = Number(extraction?.weeks);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_SUGGESTIONS) {
      throw Object.assign(new Error('周常请指定持续 1–52 周。'), { status: 422 });
    }
    const first = validateSuggestion(extraction, now);
    suggestions = Array.from({ length: weeks }, (_, index) => {
      const offset = index * 7 * DAY_MS;
      const item = validateSuggestion(
        {
          ...first,
          description: first.description || `周常 · 第 ${index + 1}/${weeks} 周`,
          startAt: new Date(new Date(first.startAt).getTime() + offset).toISOString(),
          endAt: new Date(new Date(first.endAt).getTime() + offset).toISOString(),
        },
        now,
      );
      return { ...item, occurrence: index + 1, totalWeeks: weeks };
    });
  } else if (kind === 'plan') {
    suggestions = buildPlan(extraction, existing, now);
  } else {
    throw Object.assign(new Error('请说清楚是添加一件具体日程，还是在接下来几天安排任务。'), {
      status: 422,
    });
  }
  if (suggestions.length > MAX_SUGGESTIONS) {
    throw Object.assign(new Error('这些任务展开后超过 52 段安排，请缩短周期或分次添加。'), {
      status: 422,
    });
  }
  if (
    suggestions.some(
      (item) =>
        item.kind !== 'deadline' &&
        existing.some((busy) =>
          overlaps(item, {
            startAt: busy.startAt || busy.start_at,
            endAt: busy.endAt || busy.end_at,
          }),
        ),
    )
  ) {
    throw Object.assign(new Error('建议时间与已有安排冲突，请调整描述后重试。'), { status: 409 });
  }
  if (
    suggestions.some(
      (item, index) =>
        item.kind !== 'deadline' &&
        suggestions
          .slice(index + 1)
          .some((other) => other.kind !== 'deadline' && overlaps(item, other)),
    )
  ) {
    throw Object.assign(new Error('待安排任务之间有时间冲突，请调整后重试。'), { status: 409 });
  }
  return { kind, ...(kind === 'batch' ? { taskCount: extraction.tasks.length } : {}), suggestions };
}

function buildPrompt(message, now) {
  return [
    '你是 FREE BBS 个人计划表的时间信息提取器。只输出一个 JSON 对象，不要 Markdown 或解释。',
    '当前时区固定为 Asia/Shanghai。现有日程由服务器避让，你只需提取用户的时间意图。',
    `当前时间：${now.toISOString()}；北京时间日期：${localDateKey(now)}。`,
    '若用户描述一件时间确定的事，输出 {"kind":"event","title":"...","description":"...","startAt":"ISO 8601含+08:00","endAt":"ISO 8601含+08:00"}。',
    '固定知识：课程第一大节 08:00–09:35；第二大节 09:50–12:15；第三大节 13:30–15:05；第四大节 15:20–16:55；第五大节 17:10–18:45；第六大节 19:20–21:45。用户说“第N大节”时严格使用对应时间。',
    '若是每周重复、持续 X 周，输出 {"kind":"weekly","title":"...","startAt":"首次发生的ISO时间","endAt":"首次结束的ISO时间","weeks":X}。服务器展开每周一次，不能漏掉重复次数。',
    '若是“某日某时之前完成/截止”之类的 DDL，输出 {"kind":"deadline","title":"要完成的事","startAt":"截止时间提前1分钟的ISO时间","endAt":"截止时间的ISO时间"}。DDL 是时间点，不是要占满此前时段。',
    '若用户希望在接下来 N 天内完成 X 小时某事，输出 {"kind":"plan","title":"...","days":N,"totalMinutes":X乘60,"dayStart":"09:00","dayEnd":"21:00"}。若用户限定上午/下午/晚上，调整 dayStart/dayEnd。',
    '若用户描述 2–3 件独立任务，必须全部提取并输出 {"kind":"batch","tasks":[上述 event/weekly/deadline/plan 对象]}。tasks 只允许 1–3 项，禁止嵌套 batch；重复周次、空档计划的分段不算独立任务。超过 3 件输出 clarify，说明“一句话最多安排 3 件独立任务，请拆成多次添加”。',
    '同一句话省略的日期、上午/下午/晚上等时段继承前一件任务，明确给出的新日期或时段优先；跨日明确给出日期后，不擅自沿用上一日的晚上。仅在用户明确说“都/均/各”时共享时长；任何一件任务缺少必要信息，整句输出 clarify，绝不能只返回第一件或遗漏其他任务。',
    '示例：北京时间今天是 2026-09-24，用户说“我今天晚上9点要开书记会，罗姆楼5103；10点要开支书例会，罗姆楼10-206，两个会都是1小时”，应返回 batch，两项分别为书记会 2026-09-24T21:00:00+08:00 至 22:00:00+08:00、description 为罗姆楼5103，以及支书例会 2026-09-24T22:00:00+08:00 至 23:00:00+08:00、description 为罗姆楼10-206。示例日期仅用于解释，实际必须根据当前日期解析。',
    '不要自己排列空档，服务器会避开已有日程。缺少日期、时长等必要信息时输出 {"kind":"clarify","question":"需要补充什么"}。不要编造。',
    '所有安排类型都可包含 description 字符串，作为一个可选的“地点/备注”字段：保留用户给出的地点及备注，没有则留空；不要另设 location 字段或编造地点。',
    `用户的话：${message}`,
  ].join('\n');
}

function sendError(response, error, fallback) {
  if (!error?.status || error.status >= 500) console.error(fallback, error?.code || error?.name);
  response.status(error?.status || 500).json({ message: error?.status ? error.message : fallback });
}

function createSchedulePlannerRouter({
  pool,
  requireAuth,
  postAgentChat,
  buildAgentChatPayload,
  listCourseSchedules = defaultListCourseSchedules,
}) {
  const router = express.Router();

  router.post('/preview', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return;
    const message = typeof request.body?.message === 'string' ? request.body.message.trim() : '';
    if (!message || message.length > MAX_PROMPT_LENGTH) {
      response.status(400).json({ message: '请用 600 字以内描述要添加的日程或要安排的任务。' });
      return;
    }
    try {
      const now = new Date();
      const end = new Date(shanghaiMidnight(localDateKey(now)) + MAX_HORIZON_DAYS * DAY_MS);
      const [rows] = await pool.execute(
        `SELECT start_at, end_at FROM schedule_items
         WHERE user_id = ? AND deleted_at IS NULL AND status IN ('draft', 'confirmed')
           AND (source_reference IS NULL OR source_reference <> 'planner:deadline')
           AND start_at < ? AND end_at > ? ORDER BY start_at LIMIT ${MAX_EVENTS + 1}`,
        [user.id, end, now],
      );
      const courses = await listCourseSchedules(pool, user.id, { start: now, end });
      const existing = [...rows, ...courses];
      if (existing.length > MAX_EVENTS) {
        response.status(422).json({ message: '现有日程过多，暂时无法安全规划。' });
        return;
      }
      const known = parseKnownScheduleMessage(message, now);
      if (known) {
        response.json(buildPreview(known, existing, now));
        return;
      }
      const payload = buildAgentChatPayload(user, {
        agent: 'general_chat',
        execute_subagent: 'none',
        combine_general_chat: false,
        source: 'workbench_schedule',
        channel: 'workbench_schedule',
        stream: false,
        message: buildPrompt(message, now),
        temperature: 0,
      });
      const agentResponse = await postAgentChat(payload, user, {
        signal: AbortSignal.timeout(25000),
      });
      const answer = await agentResponse.json().catch(() => ({}));
      if (!agentResponse.ok) {
        response.status(502).json({ message: 'AI 暂时不可用，请稍后重试或手动添加日程。' });
        return;
      }
      const extraction = parseAgentAnswer(answer);
      if (extraction?.kind === 'clarify') {
        response
          .status(422)
          .json({ message: String(extraction.question || '请补充具体日期或时长。').slice(0, 200) });
        return;
      }
      const identifiedTasks = splitScheduleTasks(message).parts.length;
      if (
        identifiedTasks > 1 &&
        (extraction?.kind !== 'batch' || extraction.tasks?.length !== identifiedTasks)
      ) {
        response
          .status(422)
          .json({ message: '尚未完整识别所有任务，请逐项补充日期、时间和时长后重试。' });
        return;
      }
      response.json(buildPreview(extraction, existing, now));
    } catch (error) {
      sendError(response, error, '生成计划失败，请稍后重试。');
    }
  });

  router.post('/confirm', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return;
    const values = request.body?.suggestions;
    if (!Array.isArray(values) || values.length < 1 || values.length > MAX_SUGGESTIONS) {
      response.status(400).json({ message: '请选择 1–52 项计划再确认。' });
      return;
    }
    let connection;
    try {
      const suggestions = values.map((item) => validateSuggestion(item));
      if (
        suggestions.some((item, index) =>
          suggestions
            .slice(index + 1)
            .some(
              (other) =>
                item.kind !== 'deadline' && other.kind !== 'deadline' && overlaps(item, other),
            ),
        )
      ) {
        response.status(409).json({ message: '待确认计划之间有时间冲突。' });
        return;
      }
      connection = await pool.getConnection();
      await connection.beginTransaction();
      await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
      const start = new Date(
        Math.min(...suggestions.map((item) => new Date(item.startAt).getTime())),
      );
      const end = new Date(Math.max(...suggestions.map((item) => new Date(item.endAt).getTime())));
      const [scheduleBusy] = await connection.execute(
        `SELECT start_at, end_at FROM schedule_items
         WHERE user_id = ? AND deleted_at IS NULL AND status IN ('draft', 'confirmed')
           AND (source_reference IS NULL OR source_reference <> 'planner:deadline')
           AND start_at < ? AND end_at > ? LIMIT ${MAX_EVENTS + 1}`,
        [user.id, end, start],
      );
      const courseBusy = await listCourseSchedules(connection, user.id, { start, end });
      const busy = [...scheduleBusy, ...courseBusy];
      if (
        busy.length > MAX_EVENTS ||
        suggestions.some(
          (item) =>
            item.kind !== 'deadline' &&
            busy.some((occupied) =>
              overlaps(item, {
                startAt: occupied.startAt || occupied.start_at,
                endAt: occupied.endAt || occupied.end_at,
              }),
            ),
        )
      ) {
        await connection.rollback();
        response.status(409).json({ message: '日程已变化或出现冲突，请重新生成计划。' });
        return;
      }
      for (const item of suggestions) {
        await connection.execute(
          `INSERT INTO schedule_items (
            public_id, user_id, created_by_user_id, source_type, source_reference, title, description,
            start_at, end_at, all_day, timezone, status, user_confirmed_at
          ) VALUES (?, ?, ?, 'agent', ?, ?, NULLIF(?, ''), ?, ?, 0, 'Asia/Shanghai', 'confirmed', CURRENT_TIMESTAMP)`,
          [
            `ws_${crypto.randomBytes(12).toString('hex')}`,
            user.id,
            user.id,
            item.kind === 'deadline' || item.kind === 'weekly' ? `planner:${item.kind}` : null,
            item.title,
            item.description,
            new Date(item.startAt),
            new Date(item.endAt),
          ],
        );
      }
      await connection.commit();
      response.status(201).json({ created: suggestions.length });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      sendError(response, error, '保存计划失败，请稍后重试。');
    } finally {
      connection?.release();
    }
  });

  return router;
}

module.exports = {
  buildPlan,
  buildPreview,
  createSchedulePlannerRouter,
  localDateKey,
  overlaps,
  parseAgentAnswer,
  parseKnownScheduleMessage,
  COURSE_SECTIONS,
  validateSuggestion,
};
