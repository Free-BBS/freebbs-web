const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const runtime = fs.readFileSync(
  path.join(root, 'development/apps/api/src/integrated-runtime.ts'),
  'utf8',
);
const migrate = fs.readFileSync(path.join(root, 'scripts/migrate.sh'), 'utf8');
const developmentMigrate = fs.readFileSync(
  path.join(root, 'scripts/migrate-development.sh'),
  'utf8',
);
const deploy = fs.readFileSync(path.join(root, 'scripts/deploy.sh'), 'utf8');
const mysqlIntegration = fs.readFileSync(
  path.join(root, 'backend/community.integration.test.js'),
  'utf8',
);

test('ordinary development runtime startup verifies schema without applying DDL', () => {
  assert.doesNotMatch(runtime, /runMigrations/);
  assert.match(runtime, /await handle\.checkReadiness\(\)/);
});

test('the controlled migration command applies development migrations', () => {
  assert.match(migrate, /bash scripts\/migrate-development\.sh/);
  assert.match(developmentMigrate, /development\/apps\/api\/dist\/core\/database\/migrate\.js/);
  assert.match(developmentMigrate, /DEVELOPMENT_MYSQL_DATABASE/);
});

test('deployment invokes all migrations only behind RUN_DB_MIGRATIONS=1', () => {
  const guarded = deploy.match(/if \[\[ "\$RUN_DB_MIGRATIONS" == "1" \]\]; then([\s\S]*?)\nelse\n/);
  assert.ok(guarded, 'deployment migration guard must remain explicit');
  assert.match(guarded[1], /bash scripts\/migrate\.sh/);
  assert.doesNotMatch(deploy.slice(0, guarded.index), /bash scripts\/migrate\.sh/);
  assert.doesNotMatch(
    deploy.slice((guarded.index ?? 0) + guarded[0].length),
    /bash scripts\/migrate\.sh/,
  );
});

test('isolated MySQL prepares the development schema before starting the integrated backend', () => {
  const migration = mysqlIntegration.indexOf("'scripts/migrate-development.sh'");
  const startup = mysqlIntegration.indexOf("spawn(process.execPath, ['backend/server.js']");
  assert.ok(migration >= 0 && startup > migration);
});
