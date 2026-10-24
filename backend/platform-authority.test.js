const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  configuredPlatformRootAdminUids,
  isMainSiteRootAdminUid,
  projectMainSiteAuthority,
  createDevelopmentAuthClient,
} = require('./development-integration');

const ROOT_UID = require('../development/packages/contracts/src/platform-authority.json')
  .rootAdminUids[0];

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
function fragment(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}

test('the appointed root comes from the shared configuration and environment can only add roots', async () => {
  assert.ok(
    configuredPlatformRootAdminUids({ PLATFORM_ROOT_ADMIN_UIDS: 'extra-root' }).includes(ROOT_UID),
  );
  assert.equal(
    isMainSiteRootAdminUid('extra-root', { PLATFORM_ROOT_ADMIN_UIDS: 'extra-root' }),
    true,
  );
  assert.throws(() =>
    configuredPlatformRootAdminUids({ PLATFORM_ROOT_ADMIN_UIDS: 'bad\u0000root' }),
  );
  const user = await projectMainSiteAuthority(
    { id: 1, uid: ROOT_UID, is_admin: 0, role: 'student' },
    undefined,
    {},
  );
  assert.equal(user.rootAdmin, true);
  assert.equal(user.is_admin, 1);
  assert.equal(user.legacy_is_admin, false);
});

test('the main site consumes fresh shared learning authority, never development-only or client-provided flags', async () => {
  const account = {
    id: 2,
    uid: 'shared-member',
    is_admin: 0,
    rootAdmin: true,
    learningAdmin: true,
    role: 'student',
  };
  let active = true;
  const lookups = [];
  const resolve = async (uid) => {
    lookups.push(uid);
    return { learningAdmin: active, developmentAdmin: true, rootAdmin: true };
  };
  assert.equal((await projectMainSiteAuthority(account, resolve, {})).is_admin, 1);
  active = false;
  const denied = await projectMainSiteAuthority(account, resolve, {});
  assert.equal(denied.is_admin, 0);
  assert.equal(denied.rootAdmin, false);
  assert.equal(denied.learningAdmin, false);
  assert.deepEqual(lookups, ['shared-member', 'shared-member']);
});

test('shared-store failures preserve only legacy or configured-root authority', async () => {
  const unavailable = async () => {
    throw new Error('private-store-unavailable');
  };
  for (const account of [
    { uid: 'legacy-admin', is_admin: 1 },
    { uid: ROOT_UID, is_admin: 0 },
  ])
    assert.equal((await projectMainSiteAuthority(account, unavailable, {})).is_admin, 1);
  assert.equal(
    (await projectMainSiteAuthority({ uid: 'ordinary', is_admin: 0 }, unavailable, {})).is_admin,
    0,
  );
  assert.equal(await projectMainSiteAuthority(null, unavailable, {}), null);
});

test('learning-only projection does not become a physical legacy admin in development introspection', async () => {
  const row = await projectMainSiteAuthority(
    { id: 2, uid: 'learning-only', is_admin: 0 },
    async () => ({ learningAdmin: true }),
    {},
  );
  const client = createDevelopmentAuthClient({
    verifyToken: () => ({ sub: 2 }),
    getUserById: async () => row,
    toUserProfile: (user) => ({
      uid: user.uid,
      username: 'learning-only',
      isAdmin: Boolean(user.is_admin),
    }),
  });
  assert.equal((await client.introspect('server-verified-token')).mainSiteAdmin, false);
});

test('the actual getUserById and requireAdmin path accepts root without a physical flag and denies revoked shared grants', async () => {
  let learningAdmin = true;
  let account = { id: 1, uid: ROOT_UID, is_admin: 0, role: 'student' };
  const context = {
    pool: { execute: async () => [[{ ...account }]] },
    projectMainSiteAuthority,
    developmentRuntime: { resolvePlatformAuthority: async () => ({ learningAdmin }) },
    requireAuth: async () => context.getUserById(account.id),
  };
  vm.runInNewContext(
    fragment('async function getUserById(id)', 'async function getUserByIdFromUsername'),
    context,
  );
  vm.runInNewContext(
    fragment('async function requireAdmin(request, response)', 'app.use('),
    context,
  );
  const response = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };
  assert.equal((await context.requireAdmin({}, response)).rootAdmin, true);
  account = { id: 2, uid: 'shared-actor', is_admin: 0, role: 'student' };
  assert.equal((await context.requireAdmin({}, response)).is_admin, 1);
  learningAdmin = false;
  assert.equal(await context.requireAdmin({}, response), null);
  assert.equal(response.statusCode, 403);
});

function adminLocks(accounts, resolve = async () => ({ learningAdmin: false })) {
  const context = {
    configuredPlatformRootAdminUids: () => configuredPlatformRootAdminUids({}),
    isMainSiteRootAdminUid: (uid) => isMainSiteRootAdminUid(uid, {}),
    projectMainSiteAuthority,
    developmentRuntime: { resolvePlatformAuthority: resolve },
  };
  vm.runInNewContext(
    fragment('class AdminUserUpdateError extends Error', 'function sanitizeWebsiteUrl('),
    context,
  );
  const queries = [];
  const connection = {
    execute: async (sql, args) => {
      queries.push({ sql, args });
      assert.match(sql, /FOR UPDATE/);
      if (sql.includes('WHERE is_admin = 1'))
        return [accounts.filter((row) => row.is_admin === 1 || args.includes(row.uid))];
      assert.match(sql, /WHERE id IN \(\?, \?\)/);
      return [accounts.filter((row) => args.includes(row.id))];
    },
  };
  return { context, connection, queries };
}

test('transaction locks accept the configured root with is_admin=0 and retain a root when demoting the last legacy admin', async () => {
  const { context, connection, queries } = adminLocks([
    { id: 1, uid: ROOT_UID, role: 'student', is_admin: 0 },
    { id: 2, uid: 'legacy', role: 'admin', is_admin: 1 },
  ]);
  const target = await context.lockAndValidateRoleChange(connection, 1, 2, 'student', false);
  assert.equal(target.id, 2);
  assert.match(queries[0].sql, /OR uid IN/);
  assert.deepEqual(queries[0].args, configuredPlatformRootAdminUids({}));
});

test('ordinary admins cannot edit, downgrade or delete the root account through any user-management lock', async () => {
  const { context, connection } = adminLocks([
    { id: 1, uid: ROOT_UID, role: 'student', is_admin: 0 },
    { id: 2, uid: 'legacy', role: 'admin', is_admin: 1 },
  ]);
  await assert.rejects(context.lockAdminStateAndTarget(connection, 2, 1), { status: 403 });
  await assert.rejects(context.lockAndValidateRoleChange(connection, 2, 1, 'student', false), {
    status: 403,
  });
  await assert.rejects(context.lockAndValidateUserDeletion(connection, 2, 1), { status: 403 });
  await assert.rejects(context.lockAndValidateUserDeletion(connection, 1, 1), { status: 400 });
});

test('fresh transaction checks reject a shared admin whose assignment has been revoked and keep legacy last-admin protection', async () => {
  let active = true;
  const { context, connection } = adminLocks(
    [
      { id: 1, uid: 'shared', role: 'student', is_admin: 0 },
      { id: 2, uid: 'target', role: 'student', is_admin: 0 },
    ],
    async () => ({ learningAdmin: active }),
  );
  assert.equal((await context.lockAdminStateAndTarget(connection, 1, 2)).targetUser.id, 2);
  active = false;
  await assert.rejects(context.lockAdminStateAndTarget(connection, 1, 2), { status: 403 });
  const legacy = adminLocks([{ id: 3, uid: 'last-legacy', role: 'admin', is_admin: 1 }]);
  await assert.rejects(
    legacy.context.lockAndValidateRoleChange(legacy.connection, 3, 3, 'student', false),
    { status: 409 },
  );
});
