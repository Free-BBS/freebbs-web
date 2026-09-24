const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDevelopmentAuthClient,
  createDevelopmentDatabaseConfig,
  createDevelopmentUserDirectory,
} = require('./development-integration');

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
  });
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
