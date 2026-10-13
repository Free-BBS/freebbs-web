const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDevelopmentAuthClient,
  createDevelopmentDatabaseConfig,
  createDevelopmentUserDirectory,
  initializeDevelopmentRuntime,
  readDevelopmentMapTokenDigest,
} = require('./development-integration');

test('Map verifier loading is bounded and optional without affecting existing backend configuration', async () => {
  const { mkdtemp, writeFile, rm } = require('node:fs/promises');
  const path = require('node:path');
  const { tmpdir } = require('node:os');
  const root = await mkdtemp(path.join(tmpdir(), 'development-map-verifier-'));
  try {
    assert.equal(await readDevelopmentMapTokenDigest(root), undefined);
    const filename = path.join(root, '.development-map-token.sha256');
    for (const invalid of ['', 'a'.repeat(63), 'not-a-verifier', 'a'.repeat(4096)]) {
      await writeFile(filename, invalid);
      assert.equal(await readDevelopmentMapTokenDigest(root), undefined);
    }
    const digest = 'abc123'.repeat(10) + 'abcd';
    await writeFile(filename, `${digest}\n`);
    assert.equal(await readDevelopmentMapTokenDigest(root), digest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('development data uses a peer database schema while inheriting the main server connection', () => {
  const main = {
    host: 'mysql.internal',
    port: 3306,
    user: 'freebbs',
    password: 'secret',
    database: 'free_bbs',
    socketPath: '/run/mysqld/mysqld.sock',
  };

  assert.deepEqual(createDevelopmentDatabaseConfig(main, {}), {
    ...main,
    database: 'free_bbs_development',
  });
  assert.deepEqual(
    createDevelopmentDatabaseConfig(main, {
      DEVELOPMENT_MYSQL_HOST: 'development-db.internal',
      DEVELOPMENT_MYSQL_PORT: '3307',
      DEVELOPMENT_MYSQL_USER: 'development',
      DEVELOPMENT_MYSQL_PASSWORD: 'development-secret',
      DEVELOPMENT_MYSQL_DATABASE: 'development_data',
      DEVELOPMENT_MYSQL_SOCKET: '/tmp/development.sock',
    }),
    {
      host: 'development-db.internal',
      port: 3307,
      user: 'development',
      password: 'development-secret',
      database: 'development_data',
      socketPath: '/tmp/development.sock',
    },
  );
});

test('development auth adapter accepts only a verified main-site account', async () => {
  const client = createDevelopmentAuthClient({
    verifyToken: (token) => (token === 'valid' ? { sub: 7 } : null),
    getUserById: async (id) =>
      id === 7
        ? {
            id,
            uid: 'u_yuchong',
            username: 'Yuchong',
            student_id: '2023010567',
            avatar_path: '/avatar.png',
          }
        : null,
    toUserProfile: (row) => ({
      uid: row.uid,
      username: row.username,
      studentId: row.student_id,
      avatarPath: row.avatar_path,
      isAdmin: true,
    }),
  });

  assert.equal(await client.introspect('invalid'), null);
  assert.deepEqual(await client.introspect('valid'), {
    uid: 'u_yuchong',
    username: 'Yuchong',
    studentId: '2023010567',
    displayName: 'Yuchong',
    avatarUrl: '/avatar.png',
    baseRole: 'student',
    roles: [],
    tags: [],
    mainSiteAdmin: true,
  });
});

test('development auth adapter does not coerce an untrusted admin-like value', async () => {
  const client = createDevelopmentAuthClient({
    verifyToken: () => ({ sub: 8 }),
    getUserById: async () => ({ id: 8, uid: 'u_member', username: 'Member' }),
    toUserProfile: (row) => ({
      uid: row.uid,
      username: row.username,
      isAdmin: 'true',
    }),
  });

  assert.equal((await client.introspect('valid')).mainSiteAdmin, false);
});

test('development directory exposes a read-only user projection with escaped search', async () => {
  let captured;
  const directory = createDevelopmentUserDirectory({
    execute: async (sql, parameters) => {
      captured = { sql, parameters };
      return [
        [
          {
            uid: 'u_1',
            username: '同学',
            full_name: '姓名',
            student_id: '2023000001',
            avatar_path: null,
          },
        ],
      ];
    },
  });

  assert.deepEqual(await directory.list(' 100%_ '), [
    {
      uid: 'u_1',
      username: '同学',
      displayName: '同学',
      studentId: '2023000001',
      avatarUrl: null,
    },
  ]);
  assert.deepEqual(captured.parameters, [
    '100%_',
    '%100!%!_%',
    '%100!%!_%',
    '%100!%!_%',
    '%100!%!_%',
  ]);
  assert.match(captured.sql, /LIMIT 2000/);
  assert.doesNotMatch(captured.sql, /email|password|is_admin/i);
});

test('development initialization failure does not prevent the main backend from starting', async () => {
  const failure = new Error('development database is not ready');
  const reports = [];

  const runtime = await initializeDevelopmentRuntime(
    { repositoryRoot: '/srv/free-bbs' },
    {
      loader: async () => {
        throw failure;
      },
      reportError: (...arguments_) => reports.push(arguments_),
    },
  );

  assert.equal(runtime, null);
  assert.equal(reports.length, 1);
  assert.match(reports[0][0], /development API will remain unavailable/);
  assert.equal(reports[0][1], failure);
});

test('runtime loader forwards the optional development reward provider without invoking it', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
  const path = require('node:path');
  const { tmpdir } = require('node:os');
  const { loadDevelopmentRuntime } = require('./development-integration');
  const root = await mkdtemp(path.join(tmpdir(), 'development-provider-'));
  try {
    const dist = path.join(root, 'development', 'apps', 'api', 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(
      path.join(dist, 'integrated-runtime.js'),
      'export function createIntegratedDevelopmentRuntime(options) { return options; }',
    );
    const provider = {
      async grant() {
        throw new Error('must not run at initialization');
      },
    };
    const learningProvider = async () => { throw new Error('must not query learning at initialization'); };
    const digest = 'b'.repeat(64);
    await writeFile(path.join(root, '.development-map-token.sha256'), digest);
    const options = await loadDevelopmentRuntime({
      repositoryRoot: root,
      developmentRewardProvider: provider,
      learningAchievementProvider: learningProvider,
    });
    assert.equal(options.developmentRewardProvider, provider);
    assert.equal(options.learningAchievementProvider, learningProvider);
    assert.equal(options.developmentMapTokenDigest, digest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
