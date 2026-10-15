const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const workflowPath = path.join(root, '.github/workflows/map-bridge-configure.yml');

test('Map credential workflow requires a main manual dispatch, exact confirmation and production environment', () => {
  assert.equal(fs.existsSync(workflowPath), true);
  const source = fs.readFileSync(workflowPath, 'utf8');
  const workflow = yaml.load(source);
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.confirmation.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.confirmation.type, 'string');
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency.group, 'free-bbs-production');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(Object.keys(workflow.jobs).length, 1);
  const job = workflow.jobs.configure;
  assert.equal(job.environment, 'production');
  assert.match(job.if, /github\.event_name == 'workflow_dispatch'/);
  assert.match(job.if, /github\.ref == 'refs\/heads\/main'/);
  assert.match(job.if, /inputs\.confirmation == 'CONFIGURE MAP'/);
  assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 10);
  assert.match(job.env.DEPLOY_HOST, /secrets\.DEPLOY_HOST/);
  assert.match(job.env.DEPLOY_USER, /secrets\.DEPLOY_USER/);
  assert.match(job.env.DEPLOY_PATH, /vars\.DEPLOY_PATH/);
  assert.match(job.env.DEPLOY_PORT, /vars\.DEPLOY_PORT/);
  assert.equal(
    job.env.DEVELOPMENT_MAP_INGEST_TOKEN,
    undefined,
    'token scope is limited to validation/configuration steps',
  );
  const validate = job.steps.findIndex(
    (step) => step.run === 'node scripts/map-bridge-configure.js --validate-inputs',
  );
  const ssh = job.steps.findIndex((step) => step.name === 'Configure SSH');
  const configure = job.steps.findIndex(
    (step) => step.run === 'node scripts/map-bridge-configure.js',
  );
  assert.ok(validate >= 0 && ssh > validate && configure > ssh);
  for (const index of [validate, configure]) {
    assert.match(
      job.steps[index].env.DEVELOPMENT_MAP_INGEST_TOKEN,
      /secrets\.DEVELOPMENT_MAP_INGEST_TOKEN/,
    );
  }
  for (const step of job.steps) {
    if (step.uses) assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
    if (step.uses?.startsWith('actions/checkout@'))
      assert.equal(step.with['persist-credentials'], false);
    if (step.run) {
      assert.doesNotMatch(
        step.run,
        /\$\{\{\s*(?:secrets|vars|inputs)\./,
        'shell inputs must come through environment variables',
      );
      assert.doesNotMatch(
        step.run,
        /(?:systemctl|sudo|deploy\.sh|migrate\.sh|npm ci|npm run|scp|rsync)/,
      );
    }
  }
  assert.match(job.steps[ssh].env.DEPLOY_SSH_KEY, /secrets\.DEPLOY_SSH_KEY/);
  assert.match(job.steps[ssh].run, /printf '%s\\n' "\$DEPLOY_SSH_KEY"/);
});

test('normal deployment preserves the verifier and CI explicitly tests the new boundary', () => {
  const deploy = fs.readFileSync(path.join(root, 'scripts/deploy.sh'), 'utf8');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const ci = fs.readFileSync(path.join(root, 'scripts/ci-validate.sh'), 'utf8');
  assert.match(deploy, /rsync -a --delete/);
  assert.match(deploy, /--exclude ["']\.development-map-token\.sha256["']/);
  assert.doesNotMatch(deploy, /--delete-excluded/);
  assert.match(ignore, /^\/\.development-map-token\.sha256$/m);
  assert.match(ci, /^node --check scripts\/map-bridge-configure\.js$/m);
  assert.match(ci, /^node --test[^\n]* scripts\/map-bridge-configure\.test\.js(?:\s|$)/m);
  assert.match(ci, /^node --test[^\n]* scripts\/map-bridge-configure-workflow\.test\.js(?:\s|$)/m);
});
