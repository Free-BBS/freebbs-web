const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(graphLayout) {
  const element = (tag) => ({
    tag,
    children: [],
    hidden: false,
    textContent: '',
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = [...items];
    },
  });
  const document = { createElement: element };
  const window = { FreeBbsLearningGraphLayout: graphLayout };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/learning-content.js'), 'utf8'),
    {
      window,
      document,
      URLSearchParams,
    },
  );
  return { element, content: window.FreeBbsLearningContent };
}

test('chapter material keeps a real accessible directory when the optional graph asset or its layout fails', () => {
  const nodes = [
    { id: 'SS-01-00', title: '本章概览' },
    { id: 'SS-01-01', title: '<img onerror=alert(1)>真实标题' },
    { id: 'SS-01-02', title: '另一个知识点' },
    { id: 'SS-02-01', title: '别章知识点' },
  ];
  for (const graphLayout of [
    undefined,
    {
      titleLines() {},
      fitSvgLabel() {},
      layout() {
        throw new Error('Unavailable');
      },
    },
  ]) {
    const { element, content } = fixture(graphLayout);
    const container = element('section');
    content.renderNetwork(container, { nodes, edges: [] }, nodes[0], { slug: 'signals' });
    assert.equal(container.hidden, false);
    assert.equal(container.children[1].textContent, '关系图暂不可用，可从本章目录继续。');
    const entries = container.children[2].children;
    assert.equal(entries.length, 2);
    assert.equal(entries[0].children[0].textContent, `${nodes[1].title} · SS-01-01`);
    assert.equal(entries[0].children[0].href, '/knowledge?course=signals&point=SS-01-01');
    assert.equal(entries[1].children[0].href, '/knowledge?course=signals&point=SS-01-02');
    assert.equal(
      entries.some((entry) => entry.children[0].tag !== 'a'),
      false,
    );
    content.renderNetwork(container, { nodes: [], edges: [] }, nodes[0], { slug: 'signals' });
    assert.equal(container.children[1].textContent, '本章尚未发布知识点。');
    content.renderNetwork(container, { nodes, edges: [] }, nodes[1], { slug: 'signals' });
    assert.equal(container.hidden, true);
  }
});
