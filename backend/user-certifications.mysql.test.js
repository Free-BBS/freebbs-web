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
  normalizeCertification,
  approveEnterpriseCertification,
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
    let failLedger = false;
    vm.runInNewContext(source.slice(start, end), {
      app,
      pool,
      crypto,
      requireAdmin,
      normalizeAdminAccount,
      normalizeCertification,
      approveEnterpriseCertification,
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
      annotateWalletLedger: async () => {
        if (failLedger) throw new Error('injected ledger failure');
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
      'Chinese accounts log in and recover using the shared username policy and verified email',
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
        });
        assert.equal(r.status, 201);
        assert.equal((await approve(r.data.request.id)).status, 200);
        const teacher = await service.decorate([
          { user_id: 5 },
          { user_id: 4 },
          { user_id: 5, is_anonymous: 1 },
          { user_id: 4, is_deleted: 1 },
        ]);
        assert.equal(teacher[0].author_role, 'student');
        assert.equal(teacher[0].identityBadges[0].label, '其他大学电子院 教师');
        assert.equal(teacher[1].identityBadges[0].label, '教师');
        for (const row of teacher.slice(2)) {
          assert.deepEqual(row.certifications, []);
          assert.deepEqual(row.identityBadges, []);
          assert.equal(row.author_role, '');
        }
        assert.equal((await getUserById(5)).role, 'student');
        assert.equal(Number((await getUserById(5)).is_admin), 0);
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
      'actual admin creation provisions Chinese enterprise credentials, NULL identities and verified company in one transaction',
      async () => {
        const body = {
          username: '中文企业',
          fullName: '企业联系名',
          companyName: '测试有限公司',
          role: 'enterprise',
          password: 'temporary-test-only',
        };
        assert.equal((await request('/admin/users', 3, 'POST', body)).status, 403);
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
        failLedger = true;
        const failed = await request('/admin/users', 1, 'POST', {
          ...body,
          username: '回滚企业',
          electrons: 1,
        });
        assert.equal(failed.status, 500);
        failLedger = false;
        const [[count]] = await pool.execute(
          "SELECT COUNT(*) AS count FROM users WHERE username = '回滚企业'",
        );
        assert.equal(Number(count.count), 0);
        assert.equal(
          (
            await request('/admin/users', 1, 'POST', {
              ...body,
              username: '坏企业',
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
      'UTF8MB4 usernames use codepoints and keep ordinary rename fees and ownership',
      async () => {
        const name = '𠀀'.repeat(64);
        assert.equal(isValidUsername(name), true);
        await pool.execute('UPDATE users SET username = ? WHERE id = 4', [name]);
        assert.equal((await getUserById(4)).username, name);
        const renamed = await changeUsername({
          pool,
          userId: 4,
          username: '教师新名',
          expectedUsername: name,
        });
        assert.equal(renamed.charged, 0);
        await pool.execute(
          "INSERT INTO username_change_log (user_id,old_username,new_username,change_kind,changed_at) VALUES (3,'旧中文','中文用户','free',UTC_TIMESTAMP(3))",
        );
        await assert.rejects(
          changeUsername({ pool, userId: 3, username: '学生新名', expectedUsername: '中文用户' }),
          { code: 'payment_confirmation_required' },
        );
        assert.equal((await getUserById(3)).username, '中文用户');
      },
    );
  },
);
