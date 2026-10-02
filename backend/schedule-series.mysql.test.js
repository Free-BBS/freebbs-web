const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createWorkbenchRouter, ensureWorkbenchTables } = require('./workbench');
const { saveManualCourse } = require('./manual-courses');
const { OVERRIDE_TABLE } = require('./campus-schedule-overrides');
const { listCourseSchedules, projectCourseSchedules } = require('./course-schedule');

test(
  'isolated MySQL: series ownership, rules, exceptions, concurrency, rollback and imported resync',
  { skip: process.env.RUN_WORKBENCH_MYSQL !== '1', timeout: 60000 },
  async (t) => {
    const mysql = require('mysql2/promise');
    const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
    const config = isolatedMysqlConfig('WORKBENCH_MYSQL_SOCKET');
    const admin = await mysql.createConnection(config);
    await assertIsolatedMysql(admin);
    const database = `schedule_series_test_${randomUUID().replaceAll('-', '')}`;
    let pool;
    let server;
    t.after(async () => {
      if (server)
        await new Promise((resolve) => {
          server.close(resolve);
        });
      if (pool) await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
      await admin.end();
    });
    await admin.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    pool = mysql.createPool({ ...config, database, timezone: 'Z', connectionLimit: 6 });
    await pool.query('CREATE TABLE users (id BIGINT PRIMARY KEY) ENGINE=InnoDB');
    await pool.query('INSERT INTO users VALUES (1), (2)');
    await ensureWorkbenchTables(pool);
    const migration = fs.readFileSync(
      path.join(__dirname, '../database/migrations/066_schedule_series.sql'),
      'utf8',
    );
    await pool.query(migration);
    await pool.query(migration);
    await pool.query(OVERRIDE_TABLE);
    await pool.query(`CREATE TABLE user_campus_connectors (
      user_id BIGINT, provider VARCHAR(32), generation INT, status VARCHAR(32), PRIMARY KEY(user_id,provider))`);
    await pool.query(`CREATE TABLE campus_learn_semester_snapshots (
      user_id BIGINT, semester_id VARCHAR(32), connector_generation INT,
      calendar_copy_json JSON, courses_json JSON, sync_status VARCHAR(32), fetched_at DATETIME,
      PRIMARY KEY(user_id,semester_id))`);
    await pool.query(`CREATE TABLE campus_course_calendar_settings (
      user_id BIGINT, semester_id VARCHAR(32), connector_generation INT, first_week_monday DATE,
      teaching_weeks INT, options_json JSON, PRIMARY KEY(user_id,semester_id))`);
    const app = express();
    app.use(express.json());
    app.use(
      createWorkbenchRouter({
        pool,
        requireAuth: async (request, response) => {
          if (!request.headers['x-test-user']) {
            response.status(401).json({ message: '登录后使用' });
            return null;
          }
          return { id: Number(request.headers['x-test-user']) };
        },
      }),
    );
    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const http = async (route, body, user = 1, method = body ? 'POST' : 'GET') => {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(user ? { 'x-test-user': String(user) } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    };
    const detail = async (id, user = 1) => {
      const result = await http(`/schedule-items/${id}/series`, null, user);
      assert.equal(result.status, 200);
      return result.body.series;
    };
    const mutation = async (id, series, fields) =>
      http(`/schedule-items/${id}/series`, {
        version: series.version,
        fingerprint: series.fingerprint,
        scope: 'single',
        operation: 'update',
        patch: {},
        allowConflicts: true,
        ...fields,
      });
    const singleCreated = await http('/schedule-items', {
      title: '独立事件删除',
      startAt: '2026-11-20T01:00:00Z',
      endAt: '2026-11-20T02:00:00Z',
    });
    assert.equal(singleCreated.status, 201);
    const singleId = singleCreated.body.scheduleItem.publicId;
    assert.equal(await detail(singleId), null);
    assert.equal(
      (await http(`/schedule-items/${singleId}`, { version: 2 }, 1, 'DELETE')).status,
      409,
    );
    assert.equal(
      (await http(`/schedule-items/${singleId}`, { version: 1 }, 2, 'DELETE')).status,
      409,
    );
    assert.equal(
      (await http(`/schedule-items/${singleId}`, { version: 1 }, 1, 'DELETE')).status,
      200,
    );
    await saveManualCourse(pool, 1, {
      title: '每周课程',
      description: 'A101',
      startAt: '2026-09-22T01:00:00Z',
      endAt: '2026-09-22T02:00:00Z',
      recurrence: { unit: 'week', interval: 1, count: 4 },
    });
    let [rows] = await pool.query('SELECT * FROM schedule_items ORDER BY start_at');
    const ids = rows.map((row) => row.public_id);
    const originalSeries = await detail(ids[1]);
    assert.deepEqual(originalSeries.recurrence, { unit: 'week', interval: 1, count: 3 });
    assert.equal((await http(`/schedule-items/${ids[1]}/series`, null, 2)).status, 404);
    assert.equal((await http(`/schedule-items/${ids[1]}/series`, null, 0)).status, 401);
    assert.equal(
      (
        await http(
          `/schedule-items/${ids[1]}/series`,
          {
            version: originalSeries.version,
            fingerprint: originalSeries.fingerprint,
            scope: 'following',
            operation: 'delete',
          },
          2,
        )
      ).status,
      404,
    );

    assert.equal(
      (await mutation(ids[2], await detail(ids[2]), { patch: { title: '单次例外' } })).status,
      200,
    );
    assert.equal(
      (await mutation(ids[1], originalSeries, { patch: { title: '过期修改' } })).status,
      409,
    );
    assert.equal(
      (await mutation(ids[3], await detail(ids[3]), { operation: 'delete' })).status,
      200,
    );
    const following = await detail(ids[1]);
    assert.equal(
      (
        await mutation(ids[1], following, {
          scope: 'following',
          recurrenceMode: 'replace',
          recurrence: { unit: 'week', interval: 1, count: 3 },
          patch: { title: '重新安排' },
        })
      ).status,
      200,
    );
    [rows] = await pool.query('SELECT * FROM schedule_items ORDER BY start_at');
    assert.equal(rows.find((row) => row.public_id === ids[0]).title, '每周课程');
    assert.equal(rows.find((row) => row.public_id === ids[2]).title, '单次例外');
    assert.ok(rows.find((row) => row.public_id === ids[3]).deleted_at);
    const replacement = rows.find((row) => row.title === '重新安排' && !row.deleted_at);
    const replacementSeries = await detail(replacement.public_id);
    assert.equal(
      replacementSeries.recurrence.count,
      3,
      'end condition includes protected exception slots',
    );
    assert.equal(
      (
        await mutation(replacement.public_id, replacementSeries, {
          scope: 'following',
          recurrenceMode: 'replace',
          recurrence: { unit: 'week', interval: 1, count: 3 },
          patch: { title: '再次安排' },
        })
      ).status,
      200,
    );
    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM schedule_items WHERE deleted_at IS NULL',
    );
    assert.equal(total, 3, 'repeated series changes must not recreate exceptions');

    const [active] = await pool.query(
      "SELECT * FROM schedule_items WHERE title = '再次安排' AND deleted_at IS NULL",
    );
    const token = await detail(active[0].public_id);
    const concurrent = await Promise.all([
      mutation(active[0].public_id, token, { patch: { title: '并发 A' } }),
      mutation(active[0].public_id, token, { patch: { title: '并发 B' } }),
    ]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);

    // A trigger failure proves item writes and series metadata roll back together.
    const [before] = await pool.query('SELECT * FROM schedule_items WHERE public_id = ?', [
      active[0].public_id,
    ]);
    const rollbackToken = await detail(active[0].public_id);
    await pool.query(`CREATE TRIGGER reject_series BEFORE UPDATE ON schedule_series FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test rollback'`);
    assert.equal(
      (await mutation(active[0].public_id, rollbackToken, { patch: { title: '不能保存' } })).status,
      500,
    );
    const [after] = await pool.query('SELECT * FROM schedule_items WHERE public_id = ?', [
      active[0].public_id,
    ]);
    assert.equal(after[0].title, before[0].title);
    assert.equal(after[0].version, before[0].version);
    await pool.query('DROP TRIGGER reject_series');

    const course = {
      sourceReference: 'course:irregular',
      title: '真实周次课程',
      sectionSystem: 'tsinghua-large',
      scheduleText: '第1,3,5周 星期二第2大节，B101',
    };
    const projected = projectCourseSchedules([course], {
      semesterId: '2026-2027-1',
      firstWeekMonday: '2026-09-14',
      teachingWeeks: 16,
      includeExcluded: true,
    }).events;
    const copy = {
      generation: 1,
      fetchedAt: '2026-10-01T00:00:00Z',
      courses: [course],
      firstWeekMonday: '2026-09-14',
      teachingWeeks: 16,
      events: projected,
    };
    await pool.execute(
      `INSERT INTO user_campus_connectors VALUES(1,'tsinghua-learn',1,'active_verified')`,
    );
    await pool.execute(
      `INSERT INTO campus_learn_semester_snapshots VALUES(1,'2026-2027-1',1,?,?,'success','2026-10-01')`,
      [JSON.stringify(copy), JSON.stringify([course])],
    );
    let imported = await detail(projected[1].publicId);
    assert.equal(imported.recurrence, null);
    assert.equal(
      imported.occurrences.length,
      3,
      'do not infer weekly recurrence for explicit teaching dates',
    );
    assert.equal(
      (
        await mutation(projected[2].publicId, await detail(projected[2].publicId), {
          patch: { title: '保留的课程单次修改' },
        })
      ).status,
      200,
    );
    imported = await detail(projected[1].publicId);
    assert.equal(
      (
        await mutation(projected[1].publicId, imported, {
          scope: 'following',
          operation: 'delete',
        })
      ).status,
      200,
    );
    const sourceToken = await detail(projected[2].publicId);
    const extra = {
      ...projected[2],
      publicId: 'cs_new_sync',
      startAt: '2026-10-27T01:50:00.000Z',
      endAt: '2026-10-27T04:15:00.000Z',
    };
    copy.generation = 2;
    copy.events = [...projected, extra];
    await pool.execute('UPDATE user_campus_connectors SET generation = 2 WHERE user_id = 1');
    await pool.execute(
      'UPDATE campus_learn_semester_snapshots SET connector_generation = 2, calendar_copy_json = ? WHERE user_id = 1',
      [JSON.stringify(copy)],
    );
    const range = { start: new Date('2026-09-01'), end: new Date('2026-12-01') };
    const resynced = await listCourseSchedules(pool, 1, range);
    assert.deepEqual(
      resynced.map((item) => item.publicId),
      [projected[0].publicId, projected[2].publicId],
    );
    assert.equal(resynced[1].title, '保留的课程单次修改');
    assert.equal((await listCourseSchedules(pool, 2, range)).length, 0);
    assert.equal(
      (await mutation(projected[2].publicId, sourceToken, { patch: { title: '过期源' } })).status,
      409,
    );
    const [[sourceCopy]] = await pool.execute(
      'SELECT calendar_copy_json FROM campus_learn_semester_snapshots WHERE user_id = 1',
    );
    assert.equal(
      sourceCopy.calendar_copy_json.courses[0].title,
      '真实周次课程',
      'personal edits never rewrite source courses',
    );

    // The ordinary list endpoints must record exceptions after a bulk edit too.
    const listCourse = {
      ...course,
      sourceReference: 'course:list-regression',
      title: '列表操作课程',
      scheduleText: '第1,3,5周 星期三第2大节，B102',
    };
    const listDates = projectCourseSchedules([listCourse], {
      semesterId: '2026-2027-1',
      firstWeekMonday: '2026-09-14',
      teachingWeeks: 16,
      includeExcluded: true,
    }).events;
    copy.courses.push(listCourse);
    copy.events.push(...listDates);
    await pool.execute(
      'UPDATE campus_learn_semester_snapshots SET calendar_copy_json = ? WHERE user_id = 1',
      [JSON.stringify(copy)],
    );
    assert.equal(
      (
        await mutation(listDates[0].publicId, await detail(listDates[0].publicId), {
          scope: 'following',
          recurrenceMode: 'keep',
          patch: { title: '整组编辑后的课程' },
        })
      ).status,
      200,
    );
    const bulkEdited = (await listCourseSchedules(pool, 1, range)).filter((item) =>
      listDates.some((date) => date.publicId === item.publicId),
    );
    assert.equal(bulkEdited.length, 3);
    const listDelete = bulkEdited[1];
    assert.equal(
      (
        await http(
          `/schedule-items/${listDelete.publicId}`,
          {
            version: listDelete.version,
            sourceRevision: listDelete.sourceRevision,
          },
          1,
          'DELETE',
        )
      ).status,
      200,
    );
    const listEdit = bulkEdited[2];
    assert.equal(
      (
        await http(
          `/schedule-items/${listEdit.publicId}`,
          {
            version: listEdit.version,
            sourceRevision: listEdit.sourceRevision,
            title: '列表单次修改',
          },
          1,
          'PATCH',
        )
      ).status,
      200,
    );
    const listSeries = await detail(listDates[0].publicId);
    assert.ok(
      listSeries.occurrences.find((item) => item.publicId === listDelete.publicId).exception,
    );
    assert.ok(listSeries.occurrences.find((item) => item.publicId === listEdit.publicId).exception);
    assert.equal(
      (
        await mutation(listDates[0].publicId, listSeries, {
          scope: 'following',
          recurrenceMode: 'replace',
          recurrence: { unit: 'week', interval: 2, count: 3 },
          patch: { title: '列表删除后重新安排' },
        })
      ).status,
      200,
    );
    const [listReplacement] = await pool.execute(
      "SELECT * FROM schedule_items WHERE title = '列表删除后重新安排' AND deleted_at IS NULL",
    );
    assert.equal(
      listReplacement.length,
      1,
      'deleted and individually edited slots are not regenerated',
    );
    const listAfter = await listCourseSchedules(pool, 1, range);
    assert.ok(!listAfter.some((item) => item.publicId === listDelete.publicId));
    assert.equal(
      listAfter.find((item) => item.publicId === listEdit.publicId).title,
      '列表单次修改',
    );

    // Re-adding identical content starts a new active membership. Old deleted
    // exceptions remain history and cannot exclude dates from the new rule.
    const readdedBody = {
      title: '完全删除后重新添加',
      startAt: '2026-11-06T01:00:00Z',
      endAt: '2026-11-06T02:00:00Z',
      recurrence: { unit: 'week', interval: 1, count: 2 },
    };
    assert.equal((await http('/manual-courses', readdedBody)).status, 201);
    let [readded] = await pool.execute(
      "SELECT * FROM schedule_items WHERE title = '完全删除后重新添加' AND deleted_at IS NULL ORDER BY start_at",
    );
    for (const row of readded) {
      assert.equal(
        (await http(`/schedule-items/${row.public_id}`, { version: row.version }, 1, 'DELETE'))
          .status,
        200,
      );
    }
    assert.equal((await http('/manual-courses', readdedBody)).status, 201);
    [readded] = await pool.execute(
      "SELECT * FROM schedule_items WHERE title = '完全删除后重新添加' AND deleted_at IS NULL ORDER BY start_at",
    );
    const readdedSeries = await detail(readded[0].public_id);
    assert.equal(
      readdedSeries.occurrences.length,
      2,
      'new membership excludes tombstones from prior additions',
    );
    assert.ok(readdedSeries.occurrences.every((item) => !item.deleted && !item.exception));
    const rearranged = await mutation(readded[0].public_id, readdedSeries, {
      scope: 'following',
      recurrenceMode: 'replace',
      recurrence: readdedBody.recurrence,
      patch: { title: '重新添加后修改重复' },
    });
    assert.equal(rearranged.status, 200);
    assert.equal(
      rearranged.body.created,
      2,
      'prior deleted exceptions must not suppress an intentional new series',
    );

    // Shift an entire Tuesday series to Wednesday, then delete one occurrence
    // and personally move another to Friday. Replacing its Wednesday rule must
    // keep those exception slots reserved, including after a new child is saved.
    const crossDayBody = {
      title: '跨日系列',
      startAt: '2026-12-01T01:00:00Z',
      endAt: '2026-12-01T02:00:00Z',
      recurrence: { unit: 'week', interval: 1, count: 4 },
    };
    assert.equal((await http('/manual-courses', crossDayBody)).status, 201);
    const [crossDayRows] = await pool.execute(
      "SELECT * FROM schedule_items WHERE title = '跨日系列' AND deleted_at IS NULL ORDER BY start_at",
    );
    const crossIds = crossDayRows.map((row) => row.public_id);
    assert.equal(
      (
        await mutation(crossIds[0], await detail(crossIds[0]), {
          scope: 'following',
          recurrenceMode: 'keep',
          patch: {
            startAt: '2026-12-02T01:00:00Z',
            endAt: '2026-12-02T02:00:00Z',
          },
        })
      ).status,
      200,
    );
    const [[crossDeleted]] = await pool.execute(
      'SELECT version FROM schedule_items WHERE public_id = ?',
      [crossIds[1]],
    );
    assert.equal(
      (await http(`/schedule-items/${crossIds[1]}`, { version: crossDeleted.version }, 1, 'DELETE'))
        .status,
      200,
    );
    assert.equal(
      (
        await mutation(crossIds[2], await detail(crossIds[2]), {
          patch: {
            startAt: '2026-12-18T03:00:00Z',
            endAt: '2026-12-18T04:00:00Z',
            title: '个人保留的周五课程',
          },
        })
      ).status,
      200,
    );
    const crossReplacement = await mutation(crossIds[0], await detail(crossIds[0]), {
      scope: 'following',
      recurrenceMode: 'replace',
      recurrence: crossDayBody.recurrence,
      patch: { title: '跨日重排' },
    });
    assert.equal(crossReplacement.status, 200);
    assert.equal(crossReplacement.body.created, 2);
    let [crossActive] = await pool.execute(
      "SELECT * FROM schedule_items WHERE title = '跨日重排' AND deleted_at IS NULL ORDER BY start_at",
    );
    assert.deepEqual(
      crossActive.map((row) => row.start_at.toISOString()),
      ['2026-12-02T01:00:00.000Z', '2026-12-23T01:00:00.000Z'],
    );
    const crossAgain = await mutation(
      crossActive[0].public_id,
      await detail(crossActive[0].public_id),
      {
        scope: 'following',
        recurrenceMode: 'replace',
        recurrence: crossDayBody.recurrence,
        patch: {
          title: '再次跨日重排',
          startAt: '2026-12-03T01:00:00Z',
          endAt: '2026-12-03T02:00:00Z',
        },
      },
    );
    assert.equal(crossAgain.status, 200);
    assert.equal(crossAgain.body.created, 2);
    [crossActive] = await pool.execute(
      "SELECT * FROM schedule_items WHERE title = '再次跨日重排' AND deleted_at IS NULL ORDER BY start_at",
    );
    assert.deepEqual(
      crossActive.map((row) => row.start_at.toISOString()),
      ['2026-12-03T01:00:00.000Z', '2026-12-24T01:00:00.000Z'],
    );
    const [[crossPersonal]] = await pool.execute(
      'SELECT start_at, end_at, deleted_at FROM schedule_items WHERE public_id = ?',
      [crossIds[2]],
    );
    assert.equal(crossPersonal.start_at.toISOString(), '2026-12-18T03:00:00.000Z');
    assert.equal(crossPersonal.end_at.toISOString(), '2026-12-18T04:00:00.000Z');
    assert.equal(crossPersonal.deleted_at, null, 'personal moved time survives both replacements');
  },
);
