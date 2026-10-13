// Deterministic public authoring kits. Explicit source allowlists exclude local data and credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const Zip = require('jszip');

const ROOT = path.resolve(__dirname, '..');
const FIXED_DATE = new Date('2026-10-12T00:00:00Z');
const TOOLS = [
  '整理知识点.cjs',
  '检查自测.cjs',
  '检查课程包.cjs',
  '课程接口.cjs',
  '上传知识点.cjs',
  '下载课程.cjs',
];
const REFERENCES = [
  'learning-platform-research-20261011.md',
  'learning-human-factors-evidence-20261010.md',
  'human-learning-scenarios-20261010.md',
];
const AUTHORING_FILES = [
  'README.md',
  '课程组编写指南.md',
  '本次学习世界更新.md',
  '本地验收.md',
  'templates/知识点.md',
  'templates/章节-0级节点.md',
  'templates/自测题-评分扩展.md',
  'templates/平台研究任务-四阶段.md',
  'templates/课程提交说明.md',
  'templates/关系.md',
  'templates/布局.md',
  'examples/关系.md',
  'examples/布局.md',
  'examples/章节/SS-01-00.md',
  'examples/章节/SS-02-00.md',
  'examples/知识点/SS-01-01.md',
  'examples/知识点/SS-01-02.md',
  'examples/知识点/SS-02-01.md',
  ...TOOLS.map((name) => `tools/${name}`),
];

async function text(file) {
  return (await fs.readFile(path.join(ROOT, file), 'utf8')).replace(/\r\n?/g, '\n');
}

async function expectedEntries(kind) {
  const entries = {};
  if (kind === 'authoring') {
    entries['README.md'] = await text('docs/course-authoring/下载包README.md');
    for (const file of [
      ...AUTHORING_FILES.map((name) => `docs/course-authoring/${name}`),
      ...REFERENCES.map((name) => `docs/${name}`),
    ])
      entries[file] = await text(file);
  } else if (kind === 'skill') {
    for (const file of ['SKILL.md', 'references/api.md', 'scripts/freebbs_course_upload.py'])
      entries[`freebbs-course-upload/${file}`] = await text(`skills/freebbs-course-upload/${file}`);
    for (const file of TOOLS)
      entries[`freebbs-course-upload/scripts/course-authoring/${file}`] = await text(
        `docs/course-authoring/tools/${file}`,
      );
  } else throw new Error('Unknown public authoring kit');
  return entries;
}

async function render(kind) {
  const zip = new Zip();
  const entries = await expectedEntries(kind);
  for (const name of Object.keys(entries).sort())
    zip.file(name, entries[name], { date: FIXED_DATE, createFolders: false });
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

async function check(kind, archive) {
  const zip = await Zip.loadAsync(archive);
  const expected = await expectedEntries(kind);
  assert.deepEqual(
    Object.keys(zip.files).sort(),
    Object.keys(expected).sort(),
    `${kind}: exact entries`,
  );
  for (const [name, source] of Object.entries(expected)) {
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'), `${kind}: relative paths`);
    assert.equal(
      await zip.file(name).async('string'),
      source,
      `${kind}: ${name} matches current source`,
    );
  }
  return Object.keys(expected).length;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  for (const [kind, file] of [
    ['authoring', 'freebbs-course-authoring.zip'],
    ['skill', 'freebbs-course-upload.zip'],
  ]) {
    const target = path.join(ROOT, 'public/downloads', file);
    const archive = checkOnly ? await fs.readFile(target) : await render(kind);
    const entries = await check(kind, archive);
    if (!checkOnly) await fs.writeFile(target, archive);
    console.log(`${checkOnly ? 'Verified' : 'Built'} ${file}: ${entries} source files`);
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

module.exports = { expectedEntries, render, check, TOOLS, AUTHORING_FILES };
