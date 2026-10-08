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
const { hashPassword, verifyPassword, verifyPasswordAsync } = require('./password');
const {
  hashCode,
  generateEmailCode,
  buildExpiryDate,
  CODE_TTL_MINUTES,
} = require('./verification');
const {
  normalizeAdminAccount,
  ensureTeacherAccountTables,
  createAccountIdentityService,
  createTeacherAccountsRouter,
} = require('./teacher-accounts');
const {
  ensureUsernameChangeTables,
  createUsernameRouter,
  getUsernameChangePolicy,
  isValidUsername,
} = require('./username-policy');
const {
  ensureUserCertificationTables,
  readApprovedCertifications,
} = require('./user-certifications');

test(
  'isolated MySQL verifies teacher accounts, identity ownership, retries and concurrent binding over HTTP',
  { skip: !process.env.FREEBBS_TEST_MYSQL_SOCKET, timeout: 120000 },
  async (t) => {
    const options = isolatedMysqlConfig(undefined);
    const adminDb = await mysql.createConnection(options);
    await assertIsolatedMysql(adminDb);
    const database = `freebbs_teacher_test_${crypto.randomBytes(8).toString('hex')}`;
    assert.match(database, /^freebbs_teacher_test_[a-f0-9]{16}$/);
    await adminDb.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    const pool = mysql.createPool({ ...options, database, connectionLimit: 8 });
    let observeQuery = async () => {};
    const originalGetConnection = pool.getConnection.bind(pool);
    pool.getConnection = async () => {
      const connection = await originalGetConnection();
      return new Proxy(connection, {
        get(target, property) {
          if (property === 'execute')
            return async (...args) => {
              const result = await target.execute(...args);
              await observeQuery(args[0], args[1], result);
              return result;
            };
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    t.after(async () => {
      await pool.end();
      await adminDb.query(`DROP DATABASE \`${database}\``);
      await adminDb.end();
    });
    await pool.query(`CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, uid VARCHAR(32) UNIQUE, username VARCHAR(64) NOT NULL UNIQUE,
    full_name VARCHAR(64) NOT NULL, student_id VARCHAR(10) NOT NULL UNIQUE, email VARCHAR(128) UNIQUE,
    password_hash VARCHAR(255) NOT NULL, email_verified_at DATETIME(3), role ENUM('student','ta','teacher','admin') DEFAULT 'student',
    is_admin TINYINT(1) DEFAULT 0, electrons BIGINT DEFAULT 0, manetrons BIGINT DEFAULT 0, heat BIGINT DEFAULT 0,
    grade VARCHAR(16), major VARCHAR(64), avatar_path VARCHAR(255), bio TEXT, website_url VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
    await pool.query(
      'CREATE TABLE user_golden_names (user_id BIGINT PRIMARY KEY, expires_at_ms BIGINT DEFAULT 0)',
    );
    await pool.query(
      'CREATE TABLE email_verification_codes (id BIGINT PRIMARY KEY AUTO_INCREMENT, email VARCHAR(128), code_hash VARCHAR(64), expires_at DATETIME, used_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)',
    );
    await pool.query(
      'CREATE TABLE discussion_posts (id BIGINT PRIMARY KEY AUTO_INCREMENT, user_id BIGINT, author_student_id VARCHAR(10), is_anonymous TINYINT DEFAULT 0, is_deleted TINYINT DEFAULT 0, is_hidden TINYINT DEFAULT 0)',
    );
    await pool.query(
      'CREATE TABLE discussion_post_likes (post_id BIGINT, reaction_type VARCHAR(16))',
    );
    await ensureTeacherAccountTables(pool);
    await ensureTeacherAccountTables(pool);
    await ensureUsernameChangeTables(pool);
    await ensureUserCertificationTables(pool);
    const adminPassword = 'admin-proof-password';
    await pool.execute(
      `INSERT INTO users (uid, username, full_name, student_id, password_hash, role, is_admin)
    VALUES ('u_admin', 'admin_teacher_test', '测试管理员', '2099000000', ?, 'teacher', 1)`,
      [hashPassword(adminPassword)],
    );
    let clock = Date.now();
    const delivered = [];
    const service = createAccountIdentityService({
      pool,
      now: () => clock,
      sendCode: async (email, code, purpose) => delivered.push({ email, code, purpose }),
    });
    const getUserById = async (id) => {
      const [[row]] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
      return row;
    };
    const toUserProfile = (user) => ({
      id: user.id,
      uid: user.uid,
      username: user.username,
      requiresUsernameChange: !isValidUsername(user.username),
      fullName: user.full_name,
      email: user.email,
      emailVerifiedAt: user.email_verified_at,
      studentId: user.student_id,
      role: user.role,
      isAdmin: Boolean(user.is_admin),
      manetrons: Number(user.manetrons),
    });
    const requireAuth = async (request, response) => {
      const user = await getUserById(
        Number(request.headers.authorization?.replace('Bearer ', '')) || 0,
      );
      if (!user) {
        response.status(401).json({ message: 'login required' });
        return null;
      }
      return user;
    };
    const requireAdmin = async (request, response) => {
      const user = await requireAuth(request, response);
      if (!user) return null;
      if (!user.is_admin) {
        response.status(403).json({ message: 'admin required' });
        return null;
      }
      return user;
    };
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createTeacherAccountsRouter({
        service,
        requireAuth,
        requireAdmin,
        getUserById,
        toUserProfile,
        issueToken: (user) => `test:${user.id}`,
      }),
    );
    app.use(
      '/api/profile/username',
      createUsernameRouter({
        pool,
        requireAuth,
        toUserProfile,
        issueToken: (user) => `test:${user.id}`,
      }),
    );
    const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    function registerActualRoute(begin, end, additions = {}) {
      const start = source.indexOf(begin);
      const finish = source.indexOf(end, start);
      assert.ok(start >= 0 && finish > start);
      vm.runInNewContext(source.slice(start, finish), {
        app,
        pool,
        crypto,
        requireAdmin,
        requireAuth,
        normalizeAdminAccount,
        readApprovedCertifications,
        hashPassword,
        verifyPasswordAsync,
        verifyPassword,
        hashCode,
        generateEmailCode,
        buildExpiryDate,
        CODE_TTL_MINUTES,
        sendVerificationCode: async (email, code) =>
          delivered.push({ email, code, purpose: 'legacy_reset' }),
        getUserById,
        toUserProfile,
        issueToken: (user) => `test:${user.id}`,
        createUniqueUserUid: async () => `u_${crypto.randomBytes(8).toString('hex')}`,
        withDatabaseTransaction: async (work) => {
          const connection = await pool.getConnection();
          try {
            await connection.beginTransaction();
            const result = await work(connection);
            await connection.commit();
            return result;
          } catch (error) {
            await connection.rollback();
            throw error;
          } finally {
            connection.release();
          }
        },
        ...additions,
      });
    }
    registerActualRoute("app.post('/api/admin/users',", "app.patch('/api/admin/users/:id',");
    registerActualRoute(
      "app.post('/api/auth/send-reset-code',",
      "app.post('/api/auth/login-challenge',",
    );
    registerActualRoute("app.post('/api/auth/login',", "app.post('/api/auth/reset-password',", {
      loginRateLimiter: {
        consumeIp: async () => ({ allowed: true }),
        consumeAccount: async () => ({ allowed: true }),
        resetAccount: async () => {},
      },
    });
    registerActualRoute("app.get('/api/users/:uid/public-profile',", "app.patch('/api/profile',", {
      economyShop: { decoratePosts: async () => [{}], publicCollectibles: async () => [] },
      getShopItems: () => [],
      profileExtras: { publicProfile: async () => ({}) },
      getOptionalAuthUser: async () => null,
      loadProfileActivity: async () => [],
    });
    registerActualRoute("app.post('/api/auth/reset-password',", "app.get('/api/auth/me',");
    registerActualRoute("app.patch('/api/profile/password',", "app.post('/api/profile/avatar',");
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(
      () =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    );
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(route, userId, body, method = body ? 'POST' : 'GET') {
      const response = await fetch(base + route, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(userId ? { Authorization: `Bearer ${userId}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }
    const teacherBody = (username) => ({
      username,
      fullName: '测试教师',
      role: 'teacher',
      password: 'initial-teacher-password',
    });
    await t.test(
      'actual admin route creates multiple NULL teachers and denies students or forged roles',
      async () => {
        assert.equal((await call('/admin/users', null, teacherBody('no_auth'))).status, 401);
        const [first, second] = await Promise.all([
          call('/admin/users', 1, teacherBody('teacher_one')),
          call('/admin/users', 1, teacherBody('teacher_two')),
        ]);
        for (const created of [first, second]) {
          assert.equal(created.status, 201);
          assert.equal(created.body.user.studentId, null);
          assert.equal(created.body.user.email, null);
          assert.equal(created.body.user.isAdmin, false);
          assert.equal(Object.hasOwn(created.body.user, 'password'), false);
        }
        assert.equal(
          (await call('/admin/users', first.body.user.id, teacherBody('forged_admin'))).status,
          403,
        );
        assert.equal(
          (await call('/admin/users', 1, { ...teacherBody('empty_student'), role: 'student' }))
            .status,
          400,
        );
        assert.equal((await call('/admin/users', 1, teacherBody('teacher_one'))).status, 409);
        const prefilled = await call('/admin/users', 1, {
          ...teacherBody('teacher_prefilled'),
          email: 'prefilled@example.test',
        });
        assert.equal(prefilled.status, 201);
        assert.equal(prefilled.body.user.emailVerifiedAt, null);
      },
    );
    await t.test(
      'a prefilled but unverified teacher email cannot bypass binding through either password-recovery method',
      async () => {
        const email = 'unverified-teacher@example.test';
        const studentId = '2026000008';
        const created = await call('/admin/users', 1, {
          ...teacherBody('teacher_unverified'),
          email,
          studentId,
        });
        assert.equal(created.status, 201);
        assert.equal(created.body.user.emailVerifiedAt, null);
        const user = created.body.user;
        const oldDelivered = delivered.length;
        assert.equal(
          (
            await call('/auth/send-reset-code', null, {
              identifier: user.username.toUpperCase(),
              email,
            })
          ).status,
          200,
        );
        assert.equal((await call('/auth/send-reset-code', null, { studentId, email })).status, 404);
        assert.equal(delivered.length, oldDelivered);
        const supplied = '123456';
        await pool.execute(
          'INSERT INTO email_verification_codes (email, code_hash, expires_at) VALUES (?, ?, ?)',
          [email, hashCode(email, supplied), buildExpiryDate()],
        );
        assert.equal(
          (
            await call('/auth/reset-password', null, {
              identifier: user.username.toUpperCase(),
              email,
              emailCode: supplied,
              password: 'must-not-change',
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await call('/auth/reset-password', null, {
              studentId,
              email,
              emailCode: supplied,
              password: 'must-not-change',
            })
          ).status,
          404,
        );
        await call('/profile/email-code', user.id, {
          email,
          currentPassword: 'initial-teacher-password',
        });
        const bindingCode = delivered.findLast(
          (item) => item.email === email && item.purpose === 'bind_email',
        ).code;
        assert.equal(
          (
            await call(
              '/profile/email',
              user.id,
              { email, currentPassword: 'initial-teacher-password', emailCode: bindingCode },
              'PATCH',
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await call('/auth/send-reset-code', null, {
              identifier: user.username.toUpperCase(),
              email,
            })
          ).status,
          200,
        );
        const usernameCode = delivered.findLast(
          (item) => item.email === email && item.purpose === 'reset_password',
        ).code;
        assert.equal(
          (
            await call('/auth/reset-password', null, {
              identifier: user.username.toUpperCase(),
              email,
              emailCode: usernameCode,
              password: 'username-recovered',
            })
          ).status,
          200,
        );
        await pool.execute(
          'UPDATE email_verification_codes SET created_at = DATE_SUB(NOW(), INTERVAL 2 MINUTE) WHERE email = ?',
          [email],
        );
        assert.equal((await call('/auth/send-reset-code', null, { studentId, email })).status, 200);
        const legacyCode = delivered.findLast(
          (item) => item.email === email && item.purpose === 'legacy_reset',
        ).code;
        assert.equal(
          (
            await call('/auth/reset-password', null, {
              studentId,
              email,
              emailCode: legacyCode,
              password: 'student-id-recovered',
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await call('/auth/login', null, {
              identifier: user.username,
              password: 'student-id-recovered',
            })
          ).status,
          200,
        );
      },
    );
    const [[first]] = await pool.execute("SELECT * FROM users WHERE username = 'teacher_one'");
    const [[second]] = await pool.execute("SELECT * FROM users WHERE username = 'teacher_two'");
    const password = 'initial-teacher-password';
    const code = (email, purpose = 'bind_email') =>
      delivered.findLast((item) => item.email === email && item.purpose === purpose).code;
    await t.test(
      'new Chinese nicknames are rejected while legacy Chinese and short accounts can recover and repair for free',
      async () => {
        assert.equal((await call('/admin/users', 1, teacherBody('中文教师'))).status, 400);
        for (const [index, username] of ['历史同学', 'ab'].entries()) {
          const email = `legacy-nickname-${index}@example.test`;
          const [inserted] = await pool.execute(
            `INSERT INTO users (uid, username, full_name, student_id, email, email_verified_at, password_hash, role, manetrons)
             VALUES (?, ?, '历史用户', ?, ?, ?, ?, 'student', 0)`,
            [
              `u_legacy_nickname_${index}`,
              username,
              `209988877${index}`,
              email,
              new Date(clock),
              hashPassword('legacy-password'),
            ],
          );
          const userId = inserted.insertId;
          await pool.execute(
            `INSERT INTO username_change_log (user_id, old_username, new_username, change_kind, magnetic_cost, changed_at)
             VALUES (?, 'previous_name', ?, 'free', 0, UTC_TIMESTAMP(3))`,
            [userId, username],
          );
          const login = await call('/auth/login', null, {
            identifier: username,
            password: 'legacy-password',
          });
          assert.equal(login.status, 200);
          assert.equal(login.body.user.requiresUsernameChange, true);
          assert.equal(
            (await call('/auth/send-reset-code', null, { identifier: username, email })).status,
            200,
          );
          const recovered = await call('/auth/reset-password', null, {
            identifier: username,
            email,
            emailCode: code(email, 'reset_password'),
            password: 'legacy-recovered-password',
          });
          assert.equal(recovered.status, 200);
          assert.equal(recovered.body.user.requiresUsernameChange, true);
          assert.equal(
            (
              await call('/auth/login', null, {
                identifier: username,
                password: 'legacy-recovered-password',
              })
            ).status,
            200,
          );
          const before = await getUsernameChangePolicy(pool, await getUserById(userId));
          const replacement = `legacy_repaired_${index}`;
          const changed = await call(
            '/profile/username',
            userId,
            { username: replacement },
            'PATCH',
          );
          assert.equal(changed.status, 200);
          assert.equal(changed.body.charged, 0);
          assert.equal(changed.body.user.requiresUsernameChange, false);
          assert.equal(changed.body.policy.freeAvailable, false);
          assert.equal(changed.body.policy.nextFreeAt, before.nextFreeAt);
          assert.equal(changed.body.user.manetrons, 0);
          const [[logs]] = await pool.execute(
            `SELECT SUM(change_kind = 'free') AS voluntary, SUM(change_kind = 'required') AS repairs,
                    SUM(magnetic_cost) AS spent FROM username_change_log WHERE user_id = ?`,
            [userId],
          );
          assert.equal(Number(logs.voluntary), 1);
          assert.equal(Number(logs.repairs), 1);
          assert.equal(Number(logs.spent), 0);
          assert.equal(
            (
              await call('/auth/login', null, {
                identifier: replacement,
                password: 'legacy-recovered-password',
              })
            ).status,
            200,
          );
        }
      },
    );
    await t.test(
      'actual login and repeated teacher renames work without charging currency',
      async () => {
        assert.equal(
          (await call('/auth/login', null, { identifier: first.username, password })).status,
          200,
        );
        for (const [previous, next] of [
          ['teacher_one', 'teacher_one_new'],
          ['teacher_one_new', 'teacher_one_final'],
        ]) {
          const changed = await call(
            '/profile/username',
            first.id,
            { username: next, expectedUsername: previous },
            'PATCH',
          );
          assert.equal(changed.status, 200);
          assert.equal(changed.body.charged, 0);
          assert.equal(changed.body.policy.teacherFree, true);
          assert.equal(changed.body.policy.cost, 0);
        }
        assert.equal(
          (await call('/auth/login', null, { identifier: 'teacher_one_final', password })).status,
          200,
        );
        const [[logs]] = await pool.execute(
          'SELECT COUNT(*) AS count, SUM(magnetic_cost) AS cost FROM username_change_log WHERE user_id = ?',
          [first.id],
        );
        assert.equal(Number(logs.count), 2);
        assert.equal(Number(logs.cost), 0);
        assert.equal(
          (
            await call(
              '/profile/username',
              first.id,
              { username: 'teacher_two', expectedUsername: 'teacher_one_final' },
              'PATCH',
            )
          ).status,
          409,
        );
        await pool.execute(
          'INSERT INTO discussion_posts (user_id, is_anonymous, is_hidden, is_deleted) VALUES (?,0,0,0), (?,1,0,0), (?,0,1,0), (?,0,0,1), (?,0,0,0)',
          [first.id, first.id, first.id, first.id, second.id],
        );
        await pool.query(
          "INSERT INTO discussion_post_likes (post_id, reaction_type) VALUES (1, 'smile'), (2, 'smile'), (3, 'smile'), (4, 'smile')",
        );
        const profile = await call(`/users/${first.uid}/public-profile`);
        assert.equal(profile.status, 200);
        assert.equal(profile.body.profile.postCount, 2);
        assert.equal(profile.body.profile.likeCount, 2);
      },
    );
    await t.test(
      'email code verifies current password, owner, target, purpose, attempts and single consumption',
      async () => {
        const email = 'one@example.test';
        const beforeDelivery = delivered.length;
        assert.equal(
          (
            await call('/profile/email-code', first.id, {
              email,
              currentPassword: 'wrong-password',
            })
          ).status,
          401,
        );
        assert.equal(delivered.length, beforeDelivery);
        assert.equal(
          (await call('/profile/email-code', first.id, { email, currentPassword: password }))
            .status,
          200,
        );
        assert.equal(
          (await call('/profile/email-code', first.id, { email, currentPassword: password }))
            .status,
          429,
        );
        assert.equal(
          (
            await call(
              '/profile/email',
              second.id,
              { email, currentPassword: password, emailCode: code(email) },
              'PATCH',
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              '/profile/email',
              first.id,
              { email: 'another@example.test', currentPassword: password, emailCode: code(email) },
              'PATCH',
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call('/auth/reset-password', null, {
              identifier: 'teacher_one_final',
              email,
              password: 'new-reset-password',
              emailCode: code(email),
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              '/profile/email',
              first.id,
              { email, currentPassword: password, emailCode: code(email) },
              'PATCH',
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await call(
              '/profile/email',
              first.id,
              { email, currentPassword: password, emailCode: code(email) },
              'PATCH',
            )
          ).status,
          400,
        );
        assert.equal((await call('/profile/identity', first.id)).body.emailVerified, true);
        clock += 61000;
        const lockedEmail = 'tries@example.test';
        await call('/profile/email-code', second.id, {
          email: lockedEmail,
          currentPassword: password,
        });
        const wrong = code(lockedEmail) === '000000' ? '999999' : '000000';
        for (let i = 0; i < 5; i += 1)
          assert.equal(
            (
              await call(
                '/profile/email',
                second.id,
                { email: lockedEmail, currentPassword: password, emailCode: wrong },
                'PATCH',
              )
            ).status,
            400,
          );
        assert.equal(
          (
            await call(
              '/profile/email',
              second.id,
              { email: lockedEmail, currentPassword: password, emailCode: code(lockedEmail) },
              'PATCH',
            )
          ).status,
          400,
        );
        clock += 61000;
        await call('/profile/email-code', second.id, {
          email: lockedEmail,
          currentPassword: password,
        });
        clock += 10 * 60000 + 1;
        assert.equal(
          (
            await call(
              '/profile/email',
              second.id,
              { email: lockedEmail, currentPassword: password, emailCode: code(lockedEmail) },
              'PATCH',
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      'concurrent claims keep unique email ownership and roll back the loser without consuming its code',
      async () => {
        clock += 61000;
        const email = 'shared@example.test';
        await call('/profile/email-code', first.id, { email, currentPassword: password });
        const firstCode = code(email);
        await call('/profile/email-code', second.id, { email, currentPassword: password });
        const secondCode = code(email);
        const results = await Promise.all([
          call(
            '/profile/email',
            first.id,
            { email, currentPassword: password, emailCode: firstCode },
            'PATCH',
          ),
          call(
            '/profile/email',
            second.id,
            { email, currentPassword: password, emailCode: secondCode },
            'PATCH',
          ),
        ]);
        assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
        const [[count]] = await pool.execute(
          'SELECT COUNT(*) AS count FROM users WHERE email = ?',
          [email],
        );
        assert.equal(Number(count.count), 1);
        const loser = results[0].status === 409 ? first.id : second.id;
        const [[remaining]] = await pool.execute(
          "SELECT used_at FROM account_identity_codes WHERE user_id = ? AND email = ? AND purpose = 'bind_email' ORDER BY id DESC LIMIT 1",
          [loser, email],
        );
        assert.equal(remaining.used_at, null);
      },
    );
    await t.test(
      'student binding stays pending until a confirmed administrator decision and handles concurrent uniqueness',
      async () => {
        const studentId = '2026000001';
        for (const user of [first, second]) {
          assert.equal(
            (
              await call('/profile/student-id', user.id, {
                studentId,
                currentPassword: password,
                role: 'admin',
              })
            ).status,
            200,
          );
          assert.equal((await getUserById(user.id)).student_id, null);
        }
        assert.equal(
          (
            await call(`/admin/student-id-requests/${first.id}`, first.id, {
              action: 'approve',
              studentId,
              identityConfirmed: true,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call(`/admin/student-id-requests/${first.id}`, 1, {
              action: 'approve',
              studentId,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await call(`/admin/student-id-requests/${first.id}`, 1, {
              action: 'approve',
              studentId: '2026000002',
              identityConfirmed: true,
            })
          ).status,
          409,
        );
        const results = await Promise.all(
          [first, second].map((user) =>
            call(`/admin/student-id-requests/${user.id}`, 1, {
              action: 'approve',
              studentId,
              identityConfirmed: true,
            }),
          ),
        );
        assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
        for (const user of [first, second]) {
          const stored = await getUserById(user.id);
          assert.equal(stored.role, 'teacher');
          assert.equal(stored.is_admin, 0);
          assert.equal(stored.uid, user.uid);
        }
        const profile = await call(`/users/${first.uid}/public-profile`);
        assert.equal(profile.status, 200);
        assert.equal(profile.body.profile.postCount, 2);
        assert.equal(profile.body.profile.likeCount, 2);
        const pending = (await call('/admin/student-id-requests', 1)).body.requests;
        assert.equal(pending.length, 1);
        assert.equal(
          (
            await call(`/admin/student-id-requests/${pending[0].userId}`, 1, {
              action: 'reject',
              studentId,
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      'verified-email password recovery isolates purposes and administrator reset requires proof',
      async () => {
        const user = await getUserById(first.id);
        const email = user.email;
        clock += 61000;
        assert.equal(
          (await call('/auth/send-reset-code', null, { identifier: user.username, email })).status,
          200,
        );
        const resetCode = code(email, 'reset_password');
        assert.equal(
          (
            await call(
              '/profile/email',
              user.id,
              { email, currentPassword: password, emailCode: resetCode },
              'PATCH',
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call('/auth/reset-password', null, {
              identifier: user.username,
              email,
              emailCode: resetCode,
              password: 'recovered-password',
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await call('/auth/reset-password', null, {
              identifier: user.username,
              email,
              emailCode: resetCode,
              password: 'another-password',
            })
          ).status,
          400,
        );
        assert.equal(
          (await call('/auth/login', null, { identifier: user.username, password })).status,
          401,
        );
        assert.equal(
          (
            await call('/auth/login', null, {
              identifier: user.username,
              password: 'recovered-password',
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await call(`/admin/users/${user.id}/reset-password`, second.id, {
              currentPassword: password,
              password: 'delivery-password',
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call(`/admin/users/${user.id}/reset-password`, 1, {
              currentPassword: 'wrong',
              password: 'delivery-password',
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await call('/admin/users/1/reset-password', 1, {
              currentPassword: adminPassword,
              password: 'delivery-password',
            })
          ).status,
          403,
        );
        const reset = await call(`/admin/users/${user.id}/reset-password`, 1, {
          currentPassword: adminPassword,
          password: 'delivery-password',
        });
        assert.equal(reset.status, 200);
        assert.equal(Object.hasOwn(reset.body, 'password'), false);
        assert.equal(
          (
            await call('/auth/login', null, {
              identifier: user.username,
              password: 'delivery-password',
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      'legacy student-ID reset serializes with email binding and consumes its code once',
      async () => {
        const studentId = '2026000007';
        const oldEmail = 'race-old@example.test';
        const newEmail = 'race-new@example.test';
        const created = await call('/admin/users', 1, {
          ...teacherBody('teacher_race'),
          studentId,
          email: oldEmail,
        });
        const teacher = created.body.user;
        assert.equal(created.status, 201);
        await call('/profile/email-code', teacher.id, {
          email: oldEmail,
          currentPassword: password,
        });
        await call(
          '/profile/email',
          teacher.id,
          { email: oldEmail, currentPassword: password, emailCode: code(oldEmail) },
          'PATCH',
        );
        clock += 61000;
        await call('/profile/email-code', teacher.id, {
          email: newEmail,
          currentPassword: password,
        });
        const bindingCode = code(newEmail);
        await call('/auth/send-reset-code', null, { studentId, email: oldEmail });
        const legacyCode = code(oldEmail, 'legacy_reset');
        const pause = () => {
          let release;
          let reached;
          return {
            wait: new Promise((resolve) => {
              reached = resolve;
            }),
            gate: new Promise((resolve) => {
              release = resolve;
            }),
            reached: () => reached(),
            release: () => release(),
          };
        };
        const waitForLock = async () => {
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const [[waiting]] = await adminDb.execute(
              `SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA = ?`,
              [database],
            );
            if (Number(waiting.count)) return;
            await new Promise((resolve) => {
              setTimeout(resolve, 10);
            });
          }
          assert.fail('the competing request must wait on the real users row lock');
        };
        const resetFirst = pause();
        observeQuery = async (sql, params) => {
          if (
            /WHERE student_id = \?/.test(sql) &&
            /FOR UPDATE/.test(sql) &&
            params[0] === studentId
          ) {
            resetFirst.reached();
            await resetFirst.gate;
          }
        };
        const resetBody = {
          studentId,
          email: oldEmail,
          emailCode: legacyCode,
          password: 'race-reset-password',
        };
        const reset = call('/auth/reset-password', null, resetBody);
        await resetFirst.wait;
        const binding = call(
          '/profile/email',
          teacher.id,
          { email: newEmail, currentPassword: password, emailCode: bindingCode },
          'PATCH',
        );
        try {
          await waitForLock();
        } finally {
          resetFirst.release();
        }
        assert.equal((await reset).status, 200);
        assert.equal((await binding).status, 401);
        observeQuery = async () => {};
        assert.equal((await getUserById(teacher.id)).email, oldEmail);
        assert.equal((await call('/auth/reset-password', null, resetBody)).status, 400);
        clock += 61000;
        await call('/profile/email-code', teacher.id, {
          email: newEmail,
          currentPassword: 'race-reset-password',
        });
        await pool.execute(
          'UPDATE email_verification_codes SET created_at = DATE_SUB(NOW(), INTERVAL 2 MINUTE) WHERE email = ?',
          [oldEmail],
        );
        await call('/auth/send-reset-code', null, { studentId, email: oldEmail });
        const staleCode = code(oldEmail, 'legacy_reset');
        const bindingFirst = pause();
        observeQuery = async (sql, params) => {
          if (
            /SELECT \* FROM users WHERE id = \? FOR UPDATE/.test(sql) &&
            params[0] === teacher.id
          ) {
            bindingFirst.reached();
            await bindingFirst.gate;
          }
        };
        const winningBinding = call(
          '/profile/email',
          teacher.id,
          { email: newEmail, currentPassword: 'race-reset-password', emailCode: code(newEmail) },
          'PATCH',
        );
        await bindingFirst.wait;
        const staleReset = call('/auth/reset-password', null, {
          ...resetBody,
          emailCode: staleCode,
          password: 'stale-must-not-win',
        });
        try {
          await waitForLock();
        } finally {
          bindingFirst.release();
        }
        assert.equal((await winningBinding).status, 200);
        assert.equal((await staleReset).status, 404);
        observeQuery = async () => {};
        assert.equal((await getUserById(teacher.id)).email, newEmail);
        assert.equal(
          (
            await call('/auth/login', null, {
              identifier: teacher.username,
              password: 'race-reset-password',
            })
          ).status,
          200,
        );
        const concurrentResetEmail = 'race-new@example.test';
        await call('/auth/send-reset-code', null, { studentId, email: concurrentResetEmail });
        const concurrentBody = {
          studentId,
          email: concurrentResetEmail,
          emailCode: code(concurrentResetEmail, 'legacy_reset'),
          password: 'once-only-password',
        };
        const attempts = await Promise.all([
          call('/auth/reset-password', null, concurrentBody),
          call('/auth/reset-password', null, concurrentBody),
        ]);
        assert.deepEqual(attempts.map((item) => item.status).sort(), [200, 400]);
      },
    );
    await t.test(
      'existing student-ID recovery and actual authenticated password change remain usable',
      async () => {
        const studentId = '2026000009';
        const email = 'student-nine@example.test';
        const created = await call('/admin/users', 1, {
          username: 'student_nine',
          fullName: '测试学生',
          role: 'student',
          password,
          studentId,
          email,
        });
        assert.equal(created.status, 201);
        const student = created.body.user;
        assert.equal((await call('/auth/send-reset-code', null, { studentId, email })).status, 200);
        const legacyCode = code(email, 'legacy_reset');
        assert.equal(
          (
            await call('/auth/reset-password', null, {
              studentId,
              email,
              emailCode: legacyCode,
              password: 'student-reset-password',
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await call('/auth/login', null, {
              identifier: student.username,
              password: 'student-reset-password',
            })
          ).status,
          200,
        );
        const changed = await call(
          '/profile/password',
          student.id,
          { currentPassword: 'student-reset-password', newPassword: 'student-change-password' },
          'PATCH',
        );
        assert.equal(changed.status, 200);
        assert.equal(
          (
            await call('/auth/login', null, {
              identifier: student.username,
              password: 'student-change-password',
            })
          ).status,
          200,
        );
        const teacherChanged = await call(
          '/profile/password',
          first.id,
          { currentPassword: 'delivery-password', newPassword: 'teacher-change-password' },
          'PATCH',
        );
        assert.equal(teacherChanged.status, 200);
        assert.equal(
          (
            await call('/auth/login', null, {
              identifier: 'teacher_one_final',
              password: 'teacher-change-password',
            })
          ).status,
          200,
        );
      },
    );
  },
);
