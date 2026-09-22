const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, '.github/workflows/pr-validate.yml'), 'utf8');
const workflow = yaml.load(source);
const ci = fs.readFileSync(path.join(root, 'scripts/ci-validate.sh'), 'utf8');

test('PR validation runs for main pull requests and manual dispatch with read-only permissions', () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.pull_request.branches, ['main']);
  assert.equal(workflow.on.pull_request.paths, undefined, 'every PR must receive a check');
  assert.equal(workflow.on.pull_request['paths-ignore'], undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.match(workflow.concurrency.group, /github\.workflow/);
  assert.match(workflow.concurrency.group, /github\.event_name/);
  assert.match(
    workflow.concurrency.group,
    /github\.event\.pull_request\.number\s*\|\|\s*github\.ref/,
  );
});

test('PR jobs use pinned official actions and never receive deployment credentials or environments', () => {
  assert.doesNotMatch(source, /\$\{\{\s*secrets\b/);
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.environment, undefined);
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 30);
    if (job.permissions) assert.deepEqual(job.permissions, { contents: 'read' });
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
      if (step.uses?.startsWith('actions/checkout@')) {
        assert.equal(step.with?.['persist-credentials'], false);
        assert.equal(step.with?.ref, undefined, 'PR validation must check GitHub’s merge ref');
      }
      if (step.run)
        assert.doesNotMatch(step.run, /\b(?:ssh|scp|rsync)\b|scripts\/(?:deploy|migrate)\.sh/);
    }
  }
});

test('the validation job uses repository Node, Python 3 and the shared complete CI entry point', () => {
  const { steps } = workflow.jobs.validate;
  const node = steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
  const python = steps.find((step) => step.uses?.startsWith('actions/setup-python@'));
  assert.equal(node?.with?.['node-version-file'], '.nvmrc');
  assert.match(String(python?.with?.['python-version']), /^3(?:\.|$)/);
  assert.ok(steps.some((step) => step.run === 'bash scripts/ci-validate.sh'));
  assert.match(ci, /^npm ci\s*$/m);
  assert.match(ci, /^node --test[^\n]* scripts\/pr-validation-workflow\.test\.js(?:\s|$)/m);
  assert.match(ci, /^node --test[^\n]* scripts\/mysql-isolation\.test\.js(?:\s|$)/m);
  assert.match(ci, /^node --check backend\/workbench-schedule-planner\.js\s*$/m);
  assert.match(ci, /^npm run test:workbench\s*$/m);
});

test('the MySQL job installs dependencies before running a local socket-only disposable server', () => {
  const job = workflow.jobs.mysql;
  assert.ok(job, 'real database integration must have its own CI job');
  assert.equal(job.services, undefined);
  assert.equal(job.container, undefined);
  assert.doesNotMatch(JSON.stringify(job), /"ports"\s*:/);
  const install = job.steps.findIndex((step) => step.run === 'npm ci');
  const run = job.steps.findIndex((step) => step.run === 'npm run test:mysql:isolated');
  assert.ok(install >= 0 && run > install);
  assert.equal(job.steps[run].env?.MYSQLD_BIN, '/usr/sbin/mysqld');
  const node = job.steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(node?.with?.['node-version-file'], '.nvmrc');
});
