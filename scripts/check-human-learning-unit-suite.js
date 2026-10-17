// One deduplicated local acceptance run. Skipped database tests remain explicitly unverified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const manifest = require('../package.json');

const LEARNING_GROUPS = [
  'test:agent-surfaces',
  'test:learning-workspace',
  'test:course-authoring',
  'test:learning-assessment',
  'test:learning-analytics',
  'test:learning-research',
  'test:learning-human-contracts',
  'test:learning-companion',
  'test:learning-policy',
  'test:learning-stars',
  'test:learning-structure',
  'test:course-maps',
  'test:profile-learning',
];
const SHARED_GROUPS = ['test:ui-foundation', 'test:ui-components', 'test:ui-page-migration'];

function filesFor(groups) {
  return [
    ...new Set(
      groups.flatMap((group) => {
        const command = manifest.scripts[group];
        assert.match(command, /^node --test (?:[a-zA-Z0-9_./-]+\.test\.js\s*)+$/);
        return command.slice('node --test '.length).trim().split(/\s+/);
      }),
    ),
  ];
}

function environment(original = process.env) {
  const env = { ...original, NODE_ENV: 'test' };
  for (const key of Object.keys(env)) {
    if (
      /^(?:NODE_OPTIONS$|NODE_TEST_CONTEXT$|MYSQL_|DB_|DATABASE_|FREEBBS_TEST_MYSQL_|RUN_.*(?:MYSQL|INTEGRATION)$|.*_MYSQL_|WHITELIST_TEST_MYSQL$|NOTIFICATIONS_MYSQL_TEST$)/.test(
        key,
      )
    )
      delete env[key];
  }
  return env;
}

function main() {
  const groups = process.argv.includes('--include-shared-ui')
    ? [...LEARNING_GROUPS, ...SHARED_GROUPS]
    : LEARNING_GROUPS;
  const files = filesFor(groups);
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'human-learning-unit-'));
  fs.mkdirSync(output, { recursive: true });
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    cwd: path.resolve(__dirname, '..'),
    env: environment(),
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 40 * 1024 * 1024,
    windowsHide: true,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  fs.writeFileSync(path.join(output, 'unit-suite.tap'), stdout);
  fs.writeFileSync(path.join(output, 'unit-suite.stderr.txt'), stderr);
  const count = (name) => {
    const match = stdout.match(new RegExp(`^# ${name} (\\d+)\\s*$`, 'm'));
    return match ? Number(match[1]) : null;
  };
  const report = {
    boundary:
      'One deduplicated local unit/contract run. Integration/database opt-ins cleared; mocks are not production or real MySQL evidence.',
    started,
    completed: new Date().toISOString(),
    groups,
    files,
    counts: {
      tests: count('tests'),
      pass: count('pass'),
      fail: count('fail'),
      skipped: count('skipped'),
      cancelled: count('cancelled'),
    },
    skippedTests: stdout
      .split('\n')
      .filter((line) => /^ok \d+ - .* # SKIP/.test(line))
      .map((line) => line.replace(/^ok \d+ - /, '')),
    exitCode: result.status,
    runnerError: result.error?.message || null,
    ok: result.status === 0 && count('fail') === 0 && count('pass') > 0,
  };
  fs.writeFileSync(
    path.join(output, 'unit-suite-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify({ output, ...report }));
  if (!report.ok) process.exitCode = 1;
  return report;
}

if (require.main === module) main();
module.exports = { LEARNING_GROUPS, SHARED_GROUPS, filesFor, environment, main };
