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
const developmentWorkflowPath = path.join(root, '.github/workflows/development-db-migrate.yml');
const productionDevelopmentMigratePath = path.join(
  root,
  'scripts/migrate-development-production.sh',
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

test('the production development migration workflow cannot touch the main database or frontend', () => {
  assert.equal(
    fs.existsSync(developmentWorkflowPath),
    true,
    'a dedicated development-only migration workflow is required',
  );
  assert.equal(
    fs.existsSync(productionDevelopmentMigratePath),
    true,
    'a guarded production wrapper for the development migration is required',
  );
  const workflow = fs.readFileSync(developmentWorkflowPath, 'utf8');
  const productionMigrate = fs.readFileSync(productionDevelopmentMigratePath, 'utf8');

  assert.match(workflow, /name:\s*Development Database Migration/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /RUN DEVELOPMENT/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /bash scripts\/migrate-development-production\.sh/);
  assert.doesNotMatch(workflow, /bash scripts\/migrate\.sh/);
  assert.doesNotMatch(workflow, /FRONTEND_SERVICE_NAME/);

  assert.match(productionMigrate, /bash scripts\/migrate-development\.sh/);
  assert.doesNotMatch(productionMigrate, /bash scripts\/migrate\.sh/);
  assert.match(productionMigrate, /DEVELOPMENT_DATABASE.*MYSQL_DATABASE/);
  assert.match(productionMigrate, /DEVELOPMENT_DATABASE" == "\$MYSQL_DATABASE/);
  assert.match(productionMigrate, /SYSTEMCTL_BINARY" restart "\$BACKEND_SERVICE_NAME/);
  assert.doesNotMatch(productionMigrate, /FRONTEND_SERVICE_NAME/);
  assert.match(productionMigrate, /\/api\/health/);
  assert.match(productionMigrate, /\/api\/development\/v1\/ready/);
});
