const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { saveManualCourse } = require('./manual-courses');
const { editImportedSchedule } = require('./campus-schedule-overrides');
const { ensureWorkbenchTables, listCampusSemesters, readCampusSemester } = require('./workbench');
const { ensureCampusConnectorTables } = require('./tsinghua-connectors/schema');
const { createMysqlCampusConnectorStore } = require('./tsinghua-connectors/mysql-store');
const { previewCourseImport, confirmCourseImport } = require('./course-imports');
const {
  readPreferences,
  savePreferences,
  normalizePreferences,
} = require('./planning-preferences');
const { listCourseSchedules, readCourseCalendar } = require('./course-schedule');

test(
  'isolated MySQL: course migration, settings, resync and connector generation are executable',
  { skip: process.env.RUN_WORKBENCH_MYSQL !== '1', timeout: 30000 },
  async (t) => {
    const mysql = require('mysql2/promise');
    const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
    const config = isolatedMysqlConfig('WORKBENCH_MYSQL_SOCKET');
    const admin = await mysql.createConnection(config);
    const database = `workbench_courses_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^workbench_courses_test_[a-f0-9]{32}$/);
    let pool;
    let created = false;
    t.after(async () => {
      try {
        if (pool) await pool.end();
        if (created) await admin.query(`DROP DATABASE ${database}`);
      } finally {
        await admin.end();
      }
    });
    await assertIsolatedMysql(admin);
    await admin.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    created = true;
    pool = mysql.createPool({ ...config, database, timezone: 'Z' });
    await pool.query('CREATE TABLE users (id BIGINT PRIMARY KEY) ENGINE=InnoDB');
    await pool.query('INSERT INTO users VALUES (1), (2)');
    await ensureWorkbenchTables(pool);
    const preferenceMigration = fs.readFileSync(
      path.join(__dirname, '../database/migrations/059_workbench_planning_preferences.sql'),
      'utf8',
    );
    await pool.query(preferenceMigration);
    await pool.query(preferenceMigration);
    await savePreferences(pool, 1, normalizePreferences({ focusMinutes: 30 }));
    assert.equal((await readPreferences(pool, 1)).preferences.focusMinutes, 30);
    assert.equal((await readPreferences(pool, 2)).preferences.focusMinutes, 60);
    await pool.query(`CREATE TABLE campus_learn_semester_catalogs (
      user_id BIGINT PRIMARY KEY,
      current_semester_id VARCHAR(32) NULL,
      semesters_json JSON NOT NULL,
      fetched_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_campus_learn_semester_catalogs_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    const legacy = fs.readFileSync(
      path.join(__dirname, '../database/migrations/021_create_campus_semester_snapshots.sql'),
      'utf8',
    );
    for (const statement of legacy
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean)) {
      await pool.query(statement);
    }
    await pool.execute(`INSERT INTO campus_learn_semester_snapshots
      (user_id, semester_id, courses_json, notifications_json, fetched_at)
      VALUES (1, '2026-2027-1', '[]', '[]', '2026-09-21 02:00:00')`);
    await pool.execute(`INSERT INTO campus_learn_semester_catalogs
      (user_id, current_semester_id, semesters_json, fetched_at)
      VALUES (1, '2026-2027-1', '[{"id":"2026-2027-1"}]', '2026-09-21 02:00:00')`);
    // Begin with the deployed pre-056 settings table, including an existing row.
    const settingsDdl = fs
      .readFileSync(path.join(__dirname, '../database/migrations/051_course_calendar.sql'), 'utf8')
      .split('CREATE TABLE IF NOT EXISTS campus_course_calendar_settings')[1];
    await pool.query(`CREATE TABLE IF NOT EXISTS campus_course_calendar_settings${settingsDdl}`);
    await pool.query(`INSERT INTO campus_course_calendar_settings
      (user_id, semester_id, connector_generation, first_week_monday)
      VALUES (1, '2026-2027-1', 1, '2026-09-21')`);
    const migrateWeeks = async () => {
      const connection = await pool.getConnection();
      try {
        const sql = fs.readFileSync(
          path.join(__dirname, '../database/migrations/056_course_calendar_teaching_weeks.sql'),
          'utf8',
        );
        for (const statement of sql
          .split(';')
          .map((value) => value.trim())
          .filter(Boolean)) {
          await connection.query(statement);
        }
      } finally {
        connection.release();
      }
    };
    await migrateWeeks();
    const migrateEditableCalendar = async () => {
      const connection = await pool.getConnection();
      try {
        const sql = fs.readFileSync(
          path.join(__dirname, '../database/migrations/058_editable_campus_calendar.sql'),
          'utf8',
        );
        for (const statement of sql
          .split(';')
          .map((value) => value.trim())
          .filter(Boolean))
          await connection.query(statement);
      } finally {
        connection.release();
      }
    };
    await migrateEditableCalendar();
    await ensureCampusConnectorTables(pool);
    await ensureCampusConnectorTables(pool);
    await migrateEditableCalendar();
    await migrateWeeks();
    const [[legacySettings]] = await pool.query(
      'SELECT teaching_weeks FROM campus_course_calendar_settings',
    );
    assert.equal(
      legacySettings.teaching_weeks,
      null,
      'migration must not silently assume 16 weeks',
    );
    const [[legacySnapshot]] = await pool.query(
      'SELECT connector_generation FROM campus_learn_semester_snapshots',
    );
    const [[legacyCatalog]] = await pool.query(
      'SELECT connector_generation FROM campus_learn_semester_catalogs',
    );
    assert.equal(legacySnapshot.connector_generation, null);
    assert.equal(legacyCatalog.connector_generation, null);
    await pool.execute(`INSERT INTO user_campus_connectors
      (public_id, user_id, provider, adapter_id, adapter_version, status, generation, connected_at)
      VALUES ('ucc_course_qa', 1, 'tsinghua-learn', 'fixture', '1', 'active_verified', 1, '2026-09-20 02:00:00')`);
    const range = {
      start: new Date('2026-09-20T16:00:00Z'),
      end: new Date('2026-09-27T16:00:00Z'),
    };
    assert.deepEqual(await listCourseSchedules(pool, 1, range), []);
    assert.deepEqual(await listCampusSemesters(pool, 1), {
      currentSemesterId: null,
      semesters: [],
    });
    assert.equal(await readCampusSemester(pool, 1, '2026-2027-1'), null);
    const course = {
      sourceReference: 'course:a',
      title: '课程',
      scheduleText: '1-16周 周一第2大节',
      locationText: '101',
    };
    await pool.execute(
      `UPDATE campus_learn_semester_snapshots
      SET courses_json = ?, connector_generation = 1 WHERE user_id = 1`,
      [JSON.stringify([course])],
    );
    await pool.execute(
      'UPDATE campus_learn_semester_catalogs SET connector_generation = 1 WHERE user_id = 1',
    );
    assert.equal((await listCampusSemesters(pool, 1)).semesters.length, 1);
    assert.equal((await readCampusSemester(pool, 1, '2026-2027-1')).courses.length, 1);
    const calendar = { semesterId: '2026-2027-1' };
    // Exercise the actual deployment migration against a pre-060 schema in this
    // disposable database, including a legacy personal calendar that must survive.
    await pool.execute(
      'ALTER TABLE campus_learn_semester_snapshots DROP COLUMN calendar_copy_json',
    );
    const migrateCopies = async () => {
      const connection = await pool.getConnection();
      try {
        const sql = fs.readFileSync(
          path.join(__dirname, '../database/migrations/060_confirmed_course_import.sql'),
          'utf8',
        );
        for (const statement of sql
          .split(';')
          .map((part) => part.trim())
          .filter(Boolean))
          await connection.query(statement);
      } finally {
        connection.release();
      }
    };
    await migrateCopies();
    assert.equal(
      (await listCourseSchedules(pool, 1, range))[0].startAt,
      '2026-09-21T01:50:00.000Z',
    );
    assert.equal(
      (await readCourseCalendar(pool, 1, calendar.semesterId)).firstWeekMonday,
      '2026-09-21',
    );
    // A new/unconfirmed snapshot is not auto-imported by rerunning the migration.
    await pool.execute('UPDATE campus_learn_semester_snapshots SET calendar_copy_json = NULL');
    await migrateCopies();
    assert.deepEqual(
      await listCourseSchedules(pool, 1, range),
      [],
      'new courses need confirmation',
    );
    await ensureCampusConnectorTables(pool);
    assert.deepEqual(
      await listCourseSchedules(pool, 1, range),
      [],
      'boot cannot auto-import new courses',
    );
    const acceptCourses = async () => {
      const preview = await previewCourseImport(pool, 1, calendar.semesterId);
      return confirmCourseImport(pool, 1, {
        semesterId: calendar.semesterId,
        revision: preview.revision,
      });
    };
    assert.equal((await acceptCourses()).scheduledLessons, 15);
    const [first] = await listCourseSchedules(pool, 1, range);
    assert.equal(first.startAt, '2026-09-21T01:50:00.000Z');
    assert.deepEqual(await listCourseSchedules(pool, 2, range), []);
    await assert.rejects(previewCourseImport(pool, 2, calendar.semesterId), { status: 409 });
    const initialPreview = await previewCourseImport(pool, 1, calendar.semesterId);
    await pool.execute(
      'UPDATE campus_learn_semester_snapshots SET courses_json = ? WHERE user_id = 1',
      [JSON.stringify([{ ...course, locationText: '201' }])],
    );
    const [unchanged] = await listCourseSchedules(pool, 1, range);
    assert.deepEqual(unchanged, first, 'ordinary sync must not change confirmed events');
    await assert.rejects(
      confirmCourseImport(pool, 1, {
        semesterId: calendar.semesterId,
        revision: initialPreview.revision,
      }),
      { status: 409 },
    );
    await acceptCourses();
    const [changed] = await listCourseSchedules(pool, 1, range);
    assert.equal(changed.publicId, first.publicId);
    assert.equal(changed.description, '201');
    const fullWeek = {
      ...course,
      sectionSystem: 'tsinghua-large',
      scheduleText: '星期一第2节(全周)',
    };
    await pool.execute(
      'UPDATE campus_learn_semester_snapshots SET courses_json = ? WHERE user_id = 1',
      [JSON.stringify([fullWeek])],
    );
    await acceptCourses();
    assert.equal((await readCourseCalendar(pool, 1, calendar.semesterId)).teachingWeeks, 16);
    const [[manual]] = await pool.query('SELECT COUNT(*) AS total FROM schedule_items');
    assert.equal(Number(manual.total), 0);
    const [editable] = await listCourseSchedules(pool, 1, range);
    const editBody = {
      title: '我的旁听课',
      version: editable.version,
      sourceRevision: editable.sourceRevision,
      startAt: '2026-09-29T01:50:00Z',
      endAt: '2026-09-29T03:25:00Z',
    };
    await assert.rejects(editImportedSchedule(pool, 2, editable.publicId, editBody), {
      status: 404,
    });
    const competing = await Promise.allSettled([
      editImportedSchedule(pool, 1, editable.publicId, editBody),
      editImportedSchedule(pool, 1, editable.publicId, { ...editBody, title: '另一个窗口的修改' }),
    ]);
    assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(competing.find((result) => result.status === 'rejected').reason.status, 409);
    assert.equal((await listCourseSchedules(pool, 1, range)).length, 0);
    const movedRange = {
      start: new Date('2026-09-28T00:00:00Z'),
      end: new Date('2026-10-05T00:00:00Z'),
    };
    const moved = (await listCourseSchedules(pool, 1, movedRange)).find(
      (item) => item.publicId === editable.publicId,
    );
    assert.equal(moved.endAt, '2026-09-29T03:25:00.000Z');
    assert.equal(moved.version, 2);
    await pool.execute(
      'UPDATE campus_learn_semester_snapshots SET courses_json = ? WHERE user_id = 1',
      [JSON.stringify([{ ...fullWeek, locationText: '更新后的教室' }])],
    );
    const resynced = (await listCourseSchedules(pool, 1, movedRange)).find(
      (item) => item.publicId === editable.publicId,
    );
    assert.equal(resynced.title, moved.title);
    assert.equal(resynced.description, moved.description, 'sync leaves saved room unchanged');
    const savedBeforeDisconnect = await listCourseSchedules(pool, 1, movedRange);
    await createMysqlCampusConnectorStore(pool).revokeConnection(1, 'tsinghua-learn', new Date());
    assert.deepEqual(await listCourseSchedules(pool, 1, movedRange), savedBeforeDisconnect);
    assert.equal((await listCampusSemesters(pool, 1)).semesters.length, 1);
    assert.equal((await readCampusSemester(pool, 1, '2026-2027-1')).courses.length, 1);
    const offlineEdit = await editImportedSchedule(pool, 1, resynced.publicId, {
      version: resynced.version,
      sourceRevision: resynced.sourceRevision,
      description: '离线修改的地点',
    });
    assert.equal(offlineEdit.description, '离线修改的地点');
    await editImportedSchedule(
      pool,
      1,
      resynced.publicId,
      { version: offlineEdit.version, sourceRevision: offlineEdit.sourceRevision },
      { remove: true },
    );
    assert.equal(
      (await listCourseSchedules(pool, 1, movedRange)).some(
        (item) => item.publicId === resynced.publicId,
      ),
      false,
    );
    await pool.execute(`UPDATE user_campus_connectors SET generation = 2,
      connected_at = '2026-09-22 02:00:00' WHERE user_id = 1`);
    assert.deepEqual(await listCourseSchedules(pool, 1, range), []);
    assert.equal((await listCampusSemesters(pool, 1)).semesters.length, 1);
    assert.equal((await readCampusSemester(pool, 1, '2026-2027-1')).courses.length, 1);
    await pool.execute(
      'UPDATE campus_learn_semester_snapshots SET connector_generation = 2 WHERE user_id = 1',
    );
    await pool.execute(
      'UPDATE campus_learn_semester_catalogs SET connector_generation = 2 WHERE user_id = 1',
    );
    assert.equal((await listCampusSemesters(pool, 1)).semesters.length, 1);
    assert.equal((await readCampusSemester(pool, 1, '2026-2027-1')).courses.length, 1);
    await pool.execute(`UPDATE campus_learn_semester_snapshots
      SET fetched_at = '2026-09-22 03:00:00' WHERE user_id = 1`);
    await pool.execute(`UPDATE campus_learn_semester_catalogs
      SET fetched_at = '2026-09-22 03:00:00' WHERE user_id = 1`);
    assert.deepEqual(
      await listCourseSchedules(pool, 1, range),
      [],
      'deleted occurrences stay deleted after renewing a grant',
    );
    assert.equal((await listCampusSemesters(pool, 1)).semesters.length, 1);
    assert.equal((await readCampusSemester(pool, 1, '2026-2027-1')).courses.length, 1);
    assert.equal((await readCourseCalendar(pool, 1, calendar.semesterId)).teachingWeeks, 16);
    await assert.rejects(previewCourseImport(pool, 1, calendar.semesterId), { status: 409 });
    await pool.execute("UPDATE user_campus_connectors SET status = 'revoked' WHERE user_id = 1");
    assert.deepEqual(await listCourseSchedules(pool, 1, range), []);
    assert.equal((await listCampusSemesters(pool, 1)).semesters.length, 1);
    assert.equal((await readCampusSemester(pool, 1, '2026-2027-1')).courses.length, 1);
    assert.deepEqual(await listCourseSchedules(pool, 2, movedRange), []);

    const recurring = {
      title: '重复会议',
      description: '会议室101',
      kind: 'event',
      startAt: '2026-10-04T10:00:00+08:00',
      endAt: '2026-10-04T11:00:00+08:00',
      recurrence: { unit: 'week', interval: 2, until: '2026-11-01' },
    };
    assert.equal((await saveManualCourse(pool, 1, recurring, { kind: 'event' })).created, 3);
    await assert.rejects(saveManualCourse(pool, 1, recurring, { kind: 'event' }), { status: 409 });
    const [[repeats]] = await pool.query(
      "SELECT COUNT(*) AS total FROM schedule_items WHERE source_reference LIKE 'manual:recurring:%'",
    );
    assert.equal(Number(repeats.total), 3);
    const conflict = { ...recurring, title: '重复旁听课' };
    await assert.rejects(saveManualCourse(pool, 1, conflict), {
      status: 409,
      code: 'course_conflict',
    });
    assert.equal(
      (await saveManualCourse(pool, 1, { ...conflict, allowConflicts: true })).created,
      3,
    );
    const [[other]] = await pool.query(
      'SELECT COUNT(*) AS total FROM schedule_items WHERE user_id = 2',
    );
    assert.equal(Number(other.total), 0);

    // Exercise the production ranking expression against actual MySQL, not a JS approximation.
    const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const balancedOrder = /sortMode === 'balanced'[\s\S]*?orderBy = `([^`]+)`/.exec(
      serverSource,
    )[1];
    const [ranked] = await pool.query(`SELECT p.id FROM (
      SELECT 1 AS id, 0 AS is_pinned, NOW() AS created_at
      UNION ALL SELECT 2, 0, NOW() - INTERVAL 2 HOUR
      UNION ALL SELECT 3, 0, NOW() - INTERVAL 180 DAY
      UNION ALL SELECT 4, 1, NOW() - INTERVAL 200 DAY
    ) p LEFT JOIN (SELECT 2 AS post_id, 10 AS comment_count UNION ALL SELECT 3, 50) c ON c.post_id = p.id
    LEFT JOIN (SELECT 2 AS post_id, 5 AS reaction_count UNION ALL SELECT 3, 30) l ON l.post_id = p.id
    ORDER BY ${balancedOrder}`);
    assert.deepEqual(
      ranked.map((row) => row.id),
      [4, 2, 1, 3],
    );

    await pool.query(`CREATE TABLE discussion_boards (
      id BIGINT PRIMARY KEY AUTO_INCREMENT, slug VARCHAR(32) UNIQUE, name VARCHAR(64),
      description TEXT, description_markdown TEXT, sort_order INT, is_active TINYINT)`);
    await pool.query(
      "INSERT INTO discussion_boards (id, slug, name, description_markdown) VALUES (77, 'math', '数理', '管理员编辑的介绍')",
    );
    const catalogMigration = fs.readFileSync(
      path.join(__dirname, '../database/migrations/057_discussion_board_catalog.sql'),
      'utf8',
    );
    await pool.query(catalogMigration);
    await pool.query(catalogMigration);
    const [boards] = await pool.query(
      'SELECT id, slug, name, description_markdown FROM discussion_boards ORDER BY sort_order',
    );
    assert.deepEqual(
      boards.map((row) => row.name),
      ['日常', '数学', '物理', '电路', '信号', '计算机', '实验', '更新日志'],
    );
    assert.equal(boards[1].id, 77);
    assert.equal(boards[1].description_markdown, '管理员编辑的介绍');
  },
);
