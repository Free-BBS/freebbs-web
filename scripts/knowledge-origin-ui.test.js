const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const learningContent = require('../public/learning-content');
const { createController } = require('../public/knowledge-history');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/knowledge.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/knowledge-workspace.css'), 'utf8');
const originRenderer = source.match(
  / {2}function renderKnowledgeOrigin\(node\) \{[\s\S]+?(?=\n {2}function renderKnowledgeContent\(node\))/,
);

function element() {
  const attributes = new Map();
  const classes = new Set();
  const listeners = new Map();
  return {
    attributes,
    hidden: false,
    innerHTML: '',
    textContent: '',
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name),
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    toggleAttribute(name, enabled) {
      if (enabled) attributes.set(name, '');
      else attributes.delete(name);
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    emit: (name, event = {}) => listeners.get(name)?.(event),
    focus() {},
  };
}

function harness() {
  assert.ok(originRenderer, 'exercise the production origin renderer, not a duplicate model');
  const elements = new Map(
    ['', '-content', '-toggle', '-toggle-label', '-prose', '-empty'].map((suffix) => [
      `knowledge-history${suffix}`,
      element(),
    ]),
  );
  const page = element();
  const document = { getElementById: (id) => elements.get(id) };
  const enhanced = [];
  const render = vm.runInNewContext(`${originRenderer[0]}\nrenderKnowledgeOrigin;`, {
    document,
    window: { FreeBbsLearningContent: learningContent },
    app: {
      renderMarkdownContent: (markdown) => `rendered:${markdown}`,
      enhanceMarkdownContent: (target) => enhanced.push(target),
    },
  });
  const history = createController({
    page,
    document,
    storage: { getItem: () => null, setItem() {} },
    course: 'signals',
    point: 'SS-01-01',
  });
  return {
    elements,
    page,
    history,
    render,
    enhanced,
    box: elements.get('knowledge-history'),
    prose: elements.get('knowledge-history-prose'),
    placeholder: elements.get('knowledge-history-empty'),
    toggle: elements.get('knowledge-history-toggle'),
    content: elements.get('knowledge-history-content'),
  };
}

test('legacy applications and absent sections do not manufacture a sticky origin document', () => {
  const fixture = harness();
  for (const node of [
    { sections: { applicationsMarkdown: '信号承载消息，系统把输入变换为输出。' } },
    { sections: { applicationsMarkdown: '### 1.1 知识点概述\n\n课程组概览原文。' } },
    { sections: { applicationsMarkdown: '### 知识起源\n\n### 应用场景\n\n一个真实应用。' } },
    { markdown: '没有拆分的旧正文。' },
  ]) {
    fixture.render(node);
    assert.equal(fixture.box.attributes.get('data-learning-origin-state'), 'empty');
    assert.equal(fixture.prose.innerHTML, '');
    assert.ok(fixture.prose.attributes.has('data-learning-document-empty'));
  }
  assert.match(
    css,
    /#knowledge-history\[data-learning-origin-state='empty'\]\s*\{[^}]*display:\s*none;[^}]*position:\s*static;/,
  );
});

test('a real template origin retains its content, collapse controls and annotation boundary', () => {
  const fixture = harness();
  const node = {
    sections: {
      applicationsMarkdown:
        '简短概览。\n\n### 知识起源\n\n为了解决输入叠加后如何计算输出的问题。\n\n### 应用场景\n\n滤波设计。',
    },
    documentVersion: 'a'.repeat(64),
    originDocumentVersion: 'b'.repeat(64),
  };
  const before = JSON.stringify(node);
  fixture.render(node);
  assert.equal(fixture.box.attributes.get('data-learning-origin-state'), 'available');
  assert.equal(fixture.prose.innerHTML, 'rendered:为了解决输入叠加后如何计算输出的问题。');
  assert.ok(!fixture.prose.attributes.has('data-learning-document-empty'));
  assert.ok(fixture.placeholder.attributes.has('hidden'));
  fixture.toggle.emit('click');
  assert.equal(fixture.content.hidden, true);
  fixture.toggle.emit('click');
  assert.equal(fixture.content.hidden, false);
  fixture.page.emit('knowledge:tool-select', { detail: { tool: 'notes' } });
  assert.equal(fixture.box.hidden, false);
  assert.equal(JSON.stringify(node), before, 'rendering never modifies authored text or versions');
});

test('author-written text identical to a system placeholder remains real annotatable origin', () => {
  const fixture = harness();
  const authored = '本知识点尚未提供起源说明。';
  fixture.render({ sections: { applicationsMarkdown: `### 知识起源\n\n${authored}` } });
  assert.equal(fixture.box.attributes.get('data-learning-origin-state'), 'available');
  assert.equal(fixture.prose.innerHTML, `rendered:${authored}`);
  assert.ok(!fixture.prose.attributes.has('data-learning-document-empty'));
  assert.ok(fixture.placeholder.attributes.has('hidden'));
});

test('refreshing or changing the node replaces origin availability and never retains old prose', () => {
  const fixture = harness();
  fixture.render({
    id: 'SS-01-01',
    sections: { applicationsMarkdown: '### 知识起源\n\n旧原文。' },
  });
  assert.equal(fixture.prose.innerHTML, 'rendered:旧原文。');
  fixture.render({ id: 'SS-01-01', sections: { applicationsMarkdown: '' } });
  assert.equal(fixture.prose.innerHTML, '');
  assert.equal(fixture.box.attributes.get('data-learning-origin-state'), 'empty');
  fixture.render({
    id: 'SS-02-01',
    sections: { applicationsMarkdown: '### 知识起源\n\n新原文。' },
  });
  assert.equal(fixture.box.attributes.get('data-learning-origin-state'), 'available');
  assert.equal(fixture.prose.innerHTML, 'rendered:新原文。');
  fixture.render({ id: 'SS-02-02', sections: {} });
  fixture.page.emit('knowledge:view-change', {
    detail: { view: 'reading', activateContent: true },
  });
  fixture.history.restore();
  assert.equal(fixture.prose.innerHTML, '');
  assert.equal(fixture.box.attributes.get('data-learning-origin-state'), 'empty');
});

test('origin availability is set only by a successful content render, not loading or error copy', () => {
  const fixture = harness();
  assert.equal(fixture.box.attributes.get('data-learning-origin-state'), undefined);
  const loading = source.slice(
    source.indexOf('  function setKnowledgeLoading('),
    source.indexOf('  function bindTagControls('),
  );
  assert.doesNotMatch(loading, /renderKnowledgeOrigin|data-learning-origin-state/);
  assert.match(loading, /正在载入正文/);
  assert.match(loading, /role="alert"/);
  assert.match(
    source,
    /function renderKnowledgeContent\(node\)\s*\{\s*renderKnowledgeOrigin\(node\);/,
  );
});

test('knowledge titles have a bounded local hierarchy while authored prose keeps its reading size', () => {
  assert.match(css, /\.knowledge-page \.course-material-header\s*\{\s*padding-bottom:\s*16px;/);
  assert.match(
    css,
    /\.knowledge-page \[data-learning-tool='content'\] \.course-material-header h1#knowledge-title,/,
  );
  const title = css.match(
    /\.knowledge-page \[data-learning-tool='notes'\] \.course-material-header h1#knowledge-title\s*\{([^}]+)\}/,
  )?.[1];
  assert.ok(title, 'title sizing is scoped to the knowledge page, not the global site');
  assert.match(title, /font-size:\s*clamp\(1\.75rem, 2\.5vw, 2\.5rem\);/);
  assert.match(title, /line-height:\s*1\.4;/);
  assert.match(title, /overflow-wrap:\s*anywhere;/);
  assert.match(css, /\.course-material-heading\s+h1#knowledge-title\s*\{\s*font-size:\s*1\.55rem;/);
  const prose = css.match(/\.knowledge-page #knowledge-body\s*\{([^}]+)\}/)?.[1];
  assert.match(prose, /font-size:\s*1\.15rem;/);
  assert.match(prose, /line-height:\s*1\.85;/);
  assert.match(source, /getElementById\('knowledge-title'\)\.textContent = node\.title;/);
});
