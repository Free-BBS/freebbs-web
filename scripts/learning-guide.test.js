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
  assert.match(text, /是否开启/);
  const source = fs.readFileSync(path.join(root, 'public/learning-guide.js'), 'utf8');
  assert.doesNotMatch(source, /callApi|localStorage|knowledge:ask|\.confirm\(/);
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
  assert.match(annotation, /inlineHost\.append\(notesPanel\)/);
});
