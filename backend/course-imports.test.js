const test = require('node:test');
const assert = require('node:assert/strict');
const {
  prepareCourseImport,
  previewCourseImport,
  confirmCourseImport,
} = require('./course-imports');
const { ensureCourseCopies } = require('./course-import-schema');
const { listCourseSchedules } = require('./course-schedule');

const semester = '2026-2027-1';
const source = () => ({
  connector_generation: 3,
  fetched_at: '2026-09-29T02:00:00Z',
  sync_status: 'complete',
  calendar_copy_json: null,
  courses_json: [
    {
      title: '课程 &mdash; 示例',
      sourceReference: 'course:test',
      sectionSystem: 'tsinghua-large',
      scheduleText: '星期三第3节(全周)，101;星期三第4节(全周)，101',
    },
  ],
});

test('import preview uses the common calendar, merges adjacent sections, skips holidays and does not trust custom settings', () => {
  const row = source();
  const untouched = structuredClone(row);
  const { preview, copy } = prepareCourseImport(row, semester);
  assert.deepEqual(row, untouched);
  assert.equal(preview.firstWeekMonday, '2026-09-14');
  assert.equal(preview.teachingWeeks, 16);
  assert.equal(preview.scheduledLessons, 15);
  assert.equal(preview.skippedLessons, 1);
  assert.equal(preview.courses[0].title, '课程 — 示例');
  assert.equal(copy.events.length, 16);
  assert.equal(copy.events[0].startAt, '2026-09-16T05:30:00.000Z');
  assert.equal(copy.events[0].endAt, '2026-09-16T08:55:00.000Z');
  assert.throws(() => prepareCourseImport(row, 'unknown'), { status: 409 });
  assert.throws(() => prepareCourseImport({ ...row, sync_status: 'partial' }, semester), {
    status: 409,
  });
  assert.throws(() => prepareCourseImport({ ...row, courses_json: [] }, semester), { status: 409 });
});

test('confirmation is user-scoped, transactional, rejects stale previews and leaves saved copies unchanged until confirmation', async () => {
  const row = source();
  let writes = 0;
  let commits = 0;
  let rollbacks = 0;
  let releases = 0;
  const pool = {
    async getConnection() {
      return this;
    },
    async beginTransaction() {
      /* Memory-only transaction fixture. */
    },
    async commit() {
      commits += 1;
    },
    async rollback() {
      rollbacks += 1;
    },
    release() {
      releases += 1;
    },
    async execute(sql, args) {
      if (sql.startsWith('SELECT id FROM user_campus_connectors')) return [[{ id: 1 }]];
      if (sql.startsWith('UPDATE')) {
        assert.deepEqual(args.slice(1), [7, semester]);
        row.calendar_copy_json = JSON.parse(args[0]);
        writes += 1;
        return [{ affectedRows: 1 }];
      }
      assert.match(sql, /c.generation = s.connector_generation/);
      assert.match(sql, /c.status IN \('active_verified', 'active_unverified'\)/);
      return [args[0] === 7 ? [row] : []];
    },
  };
  const preview = await previewCourseImport(pool, 7, semester);
  assert.equal(writes, 0);
  await assert.rejects(
    confirmCourseImport(pool, 8, { semesterId: semester, revision: preview.revision }),
    { status: 409 },
  );
  await confirmCourseImport(pool, 7, {
    semesterId: semester,
    revision: preview.revision,
    firstWeekMonday: '2000-01-03',
    options: { holidayPreset: '' },
  });
  assert.equal(row.calendar_copy_json.firstWeekMonday, '2026-09-14');
  const saved = structuredClone(row.calendar_copy_json);
  row.courses_json[0].title = '更新课程';
  assert.deepEqual(row.calendar_copy_json, saved);
  await assert.rejects(
    confirmCourseImport(pool, 7, { semesterId: semester, revision: preview.revision }),
    { status: 409 },
  );
  assert.deepEqual(row.calendar_copy_json, saved);
  const refresh = await previewCourseImport(pool, 7, semester);
  await confirmCourseImport(pool, 7, { semesterId: semester, revision: refresh.revision });
  assert.equal(row.calendar_copy_json.courses[0].title, '更新课程');
  assert.deepEqual([writes, commits, rollbacks, releases], [2, 2, 2, 4]);
});

test('saved event projection is used even if the latest live snapshot or school configuration changes', async () => {
  const { copy } = prepareCourseImport(source(), semester);
  const pool = {
    async execute(sql, args) {
      assert.equal(args[0], 7);
      if (sql.includes('campus_schedule_overrides')) return [[]];
      assert.match(sql, /s.calendar_copy_json IS NOT NULL/);
      return [
        [
          {
            semester_id: semester,
            calendar_copy_json: copy,
            snapshot_generation: copy.generation,
            connector_generation: copy.generation,
            fetched_at: copy.fetchedAt,
            courses_json: [],
          },
        ],
      ];
    },
  };
  const events = await listCourseSchedules(pool, 7, {
    start: new Date('2026-09-14'),
    end: new Date('2026-09-21'),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].title, copy.events[0].title);
});

test('boot backfills only when adding the column and never treats a newly synced semester as confirmed', async () => {
  let exists = false;
  let writes = 0;
  const pool = {
    async execute(sql) {
      if (sql.includes('information_schema')) return [exists ? [{ present: 1 }] : []];
      if (sql.startsWith('ALTER')) exists = true;
      if (sql.startsWith('UPDATE')) writes += 1;
      return [{ affectedRows: 1 }];
    },
  };
  await ensureCourseCopies(pool);
  await ensureCourseCopies(pool);
  assert.equal(writes, 1);
});
