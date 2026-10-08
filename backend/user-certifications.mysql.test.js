const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const test = require('node:test');
const express = require('express');
const mysql = require('mysql2/promise');
const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
const { ensureNotificationTables, createNotificationService } = require('./notifications');
const {
  normalizeAdminAccount,
  ensureTeacherAccountTables,
  createAccountIdentityService,
} = require('./teacher-accounts');
const {
  isValidUsername,
  changeUsername,
  ensureUsernameChangeTables,
} = require('./username-policy');
const { hashPassword, verifyPassword, verifyPasswordAsync } = require('./password');
const {
  ensureWalletLedger,
  walletLedgerCheckpoint,
  annotateWalletLedger,
} = require('./wallet-ledger');
const {
  normalizeCertification,
  approveEnterpriseCertification,
  syncEnterpriseCertification,
  readApprovedCertifications,
  ensureUserCertificationTables,
  createUserCertificationService,
  createUserCertificationRouter,
} = require('./user-certifications');

test(
  'isolated MySQL: verified identities, notices, privacy, concurrent review and enterprise provisioning',
  { skip: !process.env.FREEBBS_TEST_MYSQL_SOCKET, timeout: 120000 },
  async (t) => {
    const options = isolatedMysqlConfig();
    const adminDb = await mysql.createConnection(options);
    await assertIsolatedMysql(adminDb);
    const database = `freebbs_cert_test_${crypto.randomBytes(8).toString('hex')}`;
    assert.match(database, /^freebbs_cert_test_[a-f0-9]{16}$/);
    await adminDb.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    const pool = mysql.createPool({ ...options, database, connectionLimit: 8 });
    t.after(async () => {
      await pool.end();
      await adminDb.query(`DROP DATABASE \`${database}\``);
      await adminDb.end();
    });
    await pool.query(`CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, uid VARCHAR(32) UNIQUE, username VARCHAR(64) NOT NULL UNIQUE,
    full_name VARCHAR(64) NOT NULL, student_id VARCHAR(10) NULL UNIQUE, email VARCHAR(128) UNIQUE,
    password_hash VARCHAR(255) NOT NULL, email_verified_at DATETIME(3), role ENUM('student','ta','teacher','admin') DEFAULT 'student',
    is_admin TINYINT(1) DEFAULT 0, electrons BIGINT DEFAULT 0, manetrons BIGINT DEFAULT 0, heat BIGINT DEFAULT 0,
    grade VARCHAR(16), major VARCHAR(64), avatar_path VARCHAR(255), bio TEXT, website_url VARCHAR(255), created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
    await ensureUserCertificationTables(pool);
    await ensureUserCertificationTables(pool);
    await ensureTeacherAccountTables(pool);
    await ensureNotificationTables(pool);
    await ensureUsernameChangeTables(pool);
    await pool.query(
      'CREATE TABLE user_golden_names (user_id BIGINT PRIMARY KEY, expires_at_ms BIGINT DEFAULT 0)',
    );
    const adminPassword = 'isolated-only-proof';
    const hash = hashPassword(adminPassword);
    await pool.execute(
      `INSERT INTO users (id,uid,username,full_name,student_id,password_hash,role,is_admin) VALUES
    (1,'u_admin1','管理员一','管理员一',NULL,?,'admin',1),
    (2,'u_admin2','管理员二','管理员二',NULL,?,'teacher',1),
    (3,'u_student','中文用户','中文用户','2024010001',?,'student',0),
    (4,'u_teacher','测试老师','测试老师',NULL,?,'teacher',0),
    (5,'u_other','其他用户','其他用户','2024210001',?,'student',0)`,
      [hash, hash, hash, hash, hash],
    );
    await ensureWalletLedger(pool);
    await pool.query(
      'CREATE TABLE test_admin_responsibilities (user_id BIGINT PRIMARY KEY, value VARCHAR(64)) ENGINE=InnoDB',
    );
    for (const sql of [
      'CREATE TABLE discussion_boards (id BIGINT PRIMARY KEY, slug VARCHAR(64)) ENGINE=InnoDB',
      'CREATE TABLE discussion_board_moderators (user_id BIGINT, board_id BIGINT) ENGINE=InnoDB',
      'CREATE TABLE courses (id BIGINT PRIMARY KEY, slug VARCHAR(64)) ENGINE=InnoDB',
      'CREATE TABLE course_material_managers (user_id BIGINT, course_id BIGINT) ENGINE=InnoDB',
      "INSERT INTO discussion_boards VALUES (1, 'test-board')",
      'INSERT INTO discussion_board_moderators VALUES (5, 1)',
      "INSERT INTO courses VALUES (1, 'test-course')",
      'INSERT INTO course_material_managers VALUES (5, 1)',
    ])
      await pool.query(sql);
    const notifications = createNotificationService({
      pool,
      sendEmail: async () => {
        throw new Error('must never send real email');
      },
    });
    const service = createUserCertificationService({ pool, notifications });
    const codes = [];
    const identityService = createAccountIdentityService({
      pool,
      sendCode: async (_email, code) => {
        codes.push(code);
      },
    });
    const getUserById = async (id) =>
      (await pool.execute('SELECT * FROM users WHERE id = ?', [id]))[0][0];
    const requireAuth = async (req, res) => {
      const user = await getUserById(
        Number(req.headers.authorization?.replace('Bearer ', '')) || 0,
      );
      if (!user) {
        res.status(401).json({ message: 'login required' });
        return null;
      }
      return user;
    };
    const requireAdmin = async (req, res) => {
      const user = await requireAuth(req, res);
      if (!user) return null;
      if (!user.is_admin) {
        res.status(403).json({ message: 'admin required' });
        return null;
      }
      return user;
    };
    const app = express();
    app.use(express.json());
    app.use('/api', createUserCertificationRouter({ service, requireAuth, requireAdmin }));
    const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const start = source.indexOf("app.post('/api/admin/users',");
    const end = source.indexOf("app.patch('/api/admin/users/:id',", start);
    assert.ok(start >= 0 && end > start);
    const failures = { ledger: false, responsibilities: false };
    const routeContext = vm.createContext({
      app,
      pool,
      crypto,
      requireAdmin,
      normalizeAdminAccount,
      normalizeCertification,
      approveEnterpriseCertification,
      syncEnterpriseCertification,
      readApprovedCertifications,
      hashPassword,
      getUserById,
      toUserProfile: (user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
        studentId: user.student_id,
        email: user.email,
        isAdmin: Boolean(user.is_admin),
      }),
      createUniqueUserUid: async () => `u_${crypto.randomBytes(8).toString('hex')}`,
      annotateWalletLedger: async (...args) => {
        if (failures.ledger) throw new Error('injected ledger failure');
        return annotateWalletLedger(...args);
      },
      walletLedgerCheckpoint,
      USER_ROLES: new Set(['student', 'ta', 'teacher', 'admin', 'enterprise']),
      getPermissionCatalog: async () => ({ boards: [], courses: [] }),
      normalizeResponsibilitySlugs: (values = []) => values,
      ensureDiscussionTables: async () => {},
      ensureCourseMapTables: async () => {},
      replaceUserResponsibilities: async (connection, id, boards) => {
        await connection.execute(
          'INSERT INTO test_admin_responsibilities (user_id, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
          [id, boards.join(',')],
        );
        if (failures.responsibilities) throw new Error('injected responsibilities failure');
      },
      withDatabaseTransaction: async (work) => {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const result = await work(conn);
          await conn.commit();
          return result;
        } catch (error) {
          await conn.rollback();
          throw error;
        } finally {
          conn.release();
        }
      },
    });
    const lockStart = source.indexOf('class AdminUserUpdateError extends Error');
    const lockEnd = source.indexOf('function sanitizeWebsiteUrl(', lockStart);
    const patchEnd = source.indexOf("app.delete('/api/admin/users/:id',", end);
    assert.ok(lockStart >= 0 && lockEnd > lockStart && patchEnd > end);
    vm.runInContext(source.slice(lockStart, lockEnd), routeContext);
    vm.runInContext(source.slice(start, patchEnd), routeContext);
    const mapStart = source.indexOf('async function addUserResponsibilities(');
    const mapEnd = source.indexOf('function normalizeResponsibilitySlugs(', mapStart);
    const listStart = source.indexOf("app.get('/api/admin/users',");
    const listEnd = source.indexOf("app.get('/api/admin/ai-dialogs/export',", listStart);
    assert.ok(mapStart >= 0 && mapEnd > mapStart && listStart >= 0 && listEnd > listStart);
    vm.runInContext(source.slice(mapStart, mapEnd), routeContext);
    vm.runInContext(source.slice(listStart, listEnd), routeContext);
    const loginStart = source.indexOf("app.post('/api/auth/login',");
    const loginEnd = source.indexOf("app.post('/api/auth/reset-password',", loginStart);
    assert.ok(loginStart >= 0 && loginEnd > loginStart);
    vm.runInNewContext(source.slice(loginStart, loginEnd), {
      app,
      pool,
      verifyPasswordAsync,
      loginRateLimiter: {
        consumeIp: async () => ({ allowed: true }),
        consumeAccount: async () => ({ allowed: true }),
        resetAccount: async () => {},
      },
      toUserProfile: (user) => ({ id: user.id, username: user.username }),
      issueToken: (user) => `qa:${user.id}`,
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(
      () =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    );
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (route, id, method, body) => {
      const response = await fetch(base + route, {
        method: method || 'GET',
        headers: {
          ...(id ? { Authorization: `Bearer ${id}` } : {}),
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json(), headers: response.headers };
    };
    const apply = (id, education, year = 2024, extra = {}) =>
      request('/me/certifications', id, 'POST', { type: 'education', education, year, ...extra });
    const approve = (id, admin = 1, extra = {}) =>
      request(`/admin/certifications/${id}/review`, admin, 'POST', {
        action: 'approve',
        identityConfirmed: true,
        ...extra,
      });

    await t.test(
      'legacy Chinese accounts still log in and recover through verified email',
      async () => {
        assert.equal(
          (
            await request('/auth/login', null, 'POST', {
              identifier: ' 中文用户 ',
              password: adminPassword,
            })
          ).status,
          200,
        );
        const email = 'cert-qa-student@example.invalid';
        await identityService.sendBindingCode(3, { email, currentPassword: adminPassword });
        await identityService.bindEmail(3, {
          email,
          currentPassword: adminPassword,
          emailCode: codes.at(-1),
        });
        await identityService.sendResetCode({ identifier: '中文用户', email });
        await assert.rejects(
          identityService.resetPassword({
            identifier: '中文🙂',
            email,
            emailCode: codes.at(-1),
            password: 'updated-qa-only',
          }),
          { code: 'invalid_username' },
        );
        assert.equal(
          await identityService.resetPassword({
            identifier: '中文用户',
            email,
            emailCode: codes.at(-1),
            password: 'updated-qa-only',
          }),
          3,
        );
        assert.equal(
          (
            await request('/auth/login', null, 'POST', {
              identifier: '中文用户',
              password: 'updated-qa-only',
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request('/auth/login', null, 'POST', {
              identifier: '中文用户',
              password: adminPassword,
            })
          ).status,
          401,
        );
      },
    );

    await t.test('HTTP guards, server-owned identity and bound-number suggestions', async () => {
      assert.equal((await request('/me/certifications')).status, 401);
      assert.equal((await request('/admin/certifications', 3)).status, 403);
      assert.equal(
        (await request('/admin/certifications', 3, 'GET')).headers.get('cache-control'),
        'no-store',
      );
      assert.equal(
        (await request('/me/certifications', 3)).data.suggestion.education,
        'undergraduate',
      );
      assert.equal((await request('/me/certifications', 5)).data.suggestion.education, 'master');
      const applied = await apply(3, 'undergraduate', 2021, {
        institution: '另一学校电子学院',
        className: '电11',
        userId: 5,
        isAdmin: true,
        status: 'approved',
      });
      assert.equal(applied.status, 201);
      assert.equal(applied.data.request.status, 'pending');
      const pending = await request('/me/certifications', 3);
      assert.equal(pending.data.approved.length, 0);
      assert.equal(pending.data.requests[0].id, applied.data.request.id);
      assert.equal((await request('/me/certifications', 5)).data.requests.length, 0);
      const [notices] = await pool.execute(
        'SELECT recipient_id, kind, link FROM community_notifications WHERE event_key = ?',
        [`certification-request:${applied.data.request.id}`],
      );
      assert.deepEqual(notices.map((n) => Number(n.recipient_id)).sort(), [1, 2]);
      assert.ok(
        notices.every((n) => n.kind === 'certification' && n.link === '/adminusers#certifications'),
      );
      assert.equal((await approve(applied.data.request.id, 3)).status, 403);
      assert.equal(
        (await approve(applied.data.request.id, 1, { identityConfirmed: false })).status,
        400,
      );
      assert.equal((await approve(applied.data.request.id)).status, 200);
      const [[result]] = await pool.execute(
        'SELECT recipient_id FROM community_notifications WHERE event_key = ?',
        [`certification-result:${applied.data.request.id}`],
      );
      assert.equal(Number(result.recipient_id), 3);
      const [[outbox]] = await pool.execute(
        'SELECT COUNT(*) AS count FROM notification_email_outbox',
      );
      assert.equal(Number(outbox.count), 0);
      const own = await apply(1, 'doctor');
      assert.equal((await approve(own.data.request.id)).status, 403);
      await assert.rejects(
        service.review(3, own.data.request.id, { action: 'approve', identityConfirmed: true }),
        { code: 'admin_required' },
      );
    });

    await t.test(
      'three education stages coexist and replacement approval preserves previous published details',
      async () => {
        for (const stage of ['master', 'doctor']) {
          const r = await apply(3, stage);
          assert.equal((await approve(r.data.request.id)).status, 200);
        }
        assert.equal((await request('/me/certifications', 3)).data.approved.length, 3);
        const update = await apply(3, 'undergraduate', 2022, {
          institution: '更新学校',
          className: '新班',
        });
        assert.equal(update.status, 201);
        assert.equal((await apply(3, 'undergraduate')).status, 409);
        assert.equal(
          (await request('/me/certifications', 3)).data.approved.find(
            (c) => c.education === 'undergraduate',
          ).year,
          2021,
        );
        const listed = (await request('/admin/certifications', 1)).data.requests.find(
          (r) => r.id === update.data.request.id,
        );
        assert.equal(listed.currentApproved.year, 2021);
        assert.equal(
          (
            await request(`/admin/certifications/${update.data.request.id}/review`, 1, 'POST', {
              action: 'reject',
              reviewNote: '请补证据',
            })
          ).status,
          200,
        );
        assert.equal(
          (await request('/me/certifications', 3)).data.approved.find(
            (c) => c.education === 'undergraduate',
          ).year,
          2021,
        );
        const renewed = await apply(3, 'undergraduate', 2023);
        assert.equal((await approve(renewed.data.request.id)).status, 200);
        const publicRows = await service.decorate([{ user_id: 3 }]);
        assert.equal(publicRows[0].certifications.length, 3);
        assert.equal(
          publicRows[0].certifications.find((c) => c.education === 'undergraduate').year,
          2023,
        );
        const [[count]] = await pool.execute(
          'SELECT COUNT(*) AS count FROM user_certifications WHERE user_id = 3',
        );
        assert.equal(Number(count.count), 3);
      },
    );

    await t.test(
      'concurrent requests and reviews produce one transition and one result notice',
      async () => {
        const replies = await Promise.all([apply(5, 'doctor'), apply(5, 'doctor')]);
        assert.deepEqual(replies.map((r) => r.status).sort(), [201, 409]);
        const id = replies.find((r) => r.status === 201).data.request.id;
        const reviews = await Promise.all([approve(id, 1), approve(id, 2)]);
        assert.deepEqual(reviews.map((r) => r.status).sort(), [200, 409]);
        const [[count]] = await pool.execute(
          'SELECT COUNT(*) AS count FROM community_notifications WHERE event_key = ?',
          [`certification-result:${id}`],
        );
        assert.equal(Number(count.count), 1);
        assert.equal((await approve(id)).status, 409);
        // The generated key independently enforces one active pending request per user and slot.
        await pool.execute(
          "INSERT INTO user_certification_requests(user_id,slot,year,institution) VALUES (5,'master',2024,'测试学校')",
        );
        await assert.rejects(
          pool.execute(
            "INSERT INTO user_certification_requests(user_id,slot,year,institution) VALUES (5,'master',2025,'测试学校')",
          ),
          { code: 'ER_DUP_ENTRY' },
        );
      },
    );

    await t.test(
      'teacher approval is a badge without privilege changes; anonymous and deleted rows stay private',
      async () => {
        const r = await request('/me/certifications', 5, 'POST', {
          type: 'teacher',
          institution: '其他大学电子院',
          fullName: '冒充的教师姓名',
          verifiedName: '冒充的教师姓名',
        });
        assert.equal(r.status, 201);
        const [pendingAuthor] = await service.decorate([{ user_id: 5 }]);
        assert.equal(
          pendingAuthor.identityBadges.some((badge) => badge.type === 'teacher'),
          false,
        );
        assert.equal((await approve(r.data.request.id)).status, 200);
        const teacher = await service.decorate([
          { user_id: 5 },
          { user_id: 4 },
          { user_id: 5, is_anonymous: 1 },
          { user_id: 4, is_deleted: 1 },
        ]);
        assert.equal(teacher[0].author_role, 'student');
        assert.equal(teacher[0].identityBadges[0].label, '其他用户 · 教师');
        const teacherCertificate = teacher[0].certifications.find((c) => c.type === 'teacher');
        assert.equal(teacherCertificate.verifiedName, '其他用户');
        assert.equal(teacherCertificate.institution, '其他大学电子院');
        assert.equal(teacher[1].identityBadges[0].label, '测试老师 · 教师');
        assert.equal(JSON.stringify(teacher).includes('冒充的教师姓名'), false);
        for (const row of teacher.slice(2)) {
          assert.deepEqual(row.certifications, []);
          assert.deepEqual(row.identityBadges, []);
          assert.equal(row.author_role, '');
        }
        assert.equal((await getUserById(5)).role, 'student');
        assert.equal(Number((await getUserById(5)).is_admin), 0);
        const corrected = await request('/admin/users/5', 1, 'PATCH', {
          fullName: '核实后的中文姓名',
          role: 'student',
        });
        assert.equal(corrected.status, 200);
        const [updatedAuthor] = await service.decorate([{ user_id: 5 }]);
        assert.equal(updatedAuthor.identityBadges[0].label, '核实后的中文姓名 · 教师');
        assert.equal((await request('/me/certifications', 5)).data.fullName, '核实后的中文姓名');
        await pool.execute("UPDATE users SET full_name = '其他用户' WHERE id = 5");
        const [studentAuthor] = await service.decorate([{ user_id: 3 }]);
        assert.equal(
          studentAuthor.identityBadges.some((badge) => badge.label.includes('中文用户')),
          false,
        );
        assert.ok(studentAuthor.certifications.every((c) => !c.verifiedName));
      },
    );

    await t.test(
      'notification failure rolls back submissions and approvals atomically',
      async () => {
        const failing = createUserCertificationService({
          pool,
          notifications: {
            notifyCertification: async () => {
              throw new Error('injected inbox failure');
            },
          },
        });
        await assert.rejects(
          failing.submit(4, { type: 'company', companyName: '测试企业' }),
          /injected/,
        );
        assert.equal((await service.read(4)).requests.length, 0);
        const r = await service.submit(4, { type: 'company', companyName: '测试企业' });
        await assert.rejects(
          failing.review(1, r.id, { action: 'approve', identityConfirmed: true }),
          /injected/,
        );
        assert.equal((await service.read(4)).approved.length, 0);
        assert.equal((await service.read(4)).requests[0].status, 'pending');
        assert.equal((await approve(r.id)).status, 200);
      },
    );

    await t.test(
      'admin creation requires ASCII nicknames while retaining Chinese names and company certificates',
      async () => {
        const body = {
          username: 'enterprise_test',
          fullName: '企业联系名',
          companyName: '测试有限公司',
          role: 'enterprise',
          password: 'temporary-test-only',
        };
        assert.equal((await request('/admin/users', 3, 'POST', body)).status, 403);
        assert.equal(
          (await request('/admin/users', 1, 'POST', { ...body, username: '中文企业' })).status,
          400,
        );
        const made = await request('/admin/users', 1, 'POST', body);
        assert.equal(made.status, 201);
        const user = await getUserById(made.data.user.id);
        assert.equal(user.student_id, null);
        assert.equal(user.email, null);
        assert.equal(Number(user.is_admin), 0);
        assert.equal(user.role, 'enterprise');
        assert.equal(verifyPassword(body.password, user.password_hash), true);
        assert.equal(JSON.stringify(made.data).includes(body.password), false);
        const approved = (await service.read(user.id)).approved;
        assert.equal(approved[0].label, body.companyName);
        assert.equal(approved[0].type, 'company');
        await assert.rejects(
          identityService.adminResetPassword(1, user.id, {
            password: 'new-enterprise-qa-only',
            currentPassword: 'wrong-proof',
          }),
          { code: 'current_password_wrong' },
        );
        await identityService.adminResetPassword(1, user.id, {
          password: 'new-enterprise-qa-only',
          currentPassword: adminPassword,
        });
        assert.equal(
          verifyPassword('new-enterprise-qa-only', (await getUserById(user.id)).password_hash),
          true,
        );
        failures.ledger = true;
        const failed = await request('/admin/users', 1, 'POST', {
          ...body,
          username: 'enterprise_rollback',
          electrons: 1,
        });
        assert.equal(failed.status, 500);
        failures.ledger = false;
        const [[count]] = await pool.execute(
          "SELECT COUNT(*) AS count FROM users WHERE username = 'enterprise_rollback'",
        );
        assert.equal(Number(count.count), 0);
        assert.equal(
          (
            await request('/admin/users', 1, 'POST', {
              ...body,
              username: 'enterprise_invalid',
              companyName: 'a',
            })
          ).status,
          400,
        );
        const selfCompany = await request('/me/certifications', 5, 'POST', {
          type: 'company',
          companyName: '自行申请企业',
        });
        assert.equal((await approve(selfCompany.data.request.id)).status, 200);
        assert.equal((await getUserById(5)).role, 'student');
      },
    );

    await t.test(
      'admin directory returns approved company names with responsibilities in one batch',
      async () => {
        assert.equal((await request('/admin/users', 3)).status, 403);
        const directory = await request('/admin/users', 1);
        assert.equal(directory.status, 200);
        const user = directory.data.users.find((item) => item.id === 5);
        assert.deepEqual(user.boardModeratorSlugs, ['test-board']);
        assert.deepEqual(user.courseManagerSlugs, ['test-course']);
        assert.equal(
          user.certifications.find((c) => c.type === 'company').companyName,
          '自行申请企业',
        );
        assert.equal(JSON.stringify(directory.data).includes(hash), false);
        let queries = 0;
        const [rows] = await pool.execute('SELECT * FROM users');
        await routeContext.addUserResponsibilities(rows, {
          execute: (...args) => {
            queries += 1;
            return pool.execute(...args);
          },
        });
        assert.equal(queries, 3);
        await routeContext.addUserResponsibilities([], {
          execute: () => {
            throw new Error('empty directory must not query');
          },
        });
      },
    );

    for (const roleOnly of [false, true]) {
      const routeName = roleOnly ? 'role PATCH' : 'full-user PATCH';
      await t.test(
        `${routeName} keeps enterprise upgrades, renames and downgrades atomic`,
        async () => {
          const created = await request('/admin/users', 1, 'POST', {
            username: roleOnly ? 'role_api_user' : 'full_api_user',
            fullName: '个人姓名不可作为公司名',
            role: 'teacher',
            password: 'isolated-enterprise-only',
          });
          assert.equal(created.status, 201);
          const id = created.data.user.id;
          const url = `/admin/users/${id}${roleOnly ? '/role' : ''}`;
          const update = (body, actor = 1) =>
            request(url, actor, 'PATCH', {
              fullName: '个人姓名不可作为公司名',
              role: 'student',
              ...body,
            });
          const state = async () => {
            const [[user]] = await pool.execute(
              'SELECT full_name, role, is_admin, electrons, manetrons, heat FROM users WHERE id = ?',
              [id],
            );
            const [certificates] = await pool.execute(
              'SELECT * FROM user_certifications WHERE user_id = ? ORDER BY slot',
              [id],
            );
            const [requests] = await pool.execute(
              'SELECT * FROM user_certification_requests WHERE user_id = ? ORDER BY id',
              [id],
            );
            const [ledger] = await pool.execute('SELECT * FROM wallet_ledger WHERE user_id = ?', [
              id,
            ]);
            const [responsibilities] = await pool.execute(
              'SELECT * FROM test_admin_responsibilities WHERE user_id = ?',
              [id],
            );
            return { user, certificates, requests, ledger, responsibilities };
          };
          const [education, teacher] = await Promise.all([
            apply(id, 'undergraduate', 2021, { institution: '测试大学电子院', className: '电11' }),
            request('/me/certifications', id, 'POST', {
              type: 'teacher',
              institution: '其他大学',
            }),
          ]);
          assert.equal((await approve(education.data.request.id)).status, 200);
          assert.equal((await approve(teacher.data.request.id)).status, 200);
          const before = await state();
          assert.equal((await update({ role: 'enterprise' })).status, 400);
          for (const companyName of ['', null, 'a', '名'.repeat(129)]) {
            assert.equal((await update({ role: 'enterprise', companyName })).status, 400);
          }
          assert.equal(
            (await update({ role: 'enterprise', companyName: '未授权企业' }, id)).status,
            403,
          );
          assert.deepEqual(await state(), before);
          const pending = await request('/me/certifications', id, 'POST', {
            type: 'company',
            companyName: '旧待审企业',
          });
          const upgraded = await update({ role: 'enterprise', companyName: '管理员确认企业' });
          assert.equal(upgraded.status, 200);
          assert.equal(upgraded.data.user.role, 'enterprise');
          assert.equal(
            upgraded.data.user.certifications.find((c) => c.type === 'company').companyName,
            '管理员确认企业',
          );
          assert.equal((await approve(pending.data.request.id)).status, 409);
          const saved = await state();
          const company = saved.certificates.find((c) => c.slot === 'company');
          assert.equal(company.company_name, '管理员确认企业');
          assert.equal(Number(company.approved_by), 1);
          assert.equal(company.source_request_id, null);
          assert.equal(saved.requests.at(-1).status, 'rejected');
          assert.match(saved.requests.at(-1).review_note, /管理员/);
          assert.deepEqual(
            saved.certificates.filter((c) => c.slot !== 'company'),
            before.certificates,
          );
          assert.equal((await update({ role: 'enterprise' })).status, 200);
          assert.deepEqual((await state()).certificates, saved.certificates);
          const renamed = await update({ role: 'enterprise', companyName: '更新后的企业' }, 2);
          assert.equal(renamed.status, 200);
          assert.equal(
            renamed.data.user.certifications.find((c) => c.type === 'company').label,
            '更新后的企业',
          );
          assert.equal(
            Number((await state()).certificates.find((c) => c.slot === 'company').approved_by),
            2,
          );
          const stale = await request('/me/certifications', id, 'POST', {
            type: 'company',
            companyName: '降级前待审企业',
          });
          assert.equal(stale.status, 201);

          // Fail after certification changes: both the company and user mutations must roll back.
          const trigger = `test_enterprise_sync_fail_${id}`;
          assert.ok(Number.isSafeInteger(Number(id)));
          await pool.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON users FOR EACH ROW
          BEGIN IF OLD.id = ${Number(id)} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected role failure'; END IF; END`);
          const beforeFailure = await state();
          try {
            assert.equal(
              (await update({ role: 'enterprise', companyName: '回滚更名' })).status,
              500,
            );
            assert.deepEqual(await state(), beforeFailure);
            assert.equal((await update({ role: 'teacher' })).status, 500);
            assert.deepEqual(await state(), beforeFailure);
          } finally {
            await pool.query(`DROP TRIGGER ${trigger}`);
          }
          if (!roleOnly) {
            failures.ledger = true;
            try {
              assert.equal(
                (await update({ role: 'enterprise', companyName: '回滚余额更名', electrons: 10 }))
                  .status,
                500,
              );
              assert.deepEqual(await state(), beforeFailure);
            } finally {
              failures.ledger = false;
            }
            failures.responsibilities = true;
            try {
              assert.equal(
                (await update({ role: 'student', electrons: 10, boardModeratorSlugs: ['test'] }))
                  .status,
                500,
              );
              assert.deepEqual(await state(), beforeFailure);
            } finally {
              failures.responsibilities = false;
            }
          }
          // Approval and demotion share the production user locks. Either winner must end without a company badge.
          const [demotion, review] = await Promise.all([
            update({ role: 'teacher' }),
            approve(stale.data.request.id),
          ]);
          assert.equal(demotion.status, 200);
          assert.ok([200, 409].includes(review.status), JSON.stringify(review));
          const downgraded = await state();
          assert.equal(downgraded.user.role, 'teacher');
          assert.equal(
            downgraded.certificates.some((c) => c.slot === 'company'),
            false,
          );
          assert.deepEqual(downgraded.certificates, before.certificates);
          assert.notEqual(downgraded.requests.at(-1).status, 'pending');
          const [publicRow] = await service.decorate([{ user_id: id }]);
          assert.equal(
            publicRow.identityBadges.some((badge) => badge.type === 'company'),
            false,
          );
          assert.equal(publicRow.certifications.length, 2);
          assert.equal((await approve(stale.data.request.id)).status, 409);

          // A separately approved company belongs to the certification system even if the role is not enterprise.
          const independent = await request('/me/certifications', id, 'POST', {
            type: 'company',
            companyName: '独立申请企业',
          });
          assert.equal((await approve(independent.data.request.id)).status, 200);
          assert.equal((await update({ role: 'student' })).status, 200);
          assert.equal(
            (await state()).certificates.find((c) => c.slot === 'company').source_request_id,
            independent.data.request.id,
          );
          const reused = await update({ role: 'enterprise' });
          assert.equal(reused.status, 200);
          assert.equal(
            reused.data.user.certifications.find((c) => c.type === 'company').label,
            '独立申请企业',
          );
          assert.equal(
            (await state()).certificates.find((c) => c.slot === 'company').source_request_id,
            null,
          );
          assert.equal((await update({ role: 'student' })).status, 200);
          assert.deepEqual((await state()).certificates, before.certificates);
        },
      );
    }

    await t.test(
      'enterprise role editing cannot bypass self-review or last-admin protections',
      async () => {
        for (const suffix of ['', '/role']) {
          const result = await request(`/admin/users/1${suffix}`, 1, 'PATCH', {
            fullName: '管理员一',
            role: 'enterprise',
            isAdmin: true,
            companyName: '自审企业',
          });
          assert.equal(result.status, 403);
          assert.equal((await getUserById(1)).role, 'admin');
          assert.equal(
            (await service.read(1)).approved.some((c) => c.type === 'company'),
            false,
          );
        }
        await pool.execute('UPDATE users SET is_admin = 0 WHERE id = 2');
        try {
          for (const suffix of ['', '/role']) {
            assert.equal(
              (
                await request(`/admin/users/1${suffix}`, 1, 'PATCH', {
                  fullName: '管理员一',
                  role: 'enterprise',
                  companyName: '不能降级最后管理员',
                })
              ).status,
              409,
            );
            assert.equal((await getUserById(1)).role, 'admin');
            assert.equal(
              (
                await request(`/admin/users/4${suffix}`, 2, 'PATCH', {
                  fullName: '老师',
                  role: 'enterprise',
                  companyName: '已失去权限',
                })
              ).status,
              403,
            );
          }
        } finally {
          await pool.execute('UPDATE users SET is_admin = 1 WHERE id = 2');
        }
      },
    );

    await t.test(
      'legacy Unicode nicknames are repaired free without resetting the ordinary rename allowance',
      async () => {
        const name = '𠀀'.repeat(64);
        assert.equal(isValidUsername(name), false);
        await pool.execute('UPDATE users SET username = ? WHERE id = 4', [name]);
        assert.equal((await getUserById(4)).username, name);
        const renamed = await changeUsername({
          pool,
          userId: 4,
          username: 'teacher_new_name',
          expectedUsername: name,
        });
        assert.equal(renamed.charged, 0);
        await pool.execute(
          "INSERT INTO username_change_log (user_id,old_username,new_username,change_kind,changed_at) VALUES (3,'旧中文','中文用户','free',UTC_TIMESTAMP(3))",
        );
        const repaired = await changeUsername({
          pool,
          userId: 3,
          username: 'student_repaired',
          expectedUsername: '中文用户',
        });
        assert.equal(repaired.charged, 0);
        const [[repairLog]] = await pool.execute(
          'SELECT change_kind, magnetic_cost FROM username_change_log WHERE user_id = 3 ORDER BY id DESC LIMIT 1',
        );
        assert.equal(repairLog.change_kind, 'required');
        assert.equal(Number(repairLog.magnetic_cost), 0);
        await assert.rejects(
          changeUsername({
            pool,
            userId: 3,
            username: 'student_next_name',
            expectedUsername: 'student_repaired',
          }),
          { code: 'payment_confirmation_required' },
        );
        assert.equal((await getUserById(3)).username, 'student_repaired');
      },
    );
  },
);
