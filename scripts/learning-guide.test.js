const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { steps } = require('../public/learning-guide');

const root = path.resolve(__dirname, '..');
test('optional newcomer guide covers the complete route without grading, consent changes or auto prompts', () => {
  assert.equal(steps.length, 5);
  const text = steps.map((step) => step.text).join('');
  assert.match(text, /知识起源/);
  assert.match(text, /批注只对自己/);
  assert.match(text, /完整正式题目范围/);
  assert.match(text, /探索/);
  assert.match(text, /学习过程自动记录/);
  assert.match(text, /私人批注和聊天不进入过程统计/);
  assert.match(steps[0].text, /基础条件以正文为准/);
  assert.doesNotMatch(steps[0].text, /概览.*需要哪些基础/);
  const source = fs.readFileSync(path.join(root, 'public/learning-guide.js'), 'utf8');
  assert.doesNotMatch(source, /callApi|localStorage|knowledge:ask|\.confirm\(/);
});

test('Max-generated small exercises have a visible boundary from official self-tests', () => {
  const html = fs.readFileSync(path.join(root, 'public/knowledge.html'), 'utf8');
  const pageSource = fs.readFileSync(path.join(root, 'public/knowledge.js'), 'utf8');
  assert.match(html, /data-chat-prompt="给我一道检查理解的小题"/);
  assert.match(html, /title="Max 生成练习，不计正式自测与星标"/);
  assert.match(html, /Max 小题不计正式自测 · 对话不写入讨论区/);
  assert.match(pageSource, /status \|\| 'Max 小题不计正式自测 · 对话不写入讨论区'/);
});
test('the reading surface remains unique and annotations only open tools around the official document', () => {
  const html = fs.readFileSync(path.join(root, 'public/knowledge.html'), 'utf8');
  const annotation = fs.readFileSync(path.join(root, 'public/knowledge-annotations.js'), 'utf8');
  assert.equal([...html.matchAll(/id="knowledge-body"/g)].length, 1);
  assert.doesNotMatch(html, /id="learning-annotated-document"/);
  const refresh = annotation.slice(
    annotation.indexOf('    function refresh('),
    annotation.indexOf('    function captureSelection('),
  );
  assert.doesNotMatch(refresh, /cloneNode|learning-annotated-document/);
  assert.match(html, /learning-reading-notes-host/);
  assert.equal([...html.matchAll(/id="learning-annotation-toolbar"/g)].length, 1);
  assert.match(annotation, /if \(notesPanel\) notesPanel\.hidden = true/);
  assert.doesNotMatch(annotation, /inlineHost\.append\(notesPanel\)/);
  assert.match(annotation, /document\.body\.append\(popover\)/);
  assert.match(annotation, /document\.body\.append\(directory\)/);
  assert.match(html, /id="learning-annotation-popover"[\s\S]*?role="dialog"/);
  const toolbar = html.slice(
    html.indexOf('id="learning-annotation-toolbar"'),
    html.indexOf('id="learning-reading-notes-host"'),
  );
  assert.doesNotMatch(toolbar, /<textarea|<details|批注目录/);
});
