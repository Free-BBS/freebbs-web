const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const { promisify } = require('node:util');
const mysql = require('mysql2/promise');
const ExcelJS = require('exceljs');
const { hashPassword } = require('./password');
const { hashCode } = require('./verification');
const {
  COMMUNITY_AGREEMENT_VERSION,
  generateBandChallenge,
  generateWienChallenge,
} = require('./registration-guard');
const { solveAuthChallenge: solveChallenge } = require('./test-helpers/auth');

const runProgram = promisify(execFile);

async function reservePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => {
    server.close(resolve);
  });
  return port;
}

test(
  'community features work together against the full existing MySQL schema',
  {
    skip: process.env.RUN_COMMUNITY_INTEGRATION !== '1',
    timeout: 60000,
  },
  async (t) => {
    const database = `freebbs_community_test_${crypto.randomBytes(6).toString('hex')}`;
    const root = path.resolve(__dirname, '..');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'freebbs-community-'));
    const mysqlOptions = {
      host: process.env.BACKEND_IP || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      multipleStatements: true,
    };
    const db = await mysql.createConnection(mysqlOptions);
    let backend;
    let logs = '';
    t.after(async () => {
      if (backend && backend.exitCode === null) {
        backend.kill('SIGTERM');
        await once(backend, 'exit');
      }
      await db.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await db.end();
      await fs.rm(temp, { recursive: true, force: true });
    });
    for (const file of ['schema.sql', 'seed.sql']) {
      const source = await fs.readFile(path.join(root, 'database', file), 'utf8');
      await db.query(source.replaceAll('free_bbs', database));
    }
    const port = await reservePort();
    backend = spawn(process.execPath, ['backend/server.js'], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: String(port),
        BACKEND_IP: mysqlOptions.host,
        MYSQL_PORT: String(mysqlOptions.port),
        MYSQL_USER: mysqlOptions.user,
        MYSQL_PASSWORD: mysqlOptions.password,
        MYSQL_DATABASE: database,
        AUTH_SECRET: crypto.randomBytes(32).toString('hex'),
        UPLOAD_DIR: path.join(temp, 'uploads'),
        AGENT_SERVICE_TOKEN: '',
        AGENT_SETTINGS_REQUIRED: 'false',
        TSINGHUA_CONNECTOR_REQUIRED: 'false',
        TSINGHUA_CONNECTOR_MODE: 'disabled',
        BOTMAIL_SMTP: '',
        BOTMAIL_USER: '',
        BOTMAIL_PASS: '',
        BOTMAIL_FROM: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backend.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    backend.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    const base = `http://127.0.0.1:${port}/api`;
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      try {
        if ((await fetch(`${base}/health`)).ok) {
          ready = true;
          break;
        }
      } catch {
        /* startup */
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
    assert.ok(ready, logs);

    async function challengeFor(purpose, identity, type) {
      const challenge = await api(
        `/auth/${purpose === 'login' ? 'login' : 'registration'}-challenge`,
        {
          method: 'POST',
          body: purpose === 'login' ? { identifier: identity } : { email: identity },
        },
      );
      assert.ok(['band', 'wien'].includes(challenge.type));
      const [[stored]] = await db.execute(
        `SELECT c.answer_k, c.tolerance, w.parameters FROM registration_challenges c
         LEFT JOIN registration_challenge_circuits w ON w.challenge_id = c.id WHERE c.id = ?`,
        [challenge.challengeId],
      );
      if (challenge.type === 'wien') {
        const parameters =
          typeof stored.parameters === 'string' ? JSON.parse(stored.parameters) : stored.parameters;
        assert.deepEqual(parameters, challenge.oscillator);
        assert.equal(stored.answer_k, 2);
        assert.equal(stored.tolerance, 0);
      } else {
        assert.equal(stored.parameters, null);
      }
      if (!type || challenge.type === type) return challenge;
      // Keep API randomness in production. Only this isolated test database is
      // replaced with a generated fixture when a case requires a specific type.
      const generated = type === 'wien' ? generateWienChallenge() : generateBandChallenge();
      await db.execute('DELETE FROM registration_challenge_circuits WHERE challenge_id = ?', [
        challenge.challengeId,
      ]);
      await db.execute(
        'UPDATE registration_challenges SET answer_k = ?, tolerance = ? WHERE id = ?',
        [generated.answerK, generated.tolerance, challenge.challengeId],
      );
      if (generated.circuitParameters) {
        await db.execute(
          'INSERT INTO registration_challenge_circuits (challenge_id, parameters) VALUES (?, ?)',
          [challenge.challengeId, JSON.stringify(generated.circuitParameters)],
        );
      }
      return {
        challengeId: challenge.challengeId,
        expiresAt: challenge.expiresAt,
        communityAgreementVersion: challenge.communityAgreementVersion,
        ...generated.publicChallenge,
      };
    }
    async function registrationPayload(identity, type) {
      const agreement = {
        communityAgreementAccepted: true,
        communityAgreementVersion: COMMUNITY_AGREEMENT_VERSION,
      };
      if (identity.email.length > 128) return { ...agreement, ...identity };
      const challenge = await challengeFor('register', identity.email, type);
      return { ...agreement, ...identity, captcha: solveChallenge(challenge) };
    }
    async function api(
      route,
      { token, method = 'GET', body, expected = 200, rawRegistration = false } = {},
    ) {
      const requestBody =
        route === '/auth/register' && !rawRegistration ? await registrationPayload(body) : body;
      const response = await fetch(`${base}${route}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
      });
      const result = await response.json();
      assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result)}`);
      return result;
    }
    async function login(identifier) {
      const challenge = await api('/auth/login-challenge', {
        method: 'POST',
        body: { identifier },
      });
      return api('/auth/login', {
        method: 'POST',
        body: { identifier, password: 'free-bbs', captcha: solveChallenge(challenge) },
      });
    }
    async function createUser(username, studentId) {
      const [inserted] = await db.execute(
        'INSERT INTO users (username,full_name,student_id,email,password_hash,role) VALUES (?,?,?,?,?,?)',
        [
          username,
          '测试成员',
          studentId,
          `${studentId}@example.invalid`,
          hashPassword('free-bbs'),
          'student',
        ],
      );
      return { id: inserted.insertId, ...(await login(username)) };
    }
    async function workbook(rows) {
      const book = new ExcelJS.Workbook();
      book.addWorksheet('注册白名单').addRows([['学号', '姓名', '邮箱'], ...rows]);
      return book.xlsx.writeBuffer();
    }
    const admin = await login('admin');
    const legacy = await createUser('旧用户名', '2026000101');
    const outsider = await createUser('outside_user', '2026000102');

    await t.test(
      'existing invalid usernames must be renamed before using session or upload APIs',
      async () => {
        assert.equal(legacy.user.requiresUsernameChange, true);
        const me = await api('/auth/me', { token: legacy.token });
        assert.equal(me.user.requiresUsernameChange, true);
        for (const route of ['/course-upload/tokens', '/notifications/unread-count']) {
          const blocked = await api(route, { token: legacy.token, expected: 403 });
          assert.equal(blocked.code, 'username_change_required');
        }
        await api('/profile/username', {
          token: legacy.token,
          method: 'PATCH',
          body: { username: 'invalid\n' },
          expected: 400,
        });
        await api('/profile/username', {
          token: legacy.token,
          method: 'PATCH',
          body: { username: 'admin' },
          expected: 409,
        });
        const renamed = await api('/profile/username', {
          token: legacy.token,
          method: 'PATCH',
          body: { username: 'course_owner' },
        });
        legacy.token = renamed.token;
        assert.equal(renamed.user.requiresUsernameChange, false);
        await api('/course-upload/tokens', { token: legacy.token });
      },
    );

    await t.test(
      'whitelist matches one complete row, consumes once, and rolls back failed registration',
      async () => {
        const identity = {
          username: 'new_student',
          studentId: '2026000103',
          fullName: '白名单学生',
          email: 'new@example.invalid',
          password: 'free-bbs',
          emailCode: '123456',
        };
        const boundaryEmail = `${'a'.repeat(60)}@${'b'.repeat(63)}.edu`;
        for (const route of ['/auth/send-email-code', '/auth/register']) {
          const rejected = await api(route, {
            method: 'POST',
            body: { ...identity, email: `a${boundaryEmail}` },
            expected: 400,
          });
          assert.match(rejected.message, /128/);
          await api(route, {
            method: 'POST',
            body: { ...identity, email: boundaryEmail },
            expected: 403,
          });
        }
        await api('/auth/send-email-code', { method: 'POST', body: identity, expected: 403 });
        await api('/auth/register', { method: 'POST', body: identity, expected: 403 });
        const raw = await workbook([[identity.studentId, identity.fullName, identity.email]]);
        const upload = await fetch(`${base}/admin/registration-whitelist/import`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${admin.token}`,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          body: raw,
        });
        assert.equal(upload.status, 200, await upload.text());
        await api('/admin/registration-whitelist', { token: outsider.token, expected: 403 });
        await api('/auth/register', {
          method: 'POST',
          body: { ...identity, fullName: '另一人' },
          expected: 403,
        });
        await api('/auth/register', { method: 'POST', body: identity, expected: 400 });
        await db.execute(
          'INSERT INTO email_verification_codes (email,code_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))',
          [identity.email, hashCode(identity.email, identity.emailCode)],
        );
        const registered = await api('/auth/register', {
          method: 'POST',
          body: identity,
          expected: 201,
        });
        assert.equal(registered.user.username, identity.username);
        const [claimed] = await db.query(
          'SELECT claimed_user_id FROM registration_whitelist WHERE student_id = ?',
          [identity.studentId],
        );
        assert.equal(Number(claimed[0].claimed_user_id), Number(registered.user.id));
        await api('/auth/register', { method: 'POST', body: identity, expected: 403 });
        const template = await fetch(`${base}/admin/registration-whitelist/template`, {
          headers: { Authorization: `Bearer ${admin.token}` },
        });
        assert.equal(template.status, 200);
        assert.equal(
          Buffer.from(await template.arrayBuffer())
            .subarray(0, 2)
            .toString(),
          'PK',
        );
      },
    );

    await t.test(
      'registration agreement and captcha cannot be bypassed, replayed, or raced',
      async () => {
        const identity = {
          username: 'guard_student',
          studentId: '2026000104',
          fullName: '能带验证学生',
          email: 'guard@example.invalid',
          password: 'free-bbs',
          emailCode: '123456',
        };
        await db.execute(
          'INSERT INTO registration_whitelist (fingerprint,student_id,full_name,email) VALUES (?,?,?,?)',
          [
            crypto.randomBytes(32).toString('hex'),
            identity.studentId,
            identity.fullName,
            identity.email,
          ],
        );
        await db.execute(
          'INSERT INTO email_verification_codes (email,code_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))',
          [identity.email, hashCode(identity.email, identity.emailCode)],
        );
        const registrationBand = await challengeFor('register', identity.email, 'band');
        const valid = {
          ...identity,
          communityAgreementAccepted: true,
          communityAgreementVersion: COMMUNITY_AGREEMENT_VERSION,
          captcha: solveChallenge(registrationBand),
        };
        for (const [changes, code] of [
          [{ communityAgreementAccepted: undefined }, 'community_agreement_required'],
          [{ communityAgreementAccepted: 'true' }, 'community_agreement_required'],
          [{ communityAgreementVersion: 'old' }, 'community_agreement_version_mismatch'],
          [{ captcha: undefined }, 'registration_captcha_required'],
          [{ captcha: { challengeId: '0'.repeat(64), k: 0 } }, 'registration_captcha_invalid'],
          [{ email: 'another@example.invalid' }, 'registration_captcha_invalid'],
        ]) {
          const rejected = await api('/auth/register', {
            method: 'POST',
            body: { ...valid, ...changes },
            expected: 400,
            rawRegistration: true,
          });
          assert.equal(rejected.code, code);
        }
        const incorrect = await api('/auth/register', {
          method: 'POST',
          body: {
            ...valid,
            captcha: {
              ...valid.captcha,
              k: registrationBand.band.candidates.find(
                (candidate) => candidate.k !== valid.captcha.k,
              ).k,
            },
          },
          expected: 400,
          rawRegistration: true,
        });
        assert.equal(incorrect.code, 'registration_captcha_incorrect');
        const replayWrong = await api('/auth/register', {
          method: 'POST',
          body: valid,
          expected: 400,
          rawRegistration: true,
        });
        assert.equal(replayWrong.code, 'registration_captcha_used');
        const outsideTolerance = await registrationPayload(identity, 'band');
        outsideTolerance.captcha.k += outsideTolerance.captcha.k > 0 ? -0.050001 : 0.050001;
        assert.equal(
          (
            await api('/auth/register', {
              method: 'POST',
              body: outsideTolerance,
              expected: 400,
              rawRegistration: true,
            })
          ).code,
          'registration_captcha_incorrect',
          'free dragging just beyond the accepted range must fail',
        );
        const expired = await registrationPayload(identity);
        await db.execute(
          'UPDATE registration_challenges SET expires_at = NOW() - INTERVAL 1 SECOND WHERE id = ?',
          [expired.captcha.challengeId],
        );
        assert.equal(
          (
            await api('/auth/register', {
              method: 'POST',
              body: expired,
              expected: 400,
              rawRegistration: true,
            })
          ).code,
          'registration_captcha_expired',
        );
        const [[unusedCode]] = await db.query(
          'SELECT used_at FROM email_verification_codes WHERE email = ?',
          [identity.email],
        );
        assert.equal(
          unusedCode.used_at,
          null,
          'failed captcha must not consume email verification',
        );
        const concurrentPayload = await registrationPayload(identity, 'band');
        // A free drop at the inclusive tolerance boundary still creates the account.
        concurrentPayload.captcha.k += concurrentPayload.captcha.k > 0 ? -0.05 : 0.05;
        await api('/auth/register', {
          method: 'POST',
          body: { ...concurrentPayload, username: 'admin' },
          expected: 409,
          rawRegistration: true,
        });
        const [[rolledBackChallenge]] = await db.query(
          'SELECT consumed_at FROM registration_challenges WHERE id = ?',
          [concurrentPayload.captcha.challengeId],
        );
        assert.equal(
          rolledBackChallenge.consumed_at,
          null,
          'failed account creation rolls back a correct answer',
        );
        const [[rolledBackWhitelist]] = await db.query(
          'SELECT claimed_user_id FROM registration_whitelist WHERE student_id = ?',
          [identity.studentId],
        );
        assert.equal(rolledBackWhitelist.claimed_user_id, null);
        const outcomes = await Promise.all(
          [0, 1].map(async () => {
            const response = await fetch(`${base}/auth/register`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(concurrentPayload),
            });
            return { status: response.status, body: await response.json() };
          }),
        );
        assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), [201, 400]);
        assert.equal(
          outcomes.find((outcome) => outcome.status === 400).body.code,
          'registration_captcha_used',
        );
        const registered = outcomes.find((outcome) => outcome.status === 201).body.user;
        const [[agreement]] = await db.query(
          'SELECT agreement_version,accepted_at FROM user_community_agreements WHERE user_id = ?',
          [registered.id],
        );
        assert.equal(agreement.agreement_version, COMMUNITY_AGREEMENT_VERSION);
        assert.ok(agreement.accepted_at);
        const [[claimed]] = await db.query(
          'SELECT claimed_user_id FROM registration_whitelist WHERE student_id = ?',
          [identity.studentId],
        );
        assert.equal(Number(claimed.claimed_user_id), Number(registered.id));
        assert.equal(
          (
            await api('/auth/register', {
              method: 'POST',
              body: concurrentPayload,
              expected: 400,
              rawRegistration: true,
            })
          ).code,
          'registration_captcha_used',
        );
      },
    );

    await t.test(
      'login requires a separate one-use challenge even after an incorrect password',
      async () => {
        async function loginPayload(identifier = 'admin') {
          const challenge = await challengeFor('login', identifier, 'band');
          return { identifier, password: 'free-bbs', captcha: solveChallenge(challenge) };
        }
        assert.equal(
          (
            await api('/auth/login', {
              method: 'POST',
              body: { identifier: 'admin', password: 'free-bbs' },
              expected: 400,
            })
          ).code,
          'login_captcha_required',
        );
        const wrongChallenge = await challengeFor('login', 'admin', 'band');
        const wrong = {
          identifier: 'admin',
          password: 'free-bbs',
          captcha: solveChallenge(wrongChallenge),
        };
        assert.equal(
          (
            await api('/auth/login', {
              method: 'POST',
              body: {
                ...wrong,
                captcha: {
                  ...wrong.captcha,
                  k: wrongChallenge.band.candidates.find(
                    (candidate) => candidate.k !== wrong.captcha.k,
                  ).k,
                },
              },
              expected: 400,
            })
          ).code,
          'login_captcha_incorrect',
        );
        assert.equal(
          (await api('/auth/login', { method: 'POST', body: wrong, expected: 400 })).code,
          'login_captcha_used',
        );
        const outsideTolerance = await loginPayload();
        outsideTolerance.captcha.k += outsideTolerance.captcha.k > 0 ? -0.050001 : 0.050001;
        assert.equal(
          (
            await api('/auth/login', {
              method: 'POST',
              body: outsideTolerance,
              expected: 400,
            })
          ).code,
          'login_captcha_incorrect',
          'free dragging just beyond the accepted range must fail',
        );
        const wrongPassword = await loginPayload();
        wrongPassword.captcha.k += wrongPassword.captcha.k > 0 ? -0.04 : 0.04;
        await api('/auth/login', {
          method: 'POST',
          body: { ...wrongPassword, password: 'incorrect-password' },
          expected: 401,
        });
        assert.equal(
          (await api('/auth/login', { method: 'POST', body: wrongPassword, expected: 400 })).code,
          'login_captcha_used',
        );
        const expired = await loginPayload();
        await db.execute(
          'UPDATE registration_challenges SET expires_at = NOW() - INTERVAL 1 SECOND WHERE id = ?',
          [expired.captcha.challengeId],
        );
        assert.equal(
          (await api('/auth/login', { method: 'POST', body: expired, expected: 400 })).code,
          'login_captcha_expired',
        );
        const boundIdentity = await loginPayload();
        // Identity binding also applies when dropping at the inclusive boundary.
        boundIdentity.captcha.k += boundIdentity.captcha.k > 0 ? -0.05 : 0.05;
        assert.equal(
          (
            await api('/auth/login', {
              method: 'POST',
              body: { ...boundIdentity, identifier: 'outside_user' },
              expected: 400,
            })
          ).code,
          'login_captcha_invalid',
        );
        await api('/auth/login', {
          method: 'POST',
          body: { ...boundIdentity, identifier: ' ADMIN ' },
        });
        const email = '2026000102@example.invalid';
        const registrationChallenge = await api('/auth/registration-challenge', {
          method: 'POST',
          body: { email },
        });
        assert.equal(
          (
            await api('/auth/login', {
              method: 'POST',
              body: {
                identifier: email,
                password: 'free-bbs',
                captcha: solveChallenge(registrationChallenge),
              },
              expected: 400,
            })
          ).code,
          'login_captcha_invalid',
        );
        const loginChallenge = await loginPayload(email);
        assert.equal(
          (
            await api('/auth/register', {
              method: 'POST',
              body: {
                username: 'cross_purpose',
                studentId: '2026000111',
                fullName: '验证用途测试',
                email,
                password: 'free-bbs',
                emailCode: '123456',
                communityAgreementAccepted: true,
                communityAgreementVersion: COMMUNITY_AGREEMENT_VERSION,
                captcha: loginChallenge.captcha,
              },
              expected: 400,
              rawRegistration: true,
            })
          ).code,
          'registration_captcha_invalid',
        );
        const concurrent = await loginPayload();
        const outcomes = await Promise.all(
          [0, 1].map(async () => {
            const response = await fetch(`${base}/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(concurrent),
            });
            return { status: response.status, body: await response.json() };
          }),
        );
        assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), [200, 400]);
        assert.equal(
          outcomes.find((outcome) => outcome.status === 400).body.code,
          'login_captcha_used',
        );
      },
    );

    await t.test(
      'login and registration issue fresh challenges beyond former identity and shared IP quotas',
      async () => {
        const identity = 'unlimited-challenges@example.invalid';
        const [[clock]] = await db.execute('SELECT UNIX_TIMESTAMP(NOW()) AS now_seconds');
        const windowStart = Math.floor(Number(clock.now_seconds) / 900) * 900;
        for (const scope of [`register:${identity}`, `login:${identity}`, 'ip:127.0.0.1']) {
          const scopeHash = crypto.createHash('sha256').update(scope).digest('hex');
          // Preserve historical counters, including saturated current windows.
          // Seed the next window too so the assertion survives a clock boundary.
          for (const window of [windowStart - 172800, windowStart, windowStart + 900]) {
            await db.execute(
              `INSERT INTO registration_challenge_rates (scope_hash, window_start, issued_count)
               VALUES (?, ?, 10000)`,
              [scopeHash, window],
            );
          }
        }
        const [ratesBefore] = await db.execute(
          'SELECT * FROM registration_challenge_rates ORDER BY scope_hash, window_start',
        );
        const challengeIds = new Set();
        // Each mode exceeds the former per-identity allowance of 12, and all
        // 66 requests use the same loopback IP, beyond its former allowance of 60.
        for (let count = 0; count < 33; count += 1) {
          for (const purpose of ['register', 'login']) {
            const startedAt = Date.now();
            const challenge = await api(
              `/auth/${purpose === 'register' ? 'registration' : 'login'}-challenge`,
              {
                method: 'POST',
                body: purpose === 'register' ? { email: identity } : { identifier: identity },
              },
            );
            assert.match(challenge.challengeId, /^[a-f0-9]{64}$/);
            assert.equal(challengeIds.has(challenge.challengeId), false);
            challengeIds.add(challenge.challengeId);
            assert.ok(['band', 'wien'].includes(challenge.type));
            assert.equal(challenge.communityAgreementVersion, COMMUNITY_AGREEMENT_VERSION);
            const expiry = new Date(challenge.expiresAt).getTime();
            assert.ok(expiry >= startedAt + 298000 && expiry <= Date.now() + 301000);
            assert.equal(challenge.answerK, undefined);
            assert.equal(challenge.tolerance, undefined);
          }
        }
        assert.equal(challengeIds.size, 66);
        const [issued] = await db.execute(
          'SELECT id, purpose, consumed_at FROM registration_challenges WHERE email = ?',
          [identity],
        );
        assert.equal(issued.length, 66);
        for (const purpose of ['register', 'login']) {
          assert.equal(issued.filter((challenge) => challenge.purpose === purpose).length, 33);
        }
        for (const challenge of issued) {
          assert.equal(challengeIds.has(challenge.id), true);
          assert.equal(challenge.consumed_at, null);
        }
        const [ratesAfter] = await db.execute(
          'SELECT * FROM registration_challenge_rates ORDER BY scope_hash, window_start',
        );
        assert.deepEqual(
          ratesAfter,
          ratesBefore,
          'legacy counters must not gate or track issuance',
        );
      },
    );

    await t.test(
      'Wien challenges verify startup and strict pole |Q| for registration and login',
      async () => {
        const identity = {
          username: 'wien_student',
          studentId: '2026000124',
          fullName: '文氏验证学生',
          email: 'wien@example.invalid',
          password: 'free-bbs',
          emailCode: '234567',
          communityAgreementAccepted: true,
          communityAgreementVersion: COMMUNITY_AGREEMENT_VERSION,
        };
        await db.execute(
          'INSERT INTO registration_whitelist (fingerprint,student_id,full_name,email) VALUES (?,?,?,?)',
          [
            crypto.randomBytes(32).toString('hex'),
            identity.studentId,
            identity.fullName,
            identity.email,
          ],
        );
        await db.execute(
          'INSERT INTO email_verification_codes (email,code_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))',
          [identity.email, hashCode(identity.email, identity.emailCode)],
        );
        for (const purpose of ['register', 'login']) {
          const identifier = purpose === 'register' ? identity.email : 'admin';
          const route = `/auth/${purpose === 'register' ? 'register' : 'login'}`;
          const prefix = purpose === 'register' ? 'registration' : 'login';
          const body = purpose === 'register' ? identity : { identifier, password: 'free-bbs' };
          for (const answer of [
            (p) => ({ resistanceOhms: p.rfInitialOhms }),
            (p) => ({ resistanceOhms: 2 * p.rgOhms }),
            (p) => ({ resistanceOhms: p.rfMaxOhms }),
            (p) => ({ resistanceOhms: (2 + 1 / p.qMin) * p.rgOhms }),
            (p) => ({ resistanceOhms: String((2 + 0.5 / p.qMin) * p.rgOhms) }),
            () => ({ type: 'band', k: 2, q: 999999, gain: 3.001, starts: true }),
          ]) {
            const challenge = await challengeFor(purpose, identifier, 'wien');
            const captcha = { challengeId: challenge.challengeId, ...answer(challenge.oscillator) };
            assert.equal(
              (
                await api(route, {
                  method: 'POST',
                  body: { ...body, captcha },
                  expected: 400,
                  rawRegistration: true,
                })
              ).code,
              `${prefix}_captcha_incorrect`,
            );
            assert.equal(
              (
                await api(route, {
                  method: 'POST',
                  body: { ...body, captcha: solveChallenge(challenge) },
                  expected: 400,
                  rawRegistration: true,
                })
              ).code,
              `${prefix}_captcha_used`,
            );
          }
          const challenge = await challengeFor(purpose, identifier, 'wien');
          const captcha = solveChallenge(challenge);
          assert.equal(
            (
              await api(route, {
                method: 'POST',
                body: {
                  ...body,
                  ...(purpose === 'register'
                    ? { email: 'wrong@example.invalid' }
                    : { identifier: 'outside_user' }),
                  captcha,
                },
                expected: 400,
                rawRegistration: true,
              })
            ).code,
            `${prefix}_captcha_invalid`,
          );
          if (purpose === 'register') {
            await api(route, {
              method: 'POST',
              body: { ...body, username: 'admin', captcha },
              expected: 409,
              rawRegistration: true,
            });
            const [[unconsumed]] = await db.execute(
              'SELECT consumed_at FROM registration_challenges WHERE id = ?',
              [challenge.challengeId],
            );
            assert.equal(
              unconsumed.consumed_at,
              null,
              'correct Wien answer rolls back with other registration errors',
            );
          }
          const success = await api(route, {
            method: 'POST',
            body: { ...body, captcha },
            expected: purpose === 'register' ? 201 : 200,
            rawRegistration: true,
          });
          assert.ok(success.token);
          if (purpose === 'register') {
            const [[agreement]] = await db.execute(
              'SELECT agreement_version FROM user_community_agreements WHERE user_id = ?',
              [success.user.id],
            );
            assert.equal(agreement.agreement_version, COMMUNITY_AGREEMENT_VERSION);
          }
          assert.equal(
            (
              await api(route, {
                method: 'POST',
                body: { ...body, captcha },
                expected: 400,
                rawRegistration: true,
              })
            ).code,
            `${prefix}_captcha_used`,
          );
        }
        const expired = await challengeFor('login', 'admin', 'wien');
        await db.execute(
          'UPDATE registration_challenges SET expires_at = NOW() - INTERVAL 1 SECOND WHERE id = ?',
          [expired.challengeId],
        );
        assert.equal(
          (
            await api('/auth/login', {
              method: 'POST',
              body: { identifier: 'admin', password: 'free-bbs', captcha: solveChallenge(expired) },
              expected: 400,
            })
          ).code,
          'login_captcha_expired',
        );
        const wrongPassword = await challengeFor('login', 'admin', 'wien');
        const loginBody = {
          identifier: 'admin',
          password: 'wrong-password',
          captcha: solveChallenge(wrongPassword),
        };
        await api('/auth/login', { method: 'POST', body: loginBody, expected: 401 });
        assert.equal(
          (
            await api('/auth/login', {
              method: 'POST',
              body: { ...loginBody, password: 'free-bbs' },
              expected: 400,
            })
          ).code,
          'login_captcha_used',
        );
        // Expired challenge cleanup must cascade, leaving no orphaned circuit data.
        await db.execute('DELETE FROM registration_challenges WHERE id = ?', [expired.challengeId]);
        const [[remaining]] = await db.execute(
          'SELECT COUNT(*) AS count FROM registration_challenge_circuits WHERE challenge_id = ?',
          [expired.challengeId],
        );
        assert.equal(remaining.count, 0);
      },
    );

    const [[course]] = await db.query('SELECT id,slug FROM courses ORDER BY id LIMIT 1');
    await db.execute('INSERT INTO course_material_managers (course_id,user_id) VALUES (?,?)', [
      course.id,
      legacy.id,
    ]);
    await t.test(
      'course owners of any role may upload; tokens preserve sections and obey revocation',
      async () => {
        const issued = await api('/course-upload/tokens', {
          token: legacy.token,
          method: 'POST',
          body: { name: 'agent test', expiresInDays: 1 },
          expected: 201,
        });
        const forbidden = await api('/course-upload/tokens', {
          token: outsider.token,
          method: 'POST',
          body: { name: 'outsider', expiresInDays: 1 },
          expected: 201,
        });
        const route = `/course-upload/courses/${course.slug}/nodes/TEST-001`;
        await api(route, {
          token: forbidden.token,
          method: 'PUT',
          body: { title: '不允许' },
          expected: 403,
        });
        await api(route, {
          token: issued.token,
          method: 'PUT',
          body: {
            title: 'API 知识点',
            position: { x: 120, y: 240 },
            sections: { knowledgeMarkdown: '原文', applicationsMarkdown: '保留应用' },
          },
          expected: 201,
        });
        await api(route, {
          token: issued.token,
          method: 'PUT',
          body: { sections: { knowledgeMarkdown: '修订正文' } },
        });
        const result = await api(route, { token: issued.token });
        assert.equal(result.node.sections.applicationsMarkdown, '保留应用');
        assert.deepEqual(result.node.position, { x: 120, y: 240 });
        const uploaded = await api(`/course-upload/courses/${course.slug}/files`, {
          token: issued.token,
          method: 'POST',
          body: {
            fileName: 'course-notes.txt',
            contentBase64: Buffer.from('课程笔记').toString('base64'),
          },
          expected: 201,
        });
        const download = await fetch(`${base.replace(/\/api$/, '')}${uploaded.file.url}`);
        assert.equal(download.status, 200);
        assert.match(download.headers.get('content-disposition'), /^attachment/);
        assert.equal(await download.text(), '课程笔记');
        const [[fileRow]] = await db.query(
          'SELECT stored_name FROM course_uploaded_files WHERE id = ?',
          [uploaded.file.id],
        );
        for (const directory of [
          'course-agent-files/',
          '%63ourse-agent-files/',
          '/course-agent-files/',
          'course-agent-files%2f',
          'COURSE-AGENT-FILES/',
        ]) {
          const blocked = await fetch(
            `${base.replace(/\/api$/, '')}/uploads/${directory}${fileRow.stored_name}`,
          );
          assert.equal(blocked.status, 404, `static documents must be inaccessible: ${directory}`);
        }
        await api(`/course-upload/tokens/${issued.id}`, { token: legacy.token, method: 'DELETE' });
        await api(route, { token: issued.token, expected: 401 });
      },
    );

    await t.test(
      'Agent CLI publishes knowledge points and connections visible on the course map',
      async (cliTest) => {
        const issued = await api('/course-upload/tokens', {
          token: legacy.token,
          method: 'POST',
          body: { name: 'knowledge point CLI test', expiresInDays: 1 },
          expected: 201,
        });
        const forbidden = await api('/course-upload/tokens', {
          token: outsider.token,
          method: 'POST',
          body: { name: 'unauthorized CLI test', expiresInDays: 1 },
          expected: 201,
        });
        cliTest.after(async () => {
          await db.execute(
            'INSERT IGNORE INTO course_material_managers (course_id,user_id) VALUES (?,?)',
            [course.id, legacy.id],
          );
          await db.execute(
            'UPDATE course_upload_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id IN (?, ?)',
            [issued.id, forbidden.id],
          );
        });

        async function cli(args, token = issued.token, expectedExit = 0) {
          let output;
          let exitCode = 0;
          try {
            output = await runProgram(
              process.env.PYTHON || 'python3',
              [
                '-B',
                path.join(root, 'skills/freebbs-course-upload/scripts/freebbs_course_upload.py'),
                ...args,
              ],
              {
                cwd: root,
                env: {
                  ...process.env,
                  FREEBBS_BASE_URL: base.replace(/\/api$/, ''),
                  FREEBBS_UPLOAD_TOKEN: token,
                  NO_PROXY: '127.0.0.1,localhost',
                  no_proxy: '127.0.0.1,localhost',
                },
                timeout: 10000,
                maxBuffer: 2 * 1024 * 1024,
              },
            );
          } catch (error) {
            output = error;
            exitCode = error.code;
          }
          assert.equal(output.stdout.includes(token), false, 'CLI stdout must not disclose Token');
          assert.equal(output.stderr.includes(token), false, 'CLI stderr must not disclose Token');
          assert.equal(exitCode, expectedExit, `${args[0]}: ${output.stderr}`);
          return expectedExit ? output.stderr : JSON.parse(output.stdout);
        }

        const nodeId = 'AGENT-CLI-001';
        const nextNodeId = 'AGENT-CLI-002';
        const knowledgeFile = path.join(temp, '知识正文.md');
        const basicInfoFile = path.join(temp, '基本信息.md');
        const applicationsFile = path.join(temp, '应用场景.md');
        const originalKnowledge = '## 卷积\n\n$$y(t) = x(t) * h(t)$$\n';
        const basicInfo = '## 基本信息\n\n建议学习时长：20 分钟。\n';
        const applications = '## 应用\n\n用于分析线性时不变系统。\n';
        await Promise.all([
          fs.writeFile(knowledgeFile, originalKnowledge),
          fs.writeFile(basicInfoFile, basicInfo),
          fs.writeFile(applicationsFile, applications),
        ]);
        const created = await cli([
          'upload-node',
          course.slug,
          nodeId,
          knowledgeFile,
          '--title',
          'Agent 发布的知识点',
          '--summary',
          '卷积的定义与应用',
          '--basic-info',
          basicInfoFile,
          '--applications',
          applicationsFile,
          '--x',
          '420',
          '--y',
          '680',
          '--expected-revision',
          'new',
        ]);
        assert.equal(created.created, true);
        assert.equal(created.node.title, 'Agent 发布的知识点');
        assert.equal(created.node.summary, '卷积的定义与应用');
        assert.deepEqual(created.node.position, { x: 420, y: 680 });
        assert.deepEqual(created.node.sections, {
          knowledgeMarkdown: originalKnowledge,
          basicInfoMarkdown: basicInfo,
          applicationsMarkdown: applications,
        });

        const revisedKnowledge = '## 卷积\n\n修订：卷积具有交换律。\n';
        await fs.writeFile(knowledgeFile, revisedKnowledge);
        const updated = await cli(['upload-node', course.slug, nodeId, knowledgeFile]);
        assert.equal(updated.created, false);
        assert.equal(updated.node.sections.knowledgeMarkdown, revisedKnowledge);
        assert.equal(updated.node.sections.basicInfoMarkdown, basicInfo);
        assert.equal(updated.node.sections.applicationsMarkdown, applications);
        assert.equal(updated.node.title, created.node.title);
        assert.equal(updated.node.summary, created.node.summary);
        assert.deepEqual(updated.node.position, created.node.position);
        assert.notEqual(updated.node.revision, created.node.revision);

        await cli([
          'upload-node',
          course.slug,
          nextNodeId,
          knowledgeFile,
          '--title',
          '后续知识点',
          '--x',
          '620',
          '--y',
          '680',
        ]);
        const connected = await cli(['connect', course.slug, nodeId, nextNodeId]);
        assert.deepEqual(connected.edge, { source: nodeId, target: nextNodeId, type: 'ordered' });
        const map = await cli(['map', course.slug]);
        assert.equal(map.course.canEditMap, true);
        assert.ok(
          map.nodes.some((node) => node.id === nodeId && node.title === created.node.title),
        );
        assert.ok(map.nodes.some((node) => node.id === nextNodeId));
        assert.ok(
          map.edges.some(
            (edge) =>
              edge.source === nodeId && edge.target === nextNodeId && edge.type === 'ordered',
          ),
        );
        const publicMap = await api(`/courses/${course.slug}/map`);
        assert.ok(publicMap.nodes.some((node) => node.id === nodeId));
        assert.ok(
          publicMap.edges.some((edge) => edge.source === nodeId && edge.target === nextNodeId),
        );
        const publicNodeRoute = `/courses/${course.slug}/map/nodes/${nodeId}`;
        const publicNode = await api(publicNodeRoute);
        assert.deepEqual(publicNode.node.sections, updated.node.sections);

        await fs.writeFile(knowledgeFile, '此内容不应覆盖已经发布的知识点。');
        const stale = await cli(
          [
            'upload-node',
            course.slug,
            nodeId,
            knowledgeFile,
            '--expected-revision',
            created.node.revision,
          ],
          issued.token,
          1,
        );
        assert.match(stale, /HTTP 409/);
        const current = await cli(['get-node', course.slug, nodeId]);
        assert.equal(current.node.revision, updated.node.revision);
        assert.deepEqual(current.node.sections, updated.node.sections);

        const denied = await cli(
          ['upload-node', course.slug, nodeId, knowledgeFile],
          forbidden.token,
          1,
        );
        assert.match(denied, /HTTP 403/);
        await db.execute(
          'DELETE FROM course_material_managers WHERE course_id = ? AND user_id = ?',
          [course.id, legacy.id],
        );
        for (const args of [
          ['upload-node', course.slug, nodeId, knowledgeFile],
          ['connect', course.slug, nextNodeId, nodeId],
          ['map', course.slug],
        ]) {
          assert.match(await cli(args, issued.token, 1), /HTTP 403/);
        }
        assert.deepEqual((await api(publicNodeRoute)).node.sections, updated.node.sections);
        assert.deepEqual((await api(`/courses/${course.slug}/map`)).edges, publicMap.edges);
      },
    );

    await t.test(
      'course owners edit knowledge sections atomically with shared revisions and preserved maps',
      async (editorTest) => {
        const nodeId = 'EDITOR-001';
        const route = `/courses/${course.slug}/map/nodes/${nodeId}`;
        await api(`/courses/${course.slug}/map/nodes`, {
          token: legacy.token,
          method: 'POST',
          body: {
            id: nodeId,
            title: '原地编辑测试',
            summary: '保留标题、简介和地图位置',
            position: { x: 160, y: 280 },
          },
          expected: 201,
        });
        const initial = await api(route, { token: legacy.token });
        assert.equal(initial.course.canEditMap, true, 'an assigned student may edit');
        assert.match(initial.node.revision, /^[a-f0-9]{64}$/);
        assert.equal((await api(route)).course.canEditMap, false);
        assert.equal((await api(route, { token: outsider.token })).course.canEditMap, false);
        const initialMap = await api(`/courses/${course.slug}/map`);
        const sections = {
          knowledgeMarkdown: '## 卷积\n\n**正文**与 $y(t)$。\n\n![示意图](/assets/logo.png)',
          basicInfoMarkdown: '建议学习时长：20 分钟。',
          applicationsMarkdown: '用于分析滤波器。',
        };
        for (const token of [undefined, outsider.token]) {
          await api(`${route}/document`, {
            token,
            method: 'PUT',
            body: { sections, expectedRevision: initial.node.revision },
            expected: token ? 403 : 401,
          });
        }
        async function ragRevision() {
          const [[row]] = await db.query(
            'SELECT requested_revision FROM rag_index_state WHERE id = 1',
          );
          return Number(row.requested_revision);
        }
        const beforeRevision = await ragRevision();
        const saved = await api(`${route}/document`, {
          token: legacy.token,
          method: 'PUT',
          body: { sections, expectedRevision: initial.node.revision },
        });
        assert.deepEqual(saved.sections, sections);
        assert.deepEqual(saved.node.sections, sections);
        assert.equal(saved.revision, saved.node.revision);
        assert.notEqual(saved.revision, initial.node.revision);
        assert.equal(await ragRevision(), beforeRevision + 1);
        const reread = await api(route);
        assert.deepEqual(reread.node.sections, sections);
        assert.equal(reread.node.revision, saved.revision);
        assert.equal(reread.node.title, initial.node.title);
        assert.equal(reread.node.summary, initial.node.summary);
        assert.deepEqual(reread.node.position, initial.node.position);
        const map = await api(`/courses/${course.slug}/map`);
        assert.deepEqual(map.edges, initialMap.edges);
        assert.deepEqual(
          map.nodes.map(({ id, position }) => ({ id, position })),
          initialMap.nodes.map(({ id, position }) => ({ id, position })),
        );
        const stale = await api(`${route}/document`, {
          token: legacy.token,
          method: 'PUT',
          body: {
            sections: { knowledgeMarkdown: '过期正文' },
            expectedRevision: initial.node.revision,
          },
          expected: 409,
        });
        assert.equal(stale.code, 'revision_conflict');
        assert.deepEqual((await api(route)).node.sections, sections);
        assert.equal(await ragRevision(), beforeRevision + 1);

        const partial = await api(`${route}/document`, {
          token: legacy.token,
          method: 'PUT',
          body: { sections: { knowledgeMarkdown: '只更新正文' }, expectedRevision: saved.revision },
        });
        assert.deepEqual(partial.sections, { ...sections, knowledgeMarkdown: '只更新正文' });
        const compatible = await api(`${route}/document`, {
          token: legacy.token,
          method: 'PUT',
          body: { markdown: '旧版地图编辑器仍可保存' },
        });
        assert.deepEqual(compatible.sections, {
          ...sections,
          knowledgeMarkdown: '旧版地图编辑器仍可保存',
        });

        const issued = await api('/course-upload/tokens', {
          token: legacy.token,
          method: 'POST',
          body: { name: 'editor conflict test', expiresInDays: 1 },
          expected: 201,
        });
        editorTest.after(async () => {
          await db.execute(
            'UPDATE course_upload_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?',
            [issued.id],
          );
          await db.query('DROP TRIGGER IF EXISTS reject_editor_rag_update');
        });
        const agentRoute = `/course-upload/courses/${course.slug}/nodes/${nodeId}`;
        const agentRead = await api(agentRoute, { token: issued.token });
        assert.equal(
          agentRead.node.revision,
          compatible.revision,
          'browser and Agent revisions agree',
        );
        const agentSaved = await api(agentRoute, {
          token: issued.token,
          method: 'PUT',
          body: {
            sections: { applicationsMarkdown: 'Agent 补充的应用' },
            expectedRevision: compatible.revision,
          },
        });
        await api(`${route}/document`, {
          token: legacy.token,
          method: 'PUT',
          body: { sections, expectedRevision: compatible.revision },
          expected: 409,
        });
        assert.deepEqual((await api(route)).node.sections, agentSaved.node.sections);

        const concurrentResults = await Promise.all(
          ['同时保存甲', '同时保存乙'].map(async (markdown) => {
            const response = await fetch(`${base}${route}/document`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${legacy.token}`,
              },
              body: JSON.stringify({
                sections: { knowledgeMarkdown: markdown },
                expectedRevision: agentSaved.node.revision,
              }),
            });
            return { status: response.status, body: await response.json() };
          }),
        );
        assert.deepEqual(concurrentResults.map(({ status }) => status).sort(), [200, 409]);
        const winner = concurrentResults.find(({ status }) => status === 200).body;
        assert.deepEqual((await api(route)).node.sections, winner.sections);

        const beforeFailure = await ragRevision();
        await db.query(
          "CREATE TRIGGER reject_editor_rag_update BEFORE UPDATE ON rag_index_state FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'editor rollback test'",
        );
        await api(`${route}/document`, {
          token: admin.token,
          method: 'PUT',
          body: { sections, expectedRevision: winner.revision },
          expected: 500,
        });
        await db.query('DROP TRIGGER reject_editor_rag_update');
        assert.deepEqual((await api(route)).node.sections, winner.sections);
        assert.equal((await api(route)).node.revision, winner.revision);
        assert.equal(await ragRevision(), beforeFailure);
        const [[stored]] = await db.query(
          'SELECT document_markdown FROM course_map_nodes WHERE course_id = ? AND node_id = ?',
          [course.id, nodeId],
        );
        assert.equal(stored.document_markdown, winner.sections.knowledgeMarkdown);
      },
    );

    await t.test(
      'announcements, reply and reaction notifications preserve recipients and queue email',
      async () => {
        await api('/admin/notifications', {
          token: outsider.token,
          method: 'POST',
          body: {},
          expected: 403,
        });
        await api('/admin/notifications', {
          token: admin.token,
          method: 'POST',
          body: {
            title: '课程负责人通知',
            body: '请更新资料',
            audience: { type: 'course', courseId: course.id },
          },
          expected: 201,
        });
        const list = await api('/notifications', { token: legacy.token });
        assert.equal(list.notifications.length, 1);
        assert.equal(list.unreadCount, 1);
        await api(`/notifications/${list.notifications[0].id}/read`, {
          token: outsider.token,
          method: 'POST',
          expected: 404,
        });
        await api('/notifications/read-all', { token: legacy.token, method: 'POST' });
        const unread = await api('/notifications/unread-count', { token: legacy.token });
        assert.equal(unread.unreadCount, 0);
        const posted = await api('/discussion/posts', {
          token: legacy.token,
          method: 'POST',
          body: { boardSlug: 'daily', title: '通知测试', contentMarkdown: '讨论内容' },
          expected: 201,
        });
        const key = posted.post.pid || posted.post.id;
        for (let index = 0; index < 3; index += 1)
          await api(`/discussion/posts/${key}/like`, {
            token: outsider.token,
            method: 'POST',
            body: { reactionType: 'smile' },
          });
        await api(`/discussion/posts/${key}/comments`, {
          token: outsider.token,
          method: 'POST',
          body: { contentMarkdown: '回复内容' },
          expected: 201,
        });
        const received = await api('/notifications', { token: legacy.token });
        assert.equal(received.notifications.filter((item) => item.kind === 'reaction').length, 1);
        assert.equal(received.notifications.filter((item) => item.kind === 'reply').length, 1);
        const [[queued]] = await db.query(
          'SELECT COUNT(*) AS count FROM notification_email_outbox',
        );
        assert.equal(Number(queued.count), 3);
        const [[original]] = await db.query('SELECT COUNT(*) AS count FROM notifications');
        assert.ok(original.count > 0, 'existing workbench notifications remain intact');
      },
    );
  },
);
