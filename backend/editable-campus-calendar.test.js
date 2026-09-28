const test = require('node:test');
const assert = require('node:assert/strict');
const { projectCourseSchedules, listCourseSchedules } = require('./course-schedule');
const {
  CALENDAR_PRESETS,
  normalizeCalendarOptions,
  holidayForDate,
} = require('./course-calendar-options');
const { applyOverride, makePatch, editImportedSchedule } = require('./campus-schedule-overrides');
const academic = require('../public/academic-calendar');

const config = { semesterId: '2026-2027-1', firstWeekMonday: '2026-09-14', teachingWeeks: 16 };
const course = {
  sourceReference: 'course:information',
  title: '应用信息论基础',
  sectionSystem: 'tsinghua-large',
  scheduleText: '星期三第3节(全周)，A204;星期三第4节(全周)，A204',
};

test('adjacent large blocks merge only for the same course, date and room', () => {
  const result = projectCourseSchedules([course], config);
  assert.equal(result.events.length, 16);
  assert.equal(result.events[0].startAt, '2026-09-16T05:30:00.000Z');
  assert.equal(result.events[0].endAt, '2026-09-16T08:55:00.000Z');
  assert.equal(result.events[0].description, 'A204');
  assert.equal(result.events[0].title, course.title);
  assert.equal(
    projectCourseSchedules(
      [{ ...course, scheduleText: `${course.scheduleText};星期三第3节(全周)，A204` }],
      config,
    ).events.length,
    16,
  );
  assert.equal(
    projectCourseSchedules(
      [{ ...course, scheduleText: course.scheduleText.replace(/A204$/, 'B101') }],
      config,
    ).events.length,
    32,
  );
  assert.equal(
    projectCourseSchedules(
      [{ ...course, scheduleText: course.scheduleText.replace('第4节', '第6节') }],
      config,
    ).events.length,
    32,
  );
  const partial = {
    ...course,
    scheduleText: course.scheduleText.replace('第4节(全周)', '第4节(后八周)'),
  };
  const events = projectCourseSchedules([partial], config).events;
  assert.equal(events.length, 16);
  assert.equal(events.filter((item) => item.sectionEnd === 4).length, 8);
  assert.equal(
    projectCourseSchedules([course, { ...course, sourceReference: 'other' }], config).events.length,
    32,
  );
});

test('2/5/6 section durations are per course and do not change occurrence identity', () => {
  const sample = {
    ...course,
    scheduleText: '星期一第2节(全周);星期二第5节(全周);星期三第6节(全周)',
  };
  const long = projectCourseSchedules([sample], config).events.slice(0, 3);
  const short = projectCourseSchedules([sample], {
    ...config,
    options: {
      courseSections: { [sample.sourceReference]: { 2: 2, 5: 1, 6: 2 } },
    },
  }).events.slice(0, 3);
  assert.deepEqual(
    short.map((item) => item.publicId),
    long.map((item) => item.publicId),
  );
  assert.deepEqual(
    short.map((item) => [item.startAt.slice(11, 16), item.endAt.slice(11, 16)]),
    [
      ['01:50', '03:25'],
      ['09:05', '09:50'],
      ['11:20', '12:55'],
    ],
  );
  assert.deepEqual(
    long.map((item) => item.endAt.slice(11, 16)),
    ['04:15', '10:40', '13:45'],
  );
  assert.throws(() => normalizeCalendarOptions({ courseSections: { one: { 5: 3 } } }), {
    status: 400,
  });
});

test('academic calendars skip only stated holidays, preserve week numbering and accept explicit exceptions', () => {
  for (const preset of CALENDAR_PRESETS) {
    const options = normalizeCalendarOptions({ holidayPreset: preset.id }, preset.firstWeekMonday);
    for (const holiday of preset.holidays) {
      assert.equal(holidayForDate(holiday.start, options), holiday.name);
      assert.equal(holidayForDate(holiday.end, options), holiday.name);
      assert.equal(
        holidayForDate(holiday.start, { ...options, includeDates: [holiday.start] }),
        null,
      );
    }
  }
  const options = { holidayPreset: 'tsinghua-2026-autumn' };
  const events = projectCourseSchedules([course], { ...config, options });
  assert.equal(events.skippedLessons, 1);
  assert.equal(events.events.length, 15);
  assert.equal(
    events.events.some((item) => item.startAt.startsWith('2026-10-07')),
    false,
  );
  assert.equal(
    events.events.some((item) => item.startAt.startsWith('2026-10-14')),
    true,
  );
  assert.equal(holidayForDate('2026-10-10', options), null);
  assert.equal(holidayForDate('2027-04-24', { holidayPreset: 'tsinghua-2027-spring' }), null);
  assert.equal(holidayForDate('2027-06-28', { holidayPreset: 'tsinghua-2027-spring' }), null);
  assert.throws(() => normalizeCalendarOptions(options, '2027-02-22'), { status: 400 });
  for (const invalid of ['2026-02-30', '2026-9-25', true]) {
    assert.throws(() => normalizeCalendarOptions({ skipDates: [invalid] }), { status: 400 });
  }
  assert.throws(
    () => normalizeCalendarOptions({ skipDates: ['2026-09-25'], includeDates: ['2026-09-25'] }),
    { status: 400 },
  );
});

test('header shows only the current Beijing day and correct calendar week, including midnight and semester end', () => {
  academic.reset();
  assert.equal(academic.format(new Date('2026-09-28T16:00:00Z')), '9月29日 校历第3周周二');
  assert.equal(academic.format(new Date('2026-09-29T16:00:00Z')), '9月30日 校历第3周周三');
  assert.equal(academic.format(new Date('2026-09-13T16:00:00Z')), '9月14日 校历第1周周一');
  assert.equal(academic.format(new Date('2027-01-03T00:00:00Z')), '1月3日 校历第16周周日');
  assert.equal(academic.format(new Date('2027-01-04T00:00:00Z')), '1月4日 周一');
  academic.setSemester({
    semesterId: config.semesterId,
    firstWeekMonday: '2026-09-21',
    teachingWeeks: 18,
  });
  assert.equal(academic.format(new Date('2026-09-29T00:00:00Z')), '9月29日 校历第2周周二');
  academic.reset();
});

test('personal patches retain only changed fields and never replace imported ownership/source metadata', () => {
  const original = projectCourseSchedules([course], config).events[0];
  const event = applyOverride(original);
  const patch = makePatch(event, {
    title: '旁听 · 信息论',
    description: event.description,
    startAt: event.startAt,
    endAt: event.endAt,
  });
  assert.deepEqual(patch, { title: '旁听 · 信息论' });
  const row = { patch_json: patch, version: 2 };
  const synced = applyOverride(
    { ...original, description: '新教室', updatedAt: '2026-09-30' },
    row,
  );
  assert.equal(synced.title, '旁听 · 信息论');
  assert.equal(synced.description, '新教室');
  assert.notEqual(synced.sourceRevision, event.sourceRevision);
  assert.equal(applyOverride(original, { patch_json: { deleted: true } }), null);
  assert.throws(() => makePatch(event, { userId: 2 }), { status: 400 });
  assert.throws(() => makePatch(event, { startAt: 'nonsense' }), { status: 400 });
  assert.throws(() => makePatch(event, { startAt: event.endAt }), { status: 400 });
});

function fixture() {
  let generation = 1;
  let snapshotGeneration = 1;
  let patchRow;
  let source = course;
  const log = [];
  const pool = {
    log,
    resync(next = course) {
      source = next;
    },
    rebind() {
      generation += 1;
    },
    newSnapshot() {
      snapshotGeneration = generation;
    },
    async getConnection() {
      return pool;
    },
    async beginTransaction() {
      log.push('begin');
    },
    async commit() {
      log.push('commit');
    },
    async rollback() {
      log.push('rollback');
    },
    release() {
      log.push('release');
    },
    async execute(sql, params) {
      assert.equal(params[0], 7);
      if (sql.includes('FOR UPDATE')) return [[{ generation }]];
      if (sql.includes('FROM campus_learn_semester_snapshots'))
        return [
          [
            {
              semester_id: config.semesterId,
              courses_json: [source],
              settings_generation: generation,
              snapshot_generation: snapshotGeneration,
              connector_generation: generation,
              first_week_monday: config.firstWeekMonday,
              teaching_weeks: 16,
              options_json: {},
              fetched_at: '2026-09-29T00:00:00Z',
              connected_at: '2026-09-01T00:00:00Z',
            },
          ],
        ];
      if (sql.includes('FROM campus_schedule_overrides'))
        return [[...(patchRow?.connector_generation === generation ? [patchRow] : [])]];
      if (sql.includes('INSERT INTO campus_schedule_overrides')) {
        patchRow = {
          connector_generation: params[1],
          public_id: params[2],
          patch_json: JSON.parse(params[3]),
          version: params[4],
        };
        return [{ affectedRows: 1 }];
      }
      throw new Error(sql);
    },
  };
  return pool;
}

test('editing, resync, moving across ranges, deletion and rebinding all use one isolated event identity', async () => {
  const pool = fixture();
  const range = { start: new Date('2026-09-14'), end: new Date('2026-09-21') };
  const [item] = await listCourseSchedules(pool, 7, range);
  const body = {
    version: item.version,
    sourceRevision: item.sourceRevision,
    title: '我的旁听课',
    startAt: '2026-09-23T05:30:00Z',
    endAt: '2026-09-23T08:55:00Z',
  };
  await editImportedSchedule(pool, 7, item.publicId, body);
  assert.deepEqual(pool.log, ['begin', 'commit', 'release']);
  assert.equal((await listCourseSchedules(pool, 7, range)).length, 0);
  const nextRange = { start: new Date('2026-09-21'), end: new Date('2026-09-28') };
  let updated = (await listCourseSchedules(pool, 7, nextRange)).find(
    (event) => event.publicId === item.publicId,
  );
  assert.equal(updated.title, '我的旁听课');
  assert.equal(updated.version, 2);
  await assert.rejects(editImportedSchedule(pool, 7, item.publicId, body), { status: 409 });
  pool.resync({ ...course, scheduleText: course.scheduleText.replaceAll('A204', 'B101') });
  updated = (await listCourseSchedules(pool, 7, nextRange)).find(
    (event) => event.publicId === item.publicId,
  );
  assert.equal(updated.title, '我的旁听课');
  assert.equal(updated.description, 'B101');
  await editImportedSchedule(
    pool,
    7,
    item.publicId,
    { version: updated.version, sourceRevision: updated.sourceRevision },
    { remove: true },
  );
  assert.equal(
    (await listCourseSchedules(pool, 7, nextRange)).some(
      (event) => event.publicId === item.publicId,
    ),
    false,
  );
  pool.rebind();
  assert.deepEqual(await listCourseSchedules(pool, 7, range), []);
  pool.newSnapshot();
  const [rebound] = await listCourseSchedules(pool, 7, range);
  assert.equal(rebound.title, course.title);
  assert.equal(rebound.version, 1);
});
