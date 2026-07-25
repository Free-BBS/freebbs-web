const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const mysql = require('mysql2/promise');

const projectRoot = path.resolve(__dirname, '..');
const shouldRun = process.env.RUN_SYSTEM_SETTINGS_INTEGRATION === '1';

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForBackend({ port, socketPath, getLogs }) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    try {
      const [socketStats, healthResponse] = await Promise.all([
        fs.promises.stat(socketPath),
        fetch(`http://127.0.0.1:${port}/api/health`),
      ]);

      if (socketStats.isSocket() && healthResponse.ok) {
        return;
      }
    } catch {
      // The backend performs database maintenance before opening the internal socket.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(`Backend did not become ready:\n${getLogs()}`);
}

function requestUnixSocket(socketPath, { headers = {}, method = 'GET', requestPath }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath,
        path: requestPath,
        method,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            body: body ? JSON.parse(body) : {},
            headers: response.headers,
            status: response.statusCode,
          });
        });
      },
    );

    request.once('error', reject);
    request.end();
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { body, response };
}

test(
  'keeps model secrets off the public API and serves them through authenticated UDS only',
  { skip: !shouldRun },
  async (t) => {
    const suffix = crypto.randomBytes(6).toString('hex');
    const databaseName = `free_bbs_settings_test_${suffix}`;
    const temporaryRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'free-bbs-settings-integration-'),
    );
    const courseRoot = path.join(temporaryRoot, 'courses');
    const socketPath = path.join(temporaryRoot, 'agent-config.sock');
    const serviceToken = `integration-agent-token-${crypto.randomBytes(24).toString('hex')}`;
    const encryptionKey = crypto.randomBytes(32).toString('base64');
    const apiPort = await reservePort();
    const mysqlOptions = {
      host: process.env.TEST_MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.TEST_MYSQL_PORT || 3306),
      user: process.env.TEST_MYSQL_USER || 'root',
      password: process.env.TEST_MYSQL_PASSWORD || '',
      multipleStatements: true,
    };
    const databaseConnection = await mysql.createConnection(mysqlOptions);
    let backendProcess;
    let backendLogs = '';

    t.after(async () => {
      if (backendProcess && backendProcess.exitCode === null) {
        backendProcess.kill('SIGTERM');
      }

      await databaseConnection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await databaseConnection.end();
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    });

    await fs.promises.mkdir(courseRoot);
    const realCourseRoot = await fs.promises.realpath(courseRoot);

    const schemaSource = await fs.promises.readFile(
      path.join(projectRoot, 'database', 'schema.sql'),
      'utf8',
    );
    const seedSource = await fs.promises.readFile(
      path.join(projectRoot, 'database', 'seed.sql'),
      'utf8',
    );
    const migrationSource = await fs.promises.readFile(
      path.join(projectRoot, 'database', 'migrations', '016_create_system_secret_settings.sql'),
      'utf8',
    );

    await databaseConnection.query(schemaSource.replaceAll('free_bbs', databaseName));
    await databaseConnection.query(seedSource.replaceAll('free_bbs', databaseName));
    await databaseConnection.query(migrationSource);

    backendProcess = spawn(process.execPath, ['backend/server.js'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        API_HOST: '127.0.0.1',
        API_PORT: String(apiPort),
        BACKEND_IP: mysqlOptions.host,
        MYSQL_PORT: String(mysqlOptions.port),
        MYSQL_USER: mysqlOptions.user,
        MYSQL_PASSWORD: mysqlOptions.password,
        MYSQL_DATABASE: databaseName,
        AUTH_SECRET: `integration-auth-${crypto.randomBytes(24).toString('hex')}`,
        AGENT_SERVICE_TOKEN: serviceToken,
        AGENT_SETTINGS_REQUIRED: 'true',
        AGENT_SETTINGS_SOCKET: socketPath,
        SETTINGS_ENCRYPTION_KEY: encryptionKey,
        LLM_BASE_URL: 'https://api.example.test/v1',
        LLM_MODEL: 'default-model',
        COURSE_MATERIALS_ALLOWED_ROOT: temporaryRoot,
        COURSE_MATERIALS_ROOT: courseRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProcess.stdout.on('data', (chunk) => {
      backendLogs += chunk.toString('utf8');
    });
    backendProcess.stderr.on('data', (chunk) => {
      backendLogs += chunk.toString('utf8');
    });

    await waitForBackend({
      port: apiPort,
      socketPath,
      getLogs: () => backendLogs,
    });
    const health = await fetchJson(`http://127.0.0.1:${apiPort}/api/health`);
    assert.equal(health.response.status, 200);
    assert.equal(health.body.agentSettingsApi, 'ready');
    // File-type bits are intentionally masked to assert the socket's permission bits.
    // eslint-disable-next-line no-bitwise
    const socketMode = (await fs.promises.stat(socketPath)).mode & 0o777;
    assert.equal(socketMode, 0o660);

    const login = await fetchJson(`http://127.0.0.1:${apiPort}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'admin',
        password: 'free-bbs',
      }),
    });
    assert.equal(login.response.status, 200);
    const authorization = `Bearer ${login.body.token}`;
    const adminHeaders = {
      Authorization: authorization,
      'Content-Type': 'application/json',
    };

    const createdTeacher = await fetchJson(`http://127.0.0.1:${apiPort}/api/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        username: 'integration_teacher',
        fullName: 'Integration Teacher',
        studentId: '2098000001',
        email: 'integration-teacher@example.test',
        password: 'integration-password',
        role: 'teacher',
      }),
    });
    assert.equal(createdTeacher.response.status, 201);
    assert.equal(createdTeacher.body.user.role, 'teacher');

    const teacherLogin = await fetchJson(`http://127.0.0.1:${apiPort}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'integration_teacher',
        password: 'integration-password',
      }),
    });
    assert.equal(teacherLogin.response.status, 200);
    const forbiddenSettings = await fetch(
      `http://127.0.0.1:${apiPort}/api/admin/system-settings/model`,
      {
        headers: {
          Authorization: `Bearer ${teacherLogin.body.token}`,
        },
      },
    );
    assert.equal(forbiddenSettings.status, 403);

    const initialModel = await fetchJson(
      `http://127.0.0.1:${apiPort}/api/admin/system-settings/model`,
      { headers: adminHeaders },
    );
    assert.equal(initialModel.response.status, 200);
    assert.equal(initialModel.body.configured, false);
    assert.equal(Object.hasOwn(initialModel.body, 'apiKey'), false);

    const apiKey = 'sk-integration-private-12345678';
    const updatedModel = await fetchJson(
      `http://127.0.0.1:${apiPort}/api/admin/system-settings/model`,
      {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ apiKey }),
      },
    );
    assert.equal(updatedModel.response.status, 200);
    assert.equal(updatedModel.body.configured, true);
    assert.equal(updatedModel.body.lastFour, '5678');
    assert.equal(updatedModel.body.baseUrl, 'https://api.example.test/v1');
    assert.equal(updatedModel.body.model, 'default-model');
    assert.equal(Object.hasOwn(updatedModel.body, 'apiKey'), false);

    const rejectedEndpointChange = await fetchJson(
      `http://127.0.0.1:${apiPort}/api/admin/system-settings/model`,
      {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ baseUrl: 'http://127.0.0.1:65535/v1' }),
      },
    );
    assert.equal(rejectedEndpointChange.response.status, 400);
    assert.equal(rejectedEndpointChange.body.code, 'MODEL_ENDPOINT_MANAGED_BY_DEPLOYMENT');

    const [secretRows] = await databaseConnection.query(
      `SELECT ciphertext
       FROM system_secret_settings
       WHERE setting_key = 'llm_api_key'`,
    );
    assert.equal(secretRows.length, 1);
    assert.equal(secretRows[0].ciphertext.includes(Buffer.from(apiKey)), false);

    const unauthorizedInternal = await requestUnixSocket(socketPath, {
      requestPath: '/internal/v1/agent-config',
    });
    assert.equal(unauthorizedInternal.status, 401);

    const internalConfig = await requestUnixSocket(socketPath, {
      requestPath: '/internal/v1/agent-config',
      headers: { Authorization: `Bearer ${serviceToken}` },
    });
    assert.equal(internalConfig.status, 200);
    assert.match(internalConfig.headers['cache-control'], /no-store/u);
    assert.equal(internalConfig.body.apiKey, apiKey);
    assert.equal(internalConfig.body.baseUrl, 'https://api.example.test/v1');
    assert.equal(internalConfig.body.model, 'default-model');
    assert.equal(internalConfig.body.courseMaterialsRoot, realCourseRoot);
    assert.equal(Number.isInteger(internalConfig.body.revision), true);

    const publicInternal = await fetch(`http://127.0.0.1:${apiPort}/internal/v1/agent-config`);
    assert.equal(publicInternal.status, 404);

    const courseSettings = await fetchJson(
      `http://127.0.0.1:${apiPort}/api/admin/system-settings/course-materials`,
      {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ rootDirectory: courseRoot }),
      },
    );
    assert.equal(courseSettings.response.status, 200);
    assert.equal(courseSettings.body.rootDirectory, realCourseRoot);
    assert.equal(courseSettings.body.courseMaterialsRoot, realCourseRoot);

    const lastAdminChange = await fetch(
      `http://127.0.0.1:${apiPort}/api/admin/users/${login.body.user.id}/role`,
      {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ role: 'student' }),
      },
    );
    assert.equal(lastAdminChange.status, 409);

    const deletedKey = await fetchJson(
      `http://127.0.0.1:${apiPort}/api/admin/system-settings/model/api-key`,
      {
        method: 'DELETE',
        headers: adminHeaders,
      },
    );
    assert.equal(deletedKey.response.status, 200);
    assert.equal(deletedKey.body.configured, false);

    const missingInternalConfig = await requestUnixSocket(socketPath, {
      requestPath: '/internal/v1/agent-config',
      headers: { Authorization: `Bearer ${serviceToken}` },
    });
    assert.equal(missingInternalConfig.status, 503);
    assert.equal(missingInternalConfig.body.error.code, 'agent_config_missing');

    const createdAdmin = await fetchJson(`http://127.0.0.1:${apiPort}/api/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        username: 'integration_admin_two',
        fullName: 'Integration Admin Two',
        studentId: '2098000002',
        email: 'integration-admin-two@example.test',
        password: 'integration-password',
        role: 'admin',
      }),
    });
    assert.equal(createdAdmin.response.status, 201);

    const secondAdminLogin = await fetchJson(`http://127.0.0.1:${apiPort}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'integration_admin_two',
        password: 'integration-password',
      }),
    });
    assert.equal(secondAdminLogin.response.status, 200);

    await Promise.all([
      fetch(`http://127.0.0.1:${apiPort}/api/admin/users/${createdAdmin.body.user.id}/role`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ role: 'student' }),
      }),
      fetch(`http://127.0.0.1:${apiPort}/api/admin/users/${login.body.user.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${secondAdminLogin.body.token}`,
        },
      }),
    ]);

    const [adminCountRows] = await databaseConnection.query(
      `SELECT COUNT(*) AS count
       FROM users
       WHERE role = 'admin'`,
    );
    assert.equal(Number(adminCountRows[0].count) >= 1, true);
  },
);
