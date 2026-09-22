const assert = require('node:assert/strict');

// Never read application DB hosts, passwords or database names in this test helper.
function isolatedMysqlConfig(legacySocketEnvName, env = process.env) {
  const socketPath = env.FREEBBS_TEST_MYSQL_SOCKET || env[legacySocketEnvName];
  assert.equal(typeof socketPath, 'string', 'an explicit isolated MySQL socket is required');
  const pipe = /^\\\\\.\\pipe\\freebbs-(?:mysql-qa-[a-f0-9]{32}|[a-z0-9-]+-qa)$/i;
  const unix = /^\/tmp\/freebbs-mysql-qa-[a-zA-Z0-9]+\/mysql\.sock$/;
  assert.ok(
    pipe.test(socketPath) || unix.test(socketPath),
    'only a dedicated FREE BBS QA socket is allowed',
  );
  return { socketPath, user: 'root', password: '' };
}

async function assertIsolatedMysql(connection) {
  const [[server]] = await connection.query('SELECT @@skip_networking AS isolated');
  assert.equal(Number(server.isolated), 1, 'the disposable MySQL server must disable networking');
}

module.exports = { isolatedMysqlConfig, assertIsolatedMysql };
