const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseCourseSchedule,
  projectCourseSchedules,
  listCourseSchedules,
  readCourseCalendar,
  saveCourseCalendar,
  normalizeMonday,
} = require('./course-schedule');

const course = {
  sourceReference: 'learn:course:one',
  title: '模拟电路',
  teacher: '老师',
  scheduleText: '1-16周 周一第2大节',
  locationText: '六教 101',
};
const config = { semesterId: '2026-2027-1', firstWeekMonday: '2026-09-21' };
const range = { start: new Date('2026-09-20T16:00:00Z'), end: new Date('2026-09-27T16:00:00Z') };
const parse = (scheduleText) => parseCourseSchedule({ ...course, scheduleText });
function snapshot(overrides = {}) {
  return {
    semester_id: config.semesterId,
    courses_json: [course],
    first_week_monday: config.firstWeekMonday,
    settings_generation: 3,
    snapshot_generation: 3,
    connector_generation: 3,
    fetched_at: '2026-09-21T02:00:00Z',
    connected_at: '2026-09-20T02:00:00Z',
    sync_status: 'complete',
    ...overrides,
  };
}

test('parses explicit teaching weeks, split weeks, parity and the six large course blocks', () => {
  assert.deepEqual(parse('第1-8、10-16周(单周) 星期一第2大节').sessions[0], {
    weekday: 1,
    weeks: [1, 3, 5, 7, 11, 13, 15],
    start: '09:50',
    end: '12:15',
  });
  assert.deepEqual(parse('第1-2周 星期天 第五-六大节').sessions[0], {
    weekday: 7,
    weeks: [1, 2],
    start: '17:10',
    end: '21:45',
  });
  const distinct = parse('1-8周 周一08:00-09:35，9-16周 周一13:30-15:05');
  assert.equal(distinct.issue, null);
  assert.deepEqual(
    distinct.sessions.map((session) => [session.weeks[0], session.weeks.at(-1)]),
    [
      [1, 8],
      [9, 16],
    ],
  );
  assert.equal(distinct.sessions[1].weeks.includes(35), false);
  const trailing = parse('周一第1大节1-8周，周三第2大节9-16周');
  assert.equal(trailing.issue, null);
  assert.deepEqual(
    trailing.sessions.map((session) => [session.weeks[0], session.weeks.at(-1)]),
    [
      [1, 8],
      [9, 16],
    ],
  );
});

test('shared weeks retain each session parity and allow multiple complete explicit time windows', () => {
  const parsed = parse('1-4周 周一第1大节(单)，周三第2大节(双)');
  assert.equal(parsed.issue, null);
  assert.deepEqual(
    parsed.sessions.map((session) => session.weeks),
    [
      [1, 3],
      [2, 4],
    ],
  );
  assert.deepEqual(parse('1-4周 周一第1大节 单周').sessions[0].weeks, [1, 3]);
  assert.equal(parse('1-2周 周二 08:00-09:35、13:30-15:05').sessions.length, 2);
  assert.equal(parse('1-2周 周二第1大节、第3大节').sessions.length, 2);
});

test('uncertain, incomplete and malformed timetables never produce partially guessed sessions', () => {
  for (const value of [
    '',
    '星期一第2大节',
    '1-16周 星期一第2节',
    '1-16周 星期一第2小节',
    '1-16周 周一08:00-09:35、第3大节',
    '1-16周 周一08:00-09:35、14:00-25:00',
    '1-16周 周一第1大节、第7大节',
    '1-16周 周一第13大节',
    '101周 周一第1大节',
    '六教101 周三第1大节',
    '罗姆楼5103 周四第三大节',
    '1-16周 周一、三第1大节',
    '1-16周 周一第1大节 或第3大节',
    '1-8周 周一第1大节，周三第2大节9-16周',
    '0-16周 周一第1大节',
    '1-54周 周一第1大节',
    '9-2周 周一第1大节',
    '1-16周 周一09:35-08:00',
    '1-16周 周一第1大节，10月1日停课',
    '1-16周 周一第1大节 除第3周',
    '1-16周(单双周) 周一第1大节',
  ]) {
    const result = parse(value);
    assert.ok(result.issue, value);
    assert.deepEqual(result.sessions, [], value);
  }
});

test('projection uses the chosen Shanghai teaching Monday, exact boundaries and fixed confirmed course identity', () => {
  const result = projectCourseSchedules([course, course], { ...config, range });
  assert.equal(result.events.length, 1);
  const [event] = result.events;
  assert.equal(event.startAt, '2026-09-21T01:50:00.000Z');
  assert.equal(event.endAt, '2026-09-21T04:15:00.000Z');
  assert.equal(event.kind, 'course');
  assert.equal(event.status, 'confirmed');
  assert.equal(event.sourceType, 'network_classroom');
  assert.equal(event.courseReference, course.sourceReference);
  assert.equal(event.semesterId, config.semesterId);
  assert.ok(event.courseScheduleReference);
  assert.equal(
    projectCourseSchedules([course], {
      ...config,
      range: {
        start: new Date(event.endAt),
        end: range.end,
      },
    }).events.length,
    0,
  );
  assert.equal(
    projectCourseSchedules([course], {
      ...config,
      range: {
        start: range.start,
        end: new Date(event.startAt),
      },
    }).events.length,
    0,
  );
});

test('projection is idempotent, reflects upstream changes and retains every occurrence across 371 days', () => {
  const first = projectCourseSchedules([course], config).events;
  assert.equal(first.length, 16);
  assert.deepEqual(projectCourseSchedules([course], config).events, first);
  const changedRoom = projectCourseSchedules(
    [{ ...course, locationText: '六教 201' }],
    config,
  ).events;
  assert.equal(changedRoom[0].publicId, first[0].publicId);
  assert.match(changedRoom[0].description, /六教 201/);
  const changedTime = projectCourseSchedules(
    [{ ...course, scheduleText: '1-16周 周三第4大节' }],
    config,
  ).events;
  assert.equal(changedTime.length, 16);
  assert.notEqual(changedTime[0].startAt, first[0].startAt);
  const long = projectCourseSchedules(
    [{ ...course, scheduleText: '1-53周 星期一第1大节；1-53周 星期五第6大节' }],
    {
      ...config,
      range: { start: range.start, end: new Date(range.start.getTime() + 371 * 86400000) },
    },
  );
  assert.equal(long.events.length, 106);
});

test('missing calendar and unrecognized records produce actionable course-specific issues', () => {
  const result = projectCourseSchedules([course], { semesterId: config.semesterId });
  assert.equal(result.events.length, 0);
  assert.match(result.issues[0].message, /第一教学周/);
  assert.equal(result.issues[0].courseReference, course.sourceReference);
  assert.equal(result.parsedCourses, 1);
  assert.equal(result.totalCourses, 1);
  const retained = projectCourseSchedules(
    [{ ...course, calendarSyncWarning: '保留此前可靠安排' }],
    config,
  );
  assert.equal(retained.events.length, 16);
  assert.match(retained.issues[0].message, /保留/);
});

test('course queries scope user, generation and connect time; legacy or rebound snapshots never enter the calendar', async () => {
  const pool = {
    async execute(sql, parameters) {
      assert.match(sql, /s.user_id = \?/);
      assert.match(sql, /c.generation = s.connector_generation/);
      assert.match(sql, /s.fetched_at >= c.connected_at/);
      assert.deepEqual(parameters, [7]);
      return [
        [
          snapshot(),
          snapshot({ snapshot_generation: 0 }),
          snapshot({ snapshot_generation: 2 }),
          snapshot({ fetched_at: '2026-09-19T02:00:00Z' }),
          snapshot({ connected_at: null }),
          snapshot({ semester_id: 'old', settings_generation: 2 }),
          snapshot(),
        ],
      ];
    },
  };
  const events = await listCourseSchedules(pool, 7, range);
  assert.equal(events.length, 1);
  assert.equal(events[0].semesterId, config.semesterId);
  assert.deepEqual(await listCourseSchedules(null, 7, range, 'draft'), []);
  assert.deepEqual(await listCourseSchedules(null, 7, range, 'completed'), []);
});

test('calendar settings validate a real Monday before writing, and save only against an owned current snapshot', async () => {
  for (const value of ['2026-09-22', '2026-02-30', '2026-9-21', '', null, '1900-01-01']) {
    assert.equal(normalizeMonday(value), null);
    await assert.rejects(saveCourseCalendar(null, 7, { ...config, firstWeekMonday: value }), {
      status: 400,
    });
  }
  let writes = 0;
  const pool = {
    async execute(sql, parameters) {
      if (sql.includes('INSERT INTO campus_course_calendar_settings')) {
        writes += 1;
        assert.match(sql, /c.user_id = \?/);
        assert.match(sql, /s.connector_generation = c.generation/);
        assert.deepEqual(parameters, [config.firstWeekMonday, config.semesterId, 7]);
        return [{ affectedRows: 1 }];
      }
      assert.deepEqual(parameters, [7, config.semesterId]);
      return [[snapshot()]];
    },
  };
  const result = await saveCourseCalendar(pool, 7, config);
  assert.equal(result.firstWeekMonday, config.firstWeekMonday);
  assert.equal(result.scheduledLessons, 16);
  assert.equal(writes, 1);
  const unavailable = {
    async execute(sql) {
      return sql.includes('INSERT') ? [{ affectedRows: 0 }] : [[]];
    },
  };
  await assert.rejects(saveCourseCalendar(unavailable, 7, config), { status: 409 });
  assert.equal((await readCourseCalendar(unavailable, 7, config.semesterId)).totalCourses, 0);
});
