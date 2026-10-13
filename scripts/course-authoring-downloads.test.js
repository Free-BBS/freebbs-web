const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const Zip = require('jszip');
const { check, render, TOOLS } = require('./build-course-authoring-downloads');

const root = path.resolve(__dirname, '..');

for (const [kind, file] of [
  ['authoring', 'freebbs-course-authoring.zip'],
  ['skill', 'freebbs-course-upload.zip'],
]) {
  test(`${kind} downloadable kit matches every current allowlisted source`, async () => {
    const data = await fs.readFile(path.join(root, 'public/downloads', file));
    assert.ok((await check(kind, data)) > 0);
    const zip = await Zip.loadAsync(data);
    const prefix =
      kind === 'authoring'
        ? 'docs/course-authoring/tools'
        : 'freebbs-course-upload/scripts/course-authoring';
    for (const name of TOOLS) assert.ok(zip.file(`${prefix}/${name}`), `${name} is distributed`);
    for (const name of Object.keys(zip.files)) {
      assert.doesNotMatch(name, /(?:\.env|node_modules|output\/|snapshot\/|__pycache__|\.git\/)/);
      assert.ok(!name.startsWith('/') && !name.split('/').includes('..'));
    }
  });
}

test('public authoring kit keeps README, templates, examples and linked research references', async () => {
  const zip = await Zip.loadAsync(await render('authoring'));
  for (const name of [
    'README.md',
    'docs/course-authoring/README.md',
    'docs/course-authoring/课程组编写指南.md',
    'docs/course-authoring/templates/知识点.md',
    'docs/course-authoring/templates/章节-0级节点.md',
    'docs/course-authoring/templates/自测题-评分扩展.md',
    'docs/course-authoring/examples/知识点/SS-02-01.md',
    'docs/learning-platform-research-20261011.md',
    'docs/learning-human-factors-evidence-20261010.md',
    'docs/human-learning-scenarios-20261010.md',
  ])
    assert.ok(zip.file(name), name);
});

test('public kits reject stale or unexpected contents rather than silently shipping an older uploader', async () => {
  const zip = await Zip.loadAsync(await render('skill'));
  zip.file('freebbs-course-upload/scripts/course-authoring/上传知识点.cjs', '// stale version', {
    createFolders: false,
  });
  await assert.rejects(
    check('skill', await zip.generateAsync({ type: 'nodebuffer' })),
    /matches current source/,
  );
  zip.file('freebbs-course-upload/private.txt', 'not allowed', { createFolders: false });
  await assert.rejects(
    check('skill', await zip.generateAsync({ type: 'nodebuffer' })),
    /exact entries/,
  );
});

test('settings provides templates and the existing authorized Agent channel without a public upload claim', async () => {
  const source = await fs.readFile(path.join(root, 'public/course-upload.js'), 'utf8');
  assert.match(source, /course-template-download/);
  assert.match(source, /\/downloads\/freebbs-course-authoring\.zip/);
  assert.match(source, /course-skill-download/);
  assert.match(source, /\/skill\.zip/);
  assert.match(source, /course-api-docs/);
  assert.doesNotMatch(source, /FREEBBS_UPLOAD_TOKEN\s*=\s*['"]fbcu_/);
});
