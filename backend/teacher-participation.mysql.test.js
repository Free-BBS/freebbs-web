const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const mysql = require('mysql2/promise');
const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
const { listenAllowedLoopback } = require('../scripts/fixtures/allowed-loopback');
const { ensureUserCertificationTables } = require('./user-certifications');
const { ensureLearningWorkspaceTables } = require('./learning-workspace');
const {
  ensureTeacherParticipationTables,
  createTeacherParticipationRouter,
} = require('./teacher-participation');

test(
  'isolated MySQL: teacher teaching associations preserve identity, private feedback and independent editing permissions',
  {
    skip: !process.env.FREEBBS_TEST_MYSQL_SOCKET
      ? 'requires an explicit disposable FREE BBS QA socket; application databases are never used'
      : false,
    timeout: 120000,
  },
  async (t) => {
    const options = isolatedMysqlConfig();
    const adminDb = await mysql.createConnection(options);
    await assertIsolatedMysql(adminDb);
    const database = `freebbs_teaching_test_${crypto.randomBytes(8).toString('hex')}`;
    assert.match(database, /^freebbs_teaching_test_[a-f0-9]{16}$/);
    await adminDb.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    const pool = mysql.createPool({ ...options, database, connectionLimit: 5 });
    let server;
    t.after(async () => {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
      await pool.end();
      await adminDb.query(`DROP DATABASE \`${database}\``);
      await adminDb.end();
    });

    await pool.query(`CREATE TABLE users (
      id BIGINT PRIMARY KEY,
      role ENUM('student','ta','teacher','admin','enterprise') DEFAULT 'student',
      full_name VARCHAR(64) NOT NULL,
      is_admin TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE courses (
      id BIGINT PRIMARY KEY, slug VARCHAR(120) NOT NULL UNIQUE,
      name VARCHAR(160) NOT NULL, code VARCHAR(64),
      sort_order INT NOT NULL DEFAULT 0, is_active TINYINT(1) NOT NULL DEFAULT 1
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE course_map_nodes (
      course_id BIGINT NOT NULL, node_id VARCHAR(120) NOT NULL,
      title VARCHAR(160) NOT NULL, PRIMARY KEY (course_id, node_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE course_material_managers (
      course_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
      PRIMARY KEY (course_id, user_id)
    ) ENGINE=InnoDB`);
    await ensureUserCertificationTables(pool);
    await ensureLearningWorkspaceTables(pool);
    // Historical course tables and learning entries need not share a collation.
    await pool.query(`ALTER TABLE learning_entries MODIFY node_id
      VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL`);
    const [nodeColumns] = await pool.execute(
      `SELECT TABLE_NAME, COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('course_map_nodes', 'learning_entries')
       AND COLUMN_NAME = 'node_id' ORDER BY TABLE_NAME`,
      [database],
    );
    assert.deepEqual(
      nodeColumns.map((column) => column.COLLATION_NAME),
      ['utf8mb4_unicode_ci', 'utf8mb4_general_ci'],
    );
    await ensureTeacherParticipationTables(pool);
    await ensureTeacherParticipationTables(pool);
    await pool.execute(
      `INSERT INTO users (id, role, full_name, is_admin) VALUES
       (1, 'admin', '隔离测试管理员', 1),
       (2, 'teacher', '管理员开通教师', 0),
       (3, 'student', '认证通过教师', 0),
       (4, 'student', '其他同学', 0),
       (5, 'admin', '可删除的审核员', 1)`,
    );
    await pool.execute(
      `INSERT INTO courses (id, slug, name, code, sort_order, is_active) VALUES
       (10, 'signals', '信号与系统', 'SS', 1, 1),
       (11, 'circuits', '电路', 'EC', 2, 1),
       (12, 'retired', '已停用课程', 'OLD', 3, 0)`,
    );
    await pool.execute(
      `INSERT INTO course_map_nodes (course_id, node_id, title) VALUES
       (10, 'SS-01-01', '卷积'), (11, 'EC-01-01', '电路基础')`,
    );
    await pool.execute(
      "INSERT INTO user_certifications (user_id, slot, institution, approved_by) VALUES (3, 'teacher', '测试学校', 1)",
    );

    const [foreignKeys] = await pool.execute(
      `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'course_teaching_memberships'
       AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY COLUMN_NAME`,
      [database],
    );
    assert.deepEqual(
      foreignKeys.map((key) => [key.COLUMN_NAME, key.REFERENCED_TABLE_NAME]),
      [
        ['assigned_by', 'users'],
        ['course_id', 'courses'],
        ['user_id', 'users'],
      ],
    );
    for (const values of [
      [999, 2, 1],
      [10, 999, 1],
      [10, 2, 999],
    ])
      await assert.rejects(
        pool.execute(
          'INSERT INTO course_teaching_memberships (course_id, user_id, assigned_by) VALUES (?, ?, ?)',
          values,
        ),
        { code: 'ER_NO_REFERENCED_ROW_2' },
      );

    async function requireAuth(req, res) {
      const id = Number(req.headers.authorization?.replace('Bearer ', '')) || 0;
      const [[user]] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
      if (!user) {
        res.status(401).json({ message: 'login required' });
        return null;
      }
      return user;
    }
    async function requireAdmin(req, res) {
      const user = await requireAuth(req, res);
      if (user && !user.is_admin) {
        res.status(403).json({ message: 'admin required' });
        return null;
      }
      return user;
    }
    const app = express();
    app.use(express.json());
    app.use('/api', createTeacherParticipationRouter({ pool, requireAuth, requireAdmin }));
    server = http.createServer(app);
    await listenAllowedLoopback(server);
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(url, actor, method = 'GET', body = undefined) {
      const response = await fetch(`${base}${url}`, {
        method,
        headers: {
          ...(actor ? { Authorization: `Bearer ${actor}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() };
    }
    const assign = (userId, courseSlugs) =>
      call(`/admin/users/${userId}/teaching-courses`, 1, 'PUT', {
        courseSlugs,
        identityConfirmed: true,
      });
    assert.equal((await call('/teacher/workspace', null)).status, 401);
    assert.equal((await call('/admin/users/2/teaching-courses', 2)).status, 403);
    assert.equal((await call('/teacher/workspace', 4)).data.eligible, false);
    assert.equal((await assign(2, ['signals'])).status, 200);
    const initialResponse = await call('/teacher/workspace', 2);
    assert.equal(initialResponse.status, 200, JSON.stringify(initialResponse.data));
    const initial = initialResponse.data;
    assert.equal(initial.eligible, true);
    assert.deepEqual(initial.courses, [
      { slug: 'signals', name: '信号与系统', code: 'SS', canEditMaterials: false },
    ]);
    assert.deepEqual((await call('/admin/users/2/teaching-courses', 1)).data.courseSlugs, [
      'signals',
    ]);
    assert.equal((await assign(2, ['signals', 'retired'])).status, 400);
    assert.deepEqual((await call('/admin/users/2/teaching-courses', 1)).data.courseSlugs, [
      'signals',
    ]);

    async function entry(userId, kind, content, status = 'private') {
      await pool.execute(
        `INSERT INTO learning_entries
         (user_id, course_id, node_id, kind, title, content, category, excerpt,
          status, document_version, request_key)
         VALUES (?, 10, 'SS-01-01', ?, '隔离测试记录', ?, ?, '', ?, ?, ?)`,
        [
          userId,
          kind,
          content,
          kind === 'contribution' ? 'improvement' : '',
          status,
          'a'.repeat(64),
          crypto.randomUUID(),
        ],
      );
    }
    await entry(2, 'contribution', 'OWN_EXPLICIT_OPINION', 'pending');
    await entry(2, 'note', 'OWN_PRIVATE_NOTE');
    await entry(2, 'reflection', 'OWN_PRIVATE_REFLECTION');
    await entry(4, 'contribution', 'OTHER_PERSON_OPINION', 'pending');
    const { feedback } = (await call('/teacher/workspace', 2)).data;
    assert.equal(feedback.length, 1);
    assert.equal(feedback[0].content, 'OWN_EXPLICIT_OPINION');
    assert.equal(feedback[0].pointTitle, '卷积');
    assert.equal(feedback[0].status, 'pending');
    assert.doesNotMatch(JSON.stringify(feedback), /PRIVATE|OTHER_PERSON/);
    // Current published knowledge IDs use ascii_bin; the same join must support it.
    await pool.query(`ALTER TABLE course_map_nodes MODIFY node_id
      VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`);
    const productionLayout = await call('/teacher/workspace', 2);
    assert.equal(productionLayout.status, 200, JSON.stringify(productionLayout.data));
    assert.equal(productionLayout.data.feedback[0].pointTitle, '卷积');
    const [[managers]] = await pool.execute(
      'SELECT COUNT(*) AS count FROM course_material_managers',
    );
    assert.equal(Number(managers.count), 0);

    assert.equal((await assign(3, ['circuits'])).status, 200);
    assert.equal((await call('/teacher/workspace', 3)).data.eligible, true);
    const [[stillStudent]] = await pool.execute('SELECT role FROM users WHERE id = 3');
    assert.equal(stillStudent.role, 'student');
    await pool.execute("UPDATE users SET role = 'student' WHERE id = 2");
    const revoked = (await call('/teacher/workspace', 2)).data;
    assert.equal(revoked.eligible, false);
    assert.deepEqual(revoked.courses, []);
    assert.deepEqual(revoked.feedback, []);
    assert.equal((await assign(2, ['circuits'])).status, 409);
    assert.equal((await assign(2, [])).status, 200);
    await pool.execute("DELETE FROM user_certifications WHERE user_id = 3 AND slot = 'teacher'");
    assert.equal((await call('/teacher/workspace', 3)).data.eligible, false);
    assert.equal((await assign(3, [])).status, 200);

    await pool.execute("UPDATE users SET role = 'teacher' WHERE id = 2");
    assert.equal((await assign(2, ['signals'])).status, 200);
    await ensureTeacherParticipationTables(pool);
    assert.equal((await call('/teacher/workspace', 2)).data.courses.length, 1);
    await pool.execute(
      'INSERT INTO course_teaching_memberships (course_id, user_id, assigned_by) VALUES (11, 3, 5)',
    );
    await pool.execute('DELETE FROM users WHERE id = 5');
    const [[kept]] = await pool.execute(
      'SELECT assigned_by FROM course_teaching_memberships WHERE course_id = 11 AND user_id = 3',
    );
    assert.equal(kept.assigned_by, null);
    await pool.execute('DELETE FROM users WHERE id = 3');
    const [[removedUser]] = await pool.execute(
      'SELECT COUNT(*) AS count FROM course_teaching_memberships WHERE user_id = 3',
    );
    assert.equal(Number(removedUser.count), 0);
    await pool.execute('DELETE FROM courses WHERE id = 10');
    const [[removedCourse]] = await pool.execute(
      'SELECT COUNT(*) AS count FROM course_teaching_memberships WHERE course_id = 10',
    );
    assert.equal(Number(removedCourse.count), 0);
  },
);
