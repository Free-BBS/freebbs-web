const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { page, PAGE_SIZE } = require('../public/course-directory');

const nodes = Array.from({ length: 53 }, (_, index) => ({
  id: `SS-01-${String(index + 1).padStart(2, '0')}`,
  title: `知识点 ${index + 1}：时域分析`,
}));

test('dense chapter browsing is bounded and preserves every published node and its order', () => {
  const original = JSON.stringify(nodes);
  const all = [];
  for (let index = 0; index < 5; index += 1) {
    const view = page(nodes, '', index);
    assert.ok(view.nodes.length <= PAGE_SIZE);
    assert.equal(view.total, nodes.length);
    all.push(...view.nodes);
  }
  assert.deepEqual(all, nodes);
  assert.equal(JSON.stringify(nodes), original);
});

test('chapter search handles full-width IDs, names and multi-term input without fabricating matches', () => {
  assert.equal(page(nodes, 'ｓｓ－０１－０３').nodes[0].id, 'SS-01-03');
  assert.equal(page(nodes, 'SS-01-03 时域').total, 1);
  assert.equal(page(nodes, '不存在的内容').total, 0);
  assert.equal(page(nodes, '时域').total, 53);
});

test('empty and changing chapter results clamp invalid or stale pages', () => {
  assert.deepEqual(page([], '', 500), {
    nodes: [],
    page: 0,
    pageCount: 1,
    total: 0,
    start: 0,
    end: 0,
  });
  assert.equal(page(nodes, '', 500).page, 4);
  assert.equal(page(nodes, '', -1).page, 0);
  assert.equal(page(nodes, '', Number.NaN).page, 0);
  assert.equal(page(nodes, 'SS-01-03', 4).page, 0);
});

test('the directory model loads before the page consumer and stays independent of the editor', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/course.html'), 'utf8');
  assert.ok(html.indexOf('/course-directory.js?v=') > 0);
  assert.ok(html.indexOf('/course-directory.js?v=') < html.indexOf('/course-map.js?v='));
  const editor = fs.readFileSync(path.join(__dirname, '../public/course-map-editor.html'), 'utf8');
  assert.doesNotMatch(editor, /course-directory\.js/);
});
