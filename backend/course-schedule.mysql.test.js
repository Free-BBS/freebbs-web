const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ensureWorkbenchTables, listCampusSemesters, readCampusSemester } = require('./workbench');
const { ensureCampusConnectorTables } = require('./tsinghua-connectors/schema');
const { listCourseSchedules, saveCourseCalendar } = require('./course-schedule');

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
    await ensureCampusConnectorTables(pool);
    await ensureCampusConnectorTables(pool);
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
    const calendar = { semesterId: '2026-2027-1', firstWeekMonday: '2026-09-21' };
    assert.equal((await saveCourseCalendar(pool, 1, calendar)).scheduledLessons, 16);
    assert.equal((await saveCourseCalendar(pool, 1, calendar)).scheduledLessons, 16);
    const [first] = await listCourseSchedules(pool, 1, range);
    assert.equal(first.startAt, '2026-09-21T01:50:00.000Z');
    assert.deepEqual(await listCourseSchedules(pool, 2, range), []);
    await pool.execute(
      'UPDATE campus_learn_semester_snapshots SET courses_json = ? WHERE user_id = 1',
      [JSON.stringify([{ ...course, locationText: '201' }])],
    );
    const [changed] = await listCourseSchedules(pool, 1, range);
    assert.equal(changed.publicId, first.publicId);
    assert.match(changed.description, /201/);
    const [[manual]] = await pool.query('SELECT COUNT(*) AS total FROM schedule_items');
    assert.equal(Number(manual.total), 0);
    await pool.execute(`UPDATE user_campus_connectors SET generation = 2,
      connected_at = '2026-09-22 02:00:00' WHERE user_id = 1`);
    assert.deepEqual(await listCourseSchedules(pool, 1, range), []);
    assert.deepEqual(await listCampusSemesters(pool, 1), {
      currentSemesterId: null,
      semesters: [],
    });
    assert.equal(await readCampusSemester(pool, 1, '2026-2027-1'), null);
    await pool.execute(
      'UPDATE campus_learn_semester_snapshots SET connector_generation = 2 WHERE user_id = 1',
    );
    await pool.execute(
      'UPDATE campus_learn_semester_catalogs SET connector_generation = 2 WHERE user_id = 1',
    );
    assert.deepEqual((await listCampusSemesters(pool, 1)).semesters, []);
    assert.equal(await readCampusSemester(pool, 1, '2026-2027-1'), null);
    await pool.execute(`UPDATE campus_learn_semester_snapshots
      SET fetched_at = '2026-09-22 03:00:00' WHERE user_id = 1`);
    await pool.execute(`UPDATE campus_learn_semester_catalogs
      SET fetched_at = '2026-09-22 03:00:00' WHERE user_id = 1`);
    assert.deepEqual(await listCourseSchedules(pool, 1, range), []);
    assert.equal((await listCampusSemesters(pool, 1)).semesters.length, 1);
    assert.equal((await readCampusSemester(pool, 1, '2026-2027-1')).courses.length, 1);
    await saveCourseCalendar(pool, 1, calendar);
    assert.equal((await listCourseSchedules(pool, 1, range)).length, 1);
    await pool.execute("UPDATE user_campus_connectors SET status = 'revoked' WHERE user_id = 1");
    assert.deepEqual(await listCourseSchedules(pool, 1, range), []);
    assert.deepEqual(await listCampusSemesters(pool, 1), {
      currentSemesterId: null,
      semesters: [],
    });
    assert.equal(await readCampusSemester(pool, 1, '2026-2027-1'), null);
  },
);
