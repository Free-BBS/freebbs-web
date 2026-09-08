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

    async function api(route, { token, method = 'GET', body, expected = 200 } = {}) {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result)}`);
      return result;
    }
    async function login(identifier) {
      return api('/auth/login', { method: 'POST', body: { identifier, password: 'free-bbs' } });
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
