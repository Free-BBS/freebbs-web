const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDevelopmentAuthClient,
  createDevelopmentBannerReactionsDirectory,
  createDevelopmentBannerReactionsStorageOptions,
  createDevelopmentDatabaseConfig,
  createDevelopmentUserDirectory,
  initializeDevelopmentRuntime,
  readDevelopmentMapTokenDigest,
} = require('./development-integration');

test('banner reactions default to a stable private sibling and honor trimmed explicit configuration', () => {
  const path = require('node:path');
  const uploads = path.resolve('database/uploads');
  const expected = path.join(path.dirname(uploads), 'banner-reactions-private');
  for (const environment of [
    {},
    { BANNER_REACTIONS_DATA_DIR: '' },
    { BANNER_REACTIONS_DATA_DIR: '   ' },
  ]) {
    assert.equal(createDevelopmentBannerReactionsDirectory(uploads, environment), expected);
    assert.equal(
      createDevelopmentBannerReactionsDirectory('database/uploads', environment),
      expected,
    );
  }
  const override = path.resolve('private-volume/reactions');
  assert.equal(
    createDevelopmentBannerReactionsDirectory(uploads, {
      BANNER_REACTIONS_DATA_DIR: `  ${override}  `,
    }),
    override,
  );
  // Explicit paths remain subject to the canonical API validator, never made safe by coercion.
  assert.equal(
    createDevelopmentBannerReactionsDirectory(uploads, {
      BANNER_REACTIONS_DATA_DIR: 'relative/private',
    }),
    'relative/private',
  );
});

test('integrated banner default matches provision regardless of public uploads and preserves legacy records', async () => {
  const { mkdtemp, mkdir, writeFile, readdir, rm } = require('node:fs/promises');
  const path = require('node:path');
  const { tmpdir } = require('node:os');
  const root = await mkdtemp(path.join(tmpdir(), 'banner-directory-resolution-'));
  try {
    const repositoryRoot = path.join(root, 'repository');
    const uploads = path.join(root, 'external-volume', 'uploads');
    const canonical = path.join(repositoryRoot, 'database/banner-reactions-private');
    const legacy = path.join(root, 'external-volume/banner-reactions-private');
    assert.deepEqual(createDevelopmentBannerReactionsStorageOptions(uploads, repositoryRoot, {}), {
      bannerReactionsDirectory: canonical,
    });
    // An empty former directory is not evidence that counters live there.
    await mkdir(path.join(legacy, 'banner-reactions'), { recursive: true });
    await writeFile(path.join(legacy, 'banner-reactions/ignored.tmp'), 'unfinished');
    assert.equal(
      createDevelopmentBannerReactionsStorageOptions(uploads, repositoryRoot, {})
        .bannerReactionsDirectory,
      canonical,
    );
    const recordName = `${'a'.repeat(64)}.json`;
    await writeFile(path.join(legacy, 'banner-reactions', recordName), '{"existing":"legacy"}');
    assert.deepEqual(createDevelopmentBannerReactionsStorageOptions(uploads, repositoryRoot, {}), {
      bannerReactionsDirectory: legacy,
    });
    await mkdir(path.join(canonical, 'banner-reactions'), { recursive: true });
    await writeFile(
      path.join(canonical, 'banner-reactions', recordName),
      '{"existing":"canonical"}',
    );
    assert.deepEqual(createDevelopmentBannerReactionsStorageOptions(uploads, repositoryRoot, {}), {
      bannerReactionsDirectory: canonical,
      bannerReactionsConfigurationIssue: 'ambiguous_storage',
    });
    for (const explicit of [legacy, canonical, 'relative/private'])
      assert.deepEqual(
        createDevelopmentBannerReactionsStorageOptions(uploads, repositoryRoot, {
          BANNER_REACTIONS_DATA_DIR: `  ${explicit}  `,
        }),
        { bannerReactionsDirectory: explicit },
      );
    assert.deepEqual(await readdir(path.join(legacy, 'banner-reactions')), [
      recordName,
      'ignored.tmp',
    ]);
    assert.deepEqual(await readdir(path.join(canonical, 'banner-reactions')), [recordName]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('does not mistake a public-upload parent alias for two independent reaction stores', async () => {
  const { mkdtemp, mkdir, writeFile, symlink, rm } = require('node:fs/promises');
  const path = require('node:path');
  const { tmpdir } = require('node:os');
  const root = await mkdtemp(path.join(tmpdir(), 'banner-directory-alias-'));
  try {
    const repositoryRoot = path.join(root, 'repository');
    const database = path.join(repositoryRoot, 'database');
    const canonical = path.join(database, 'banner-reactions-private');
    await mkdir(path.join(canonical, 'banner-reactions'), { recursive: true });
    await writeFile(
      path.join(canonical, 'banner-reactions', `${'b'.repeat(64)}.json`),
      '{"count":1}',
    );
    const alias = path.join(root, 'database-alias');
    await symlink(database, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.deepEqual(
      createDevelopmentBannerReactionsStorageOptions(
        path.join(alias, 'uploads'),
        repositoryRoot,
        {},
      ),
      { bannerReactionsDirectory: canonical },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
    const digest = `${'abc123'.repeat(10)}abcd`;
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
      legacyLearningAdmin: false,
    },
  ]);
  assert.deepEqual(captured.parameters, [
    '100%_',
    '%100!%!_%',
    '%100!%!_%',
    '%100!%!_%',
    '%100!%!_%',
  ]);
  assert.doesNotMatch(captured.sql, /LIMIT 2000/);
  assert.doesNotMatch(captured.sql, /email|password/i);
  assert.match(captured.sql, /role, is_admin/);
});

test('directory legacy-learning-admin provenance uses physical user rows and never arbitrary projected flags', async () => {
  const rows = [
    { uid: 'physical-admin', username: 'physical', is_admin: 1, role: 'student' },
    { uid: 'legacy-role', username: 'legacy', is_admin: 0, role: 'admin' },
    {
      uid: 'ordinary',
      username: 'ordinary',
      is_admin: 0,
      role: 'student',
      learningAdmin: true,
      rootAdmin: true,
    },
  ];
  const directory = createDevelopmentUserDirectory({
    execute: async (sql, parameters) => {
      assert.doesNotMatch(sql, /UPDATE|INSERT|DELETE/i);
      if (sql.includes('COUNT(*)')) return [[{ total: rows.length }]];
      if (sql.includes('WHERE uid = ?')) return [[rows.find((row) => row.uid === parameters[0])]];
      return [rows];
    },
  });
  assert.deepEqual(
    (await directory.list()).map((user) => user.legacyLearningAdmin),
    [true, true, false],
  );
  assert.deepEqual(
    (await directory.page()).items.map((user) => user.legacyLearningAdmin),
    [true, true, false],
  );
  assert.equal((await directory.get('ordinary')).legacyLearningAdmin, false);
  assert.equal((await directory.get('physical-admin')).legacyLearningAdmin, true);
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

test('runtime loader forwards private banner storage and optional providers without invoking them', async () => {
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
    const learningProvider = async () => {
      throw new Error('must not query learning at initialization');
    };
    const digest = 'b'.repeat(64);
    await writeFile(path.join(root, '.development-map-token.sha256'), digest);
    const publicUploadDirectory = path.join(root, 'database', 'uploads');
    const bannerReactionsDirectory = createDevelopmentBannerReactionsDirectory(
      publicUploadDirectory,
      {},
    );
    const options = await loadDevelopmentRuntime({
      repositoryRoot: root,
      publicUploadDirectory,
      bannerReactionsDirectory,
      bannerReactionsConfigurationIssue: 'ambiguous_storage',
      developmentRewardProvider: provider,
      learningAchievementProvider: learningProvider,
    });
    assert.equal(options.developmentRewardProvider, provider);
    assert.equal(options.learningAchievementProvider, learningProvider);
    assert.equal(options.developmentMapTokenDigest, digest);
    assert.equal(options.publicUploadDirectory, publicUploadDirectory);
    assert.equal(options.bannerReactionsDirectory, bannerReactionsDirectory);
    assert.equal(options.bannerReactionsConfigurationIssue, 'ambiguous_storage');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime loader preserves the private finance directory and public upload boundary independently', async () => {
  const { mkdtemp, mkdir, writeFile, rm, readFile } = require('node:fs/promises');
  const path = require('node:path');
  const { tmpdir } = require('node:os');
  const { loadDevelopmentRuntime } = require('./development-integration');
  const root = await mkdtemp(path.join(tmpdir(), 'development-finance-boundary-'));
  try {
    const dist = path.join(root, 'development', 'apps', 'api', 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(
      path.join(dist, 'integrated-runtime.js'),
      'export function createIntegratedDevelopmentRuntime(options) { return options; }',
    );
    const financeDirectory = path.join(root, 'private-finance');
    const publicUploadDirectory = path.join(root, 'uploads');
    const options = await loadDevelopmentRuntime({
      repositoryRoot: root,
      financeDirectory,
      publicUploadDirectory,
    });
    assert.equal(options.financeDirectory, financeDirectory);
    assert.equal(options.publicUploadDirectory, publicUploadDirectory);
    assert.notEqual(options.financeDirectory, options.publicUploadDirectory);
    const unconfigured = await loadDevelopmentRuntime({ repositoryRoot: root });
    assert.equal(Object.hasOwn(unconfigured, 'financeDirectory'), false);
    assert.equal(Object.hasOwn(unconfigured, 'publicUploadDirectory'), false);
    const server = await readFile(path.join(__dirname, 'server.js'), 'utf8');
    assert.match(server, /financeDirectory:\s*process\.env\.FINANCE_DATA_DIR\?\.trim\(\)/);
    assert.match(server, /publicUploadDirectory:\s*config\.uploadDir/);
    assert.doesNotMatch(server, /financeDirectory:\s*path\.join\(config\.uploadDir/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('development directory pages beyond 2000 and counts matching users with identity filters', async () => {
  const calls = [];
  const directory = createDevelopmentUserDirectory({
    execute: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return sql.includes('COUNT(*)')
        ? [[{ total: 2105 }]]
        : [[{ uid: 'u_2001', username: 'late', student_id: null }]];
    },
  });
  const page = await directory.page({
    query: 'late',
    page: 101,
    pageSize: 20,
    include: { uids: ['u_2001'], studentIds: ['2023'], usernames: ['legacy'] },
  });
  assert.equal(page.total, 2105);
  assert.equal(page.items[0].uid, 'u_2001');
  assert.equal(page.page, 101);
  assert.match(calls[1].sql, /LIMIT 20 OFFSET 2000/);
  assert.match(calls[0].sql, /student_id IN/);
  assert.match(calls[0].sql, /COALESCE/);
  assert.ok(calls[0].parameters.includes('u_2001'));
});
