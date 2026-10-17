const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { model, readFields } = require('../public/knowledge-overview');
const content = require('../public/learning-content');

test('normalizes headings, colon fields and contributor aliases without changing source', () => {
  const node = {
    id: 'CAL-01-01',
    title: '导数',
    sections: {
      basicInfoMarkdown: `## 课程名称\n\n高等微积分\n## 章节/单元\n第一章\n知识点类型: "概念"\n知识点层级：核心\n难度（1-5）：2\n重要程度(1-5): 4\n建议学习时长：20分钟\n填写人:\n\n"同学甲"\n修改人: "同学乙、同学甲"\n审核人：同学丙`,
      applicationsMarkdown: '## 1.1 知识点概述\n\n理解变化率。\n\n## 联系\n不应挤进摘要。',
    },
  };
  const copy = JSON.stringify(node);
  assert.deepEqual(model(node), {
    id: 'CAL-01-01',
    title: '导数',
    course: '高等微积分',
    chapter: '',
    type: '概念',
    level: '核心',
    difficulty: '2',
    importance: '4',
    duration: '20分钟',
    participants: ['同学甲', '同学乙', '同学丙'],
    summary: '理解变化率。',
  });
  assert.equal(JSON.stringify(node), copy);
});

test('accepts Markdown table fields and a canonical participants field', () => {
  const fields = readFields(
    '| 字段 | 值 |\n| --- | --- |\n| **难度（1-5）** | 3 |\n| 参与同学 | 同学甲，同学乙 |\n难度：5',
  );
  assert.equal(fields.difficulty, '3');
  assert.deepEqual(fields.participants, ['同学甲，同学乙']);
  assert.deepEqual(
    model({ sections: { basicInfoMarkdown: '参与同学: ["甲", "乙"]' } }).participants,
    ['甲', '乙'],
  );
});

test('preserves numeric metadata values on the line after their heading', () => {
  for (const duration of ['60 分钟', '30 分钟', '1.5 小时', '90–120 分钟']) {
    const markdown = `## 建议学习时长\n\n${duration}\n## 难度\n2 / 5\n## 章节/单元\n1 基础概念`;
    const fields = readFields(markdown);
    assert.equal(fields.duration, duration);
    assert.equal(fields.difficulty, '2 / 5');
    assert.equal(fields.chapter, '1 基础概念');
    const node = { sections: { basicInfoMarkdown: markdown } };
    const original = JSON.stringify(node);
    assert.equal(model(node).duration, duration);
    assert.equal(JSON.stringify(node), original);
  }
});

test('still accepts numbered field headings, colon fields and table labels', () => {
  const fields = readFields(
    '## 1. 建议学习时长\n60 分钟\n2、 难度：3\n### 3.1 章节/单元\n2 微分\n| 4. 重要程度 | 4 |\n5 填写人：同学甲\n6. 修改人：同学乙',
  );
  assert.equal(fields.duration, '60 分钟');
  assert.equal(fields.difficulty, '3');
  assert.equal(fields.chapter, '2 微分');
  assert.equal(fields.importance, '4');
  assert.deepEqual(fields.participants, ['同学甲', '同学乙']);
});

test('does not invent missing metadata, participants or inferred learning progress', () => {
  const value = model({
    id: 'A1',
    title: '空资料',
    sections: { basicInfoMarkdown: '填写人：待补充\n## 难度\n## 知识点名称\n空资料' },
  });
  assert.deepEqual(value.participants, []);
  assert.equal(value.difficulty, '');
  assert.equal(value.duration, '');
  assert.equal(value.summary, '');
  assert.equal(value.stars, undefined);
});

test('bounds overview prose, strips Markdown formatting, and keeps all people', () => {
  const people = Array.from({ length: 25 }, (_, i) => `同学${i}`);
  const value = model(
    {
      summary: '**摘要**'.repeat(80),
      sections: { basicInfoMarkdown: `参与同学：${people.join('、')}` },
    },
    { name: '课程名' },
  );
  assert.equal(value.summary.length, 151);
  assert.equal(value.course, '课程名');
  assert.deepEqual(value.participants, people);
});

test('overview keeps real chapter metadata and omits ordinal or identifier placeholders without inventing names', () => {
  for (const chapter of ['第一章', '第 X 章', 'Chapter N', 'Unit IV', '1', 'SS-01', 'SS-01-00']) {
    const node = { id: 'SS-01-01', sections: { basicInfoMarkdown: `章节/单元：${chapter}` } };
    assert.equal(model(node).chapter, '');
    assert.equal(content.chapterName([{ ...node, chapterTitle: chapter }], 'SS-01'), 'SS-01');
  }
  for (const chapter of ['线性时不变系统', '第1章 线性时不变系统', 'Chapter 1: Linear Systems']) {
    const node = { id: 'SS-01-01', sections: { basicInfoMarkdown: `章节/单元：${chapter}` } };
    assert.equal(model(node).chapter, chapter);
    assert.equal(content.chapterName([{ ...node, chapterTitle: chapter }], 'SS-01'), chapter);
  }
  assert.equal(
    model({
      id: 'SS-01-01',
      chapterTitle: '实际已发布章名',
      sections: { basicInfoMarkdown: '章节：第1章' },
    }).chapter,
    '实际已发布章名',
  );
  assert.equal(
    model({
      id: 'SS-01-01',
      chapterTitle: '第1章',
      sections: { basicInfoMarkdown: '章节：另一真实章名' },
    }).chapter,
    '另一真实章名',
  );
});

test('reviewer aliases retain all published contributors without adding missing authors', () => {
  assert.deepEqual(
    model({
      sections: {
        basicInfoMarkdown: '填写人：同学甲\n复核人：同学乙\n复核者：同学丙\n修改人：同学甲',
      },
    }).participants,
    ['同学甲', '同学乙', '同学丙'],
  );
});

function overviewHarness({ nativeDialog = true } = {}) {
  const starCalls = [];
  const requests = [];
  const assignments = [];
  const document = {};
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.attributes = new Map();
      this.listeners = new Map();
      this.dataset = {};
      this.className = '';
      this.hidden = false;
      this.open = false;
      this.isConnected = true;
      this.focusCount = 0;
      this.rect = { left: 20, right: 600, top: 20, bottom: 600 };
      this.classList = {
        add: (name) => {
          this.className = [this.className, name].filter(Boolean).join(' ');
        },
      };
    }

    append(...nodes) {
      this.children.push(...nodes);
    }

    replaceChildren(...nodes) {
      this.children = [...nodes];
      this.valueText = '';
      this.valueHtml = '';
    }

    get childElementCount() {
      return this.children.length;
    }

    set textContent(value) {
      this.valueText = value;
      this.children = [];
    }

    get textContent() {
      return (this.valueText || '') + this.children.map((node) => node.textContent || '').join('');
    }

    set innerHTML(value) {
      this.valueHtml = value;
      this.children = [];
    }

    get innerHTML() {
      return this.valueHtml || '';
    }

    setAttribute(name, value) {
      this.attributes.set(name, value);
    }

    getAttribute(name) {
      return this.attributes.get(name);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
    }

    fire(type, event = {}) {
      for (const listener of this.listeners.get(type) || []) listener({ target: this, ...event });
    }

    showModal() {
      this.open = true;
    }

    close() {
      this.open = false;
      this.fire('close');
    }

    focus() {
      this.focusCount += 1;
      document.activeElement = this;
    }

    getBoundingClientRect() {
      return this.rect;
    }
  }
  document.createElement = (tag) => {
    const item = new Element(tag);
    if (tag === 'dialog' && !nativeDialog) item.showModal = undefined;
    return item;
  };
  document.body = new Element('body');
  document.activeElement = new Element('button');
  const context = {
    document,
    URLSearchParams,
    module: { exports: {} },
    window: {
      location: { search: '?course=signals', assign: (url) => assignments.push(url) },
      FreeBbsLearningContent: content,
      FreeBbsLearningStars: {
        mount: (container, options) => starCalls.push({ container, options }),
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/knowledge-overview.js'), 'utf8'),
    context,
  );
  const app = {
    callApi: (route, options) =>
      new Promise((resolve, reject) => {
        requests.push({ route, options, resolve, reject });
      }),
    renderMarkdownContent: (markdown) => `rendered:${markdown}`,
    enhanceMarkdownContent() {},
  };
  const find = (node, predicate) =>
    predicate(node) ? node : node.children.map((child) => find(child, predicate)).find(Boolean);
  const byClass = (node, name) => find(node, (item) => item.className.split(' ').includes(name));
  return {
    api: context.module.exports,
    document,
    app,
    requests,
    starCalls,
    assignments,
    find,
    byClass,
  };
}

test('actual overview renderer puts meaning first, preserves all long labels and facts, and mounts unchanged stars', () => {
  const h = overviewHarness();
  const host = h.document.createElement('section');
  const node = {
    id: 'SS-01-01',
    title: '非常长但完整保留的知识点名称'.repeat(8),
    documentVersion: 'published-v2',
    summary: '从线性系统的真实问题理解卷积。',
    sections: {
      basicInfoMarkdown:
        '章节：线性时不变系统\n类型：方法\n层级：拓展\n难度：3\n重要程度：4\n建议时长：60 分钟\n参与同学：同学甲、同学乙、名字比较长的复核同学',
    },
  };
  const original = JSON.stringify(node);
  h.api.render(host, node, { slug: 'signals', name: '信号与系统' });
  const children = host.children.map((element) => element.className);
  assert.ok(
    children.indexOf('knowledge-overview-brief') < children.indexOf('knowledge-overview-facts'),
  );
  assert.equal(h.find(host, (element) => element.tagName === 'h2').textContent, node.title);
  assert.equal(h.byClass(host, 'knowledge-overview-chapter').textContent, '线性时不变系统');
  assert.equal(h.byClass(host, 'knowledge-overview-duration').textContent, '建议时长60 分钟');
  assert.match(h.byClass(host, 'knowledge-overview-facts').textContent, /3 \/ 5.*4 \/ 5/);
  assert.equal(h.byClass(host, 'knowledge-overview-people').children[1].children.length, 3);
  assert.equal(h.starCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.starCalls[0].options)), {
    courseSlug: 'signals',
    nodeId: 'SS-01-01',
    level: 'extension',
  });
  assert.equal(JSON.stringify(node), original);
});

test('empty legacy overview fields do not create blank facts, invented names or a chapter star record', () => {
  const h = overviewHarness();
  const host = h.document.createElement('section');
  h.api.render(host, { id: 'SS-01-00', title: '实际章名', sections: {} });
  for (const name of [
    'knowledge-overview-facts',
    'knowledge-overview-brief',
    'knowledge-overview-people',
    'knowledge-overview-chapter',
  ])
    assert.equal(h.byClass(host, name), undefined);
  assert.equal(h.starCalls.length, 0);
  assert.doesNotMatch(host.textContent, /暂未署名|待补充|0 \/ 5|已掌握/);
});

test('an unsupported native dialog is an absent optional drawer, not a throwing learning gate', () => {
  const h = overviewHarness({ nativeDialog: false });
  assert.equal(h.api.createDrawer({ app: h.app, courseSlug: 'signals' }), null);
  assert.equal(h.document.body.children.length, 0);
  assert.equal(h.requests.length, 0);
});

test('drawer keeps explicit actions available during loading and failure and restores its trigger focus', async () => {
  const h = overviewHarness();
  const drawer = h.api.createDrawer({ app: h.app, courseSlug: 'signals' });
  const dialog = h.document.body.children[0];
  const trigger = h.document.createElement('button');
  const opening = drawer.open(
    { id: 'SS-01-01', title: '连续时间卷积' },
    { name: '信号与系统' },
    trigger,
    () => {},
  );
  const body = h.byClass(dialog, 'knowledge-overview-drawer-body');
  const information = h.byClass(dialog, 'knowledge-overview-content');
  const status = h.byClass(dialog, 'knowledge-overview-status');
  const study = h.byClass(dialog, 'knowledge-overview-study');
  assert.equal(information.getAttribute('aria-busy'), 'true');
  assert.equal(body.getAttribute('aria-busy'), undefined);
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(study.textContent, '进入学习');
  assert.equal(study.href, '/knowledge?course=signals&point=SS-01-01&view=reading');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.method, 'GET');
  h.requests[0].reject(new Error('private internal error'));
  await opening;
  assert.equal(information.getAttribute('aria-busy'), 'false');
  assert.equal(status.dataset.state, 'error');
  assert.match(status.textContent, /直接进入学习/);
  assert.doesNotMatch(status.textContent, /private internal error/);
  h.find(dialog, (element) => element.getAttribute('aria-label') === '关闭学习概览').fire('click');
  assert.equal(drawer.isOpen(), false);
  assert.equal(trigger.focusCount, 1);
});

test('drawer ignores stale details, retains exact author sections and routes relation actions to the current point', async () => {
  const h = overviewHarness();
  const drawer = h.api.createDrawer({ app: h.app, courseSlug: 'signals' });
  const dialog = h.document.body.children[0];
  const selected = [];
  const first = drawer.open({ id: 'SS-01-01', title: '旧点' }, {}, null, (id) => selected.push(id));
  const latest = drawer.open({ id: 'SS-02-01', title: '当前点' }, {}, null, (id) =>
    selected.push(id),
  );
  const sections = {
    basicInfoMarkdown: '建议时长：60 分钟',
    applicationsMarkdown: '真实概览与起源',
    knowledgeMarkdown: '正文不混入概览',
  };
  h.requests[1].resolve({
    node: { id: 'SS-02-01', title: '当前点完整标题', documentVersion: 'published-v3', sections },
  });
  await latest;
  h.requests[0].resolve({ node: { id: 'SS-01-01', title: '迟来的旧点' } });
  await first;
  assert.equal(
    h.find(
      dialog,
      (element) => element.tagName === 'h2' && element.textContent === '当前点完整标题',
    ).textContent,
    '当前点完整标题',
  );
  assert.equal(h.byClass(dialog, 'knowledge-overview-status').textContent, '');
  const originals = h.byClass(dialog, 'knowledge-overview-originals');
  assert.equal(originals.hidden, false);
  assert.equal(originals.open, false);
  assert.equal(
    originals.children[1].innerHTML,
    `rendered:${sections.basicInfoMarkdown}\n\n${sections.applicationsMarkdown}`,
  );
  assert.doesNotMatch(originals.children[1].innerHTML, /正文不混入概览/);
  h.byClass(dialog, 'knowledge-overview-drawer-footer').children[0].fire('click');
  assert.deepEqual(selected, ['SS-02-01']);
  assert.equal(drawer.isOpen(), false);
});

test('chapter overview retains its actual network action and never invents individual learning evidence', async () => {
  const h = overviewHarness();
  const drawer = h.api.createDrawer({ app: h.app, courseSlug: 'signals' });
  const dialog = h.document.body.children[0];
  const opening = drawer.open({ id: 'SS-01-00', title: '时域分析' }, {}, null, () => {});
  h.requests[0].resolve({ node: { id: 'SS-01-00', title: '时域分析', sections: {} } });
  await opening;
  const relation = h.byClass(dialog, 'knowledge-overview-drawer-footer').children[0];
  assert.equal(relation.textContent, '查看章节知识网络');
  relation.fire('click');
  assert.deepEqual(h.assignments, [
    '/knowledge?course=signals&point=SS-01-00&view=reading#knowledge-chapter-network',
  ]);
  assert.equal(h.starCalls.length, 0);
});

test('cancelled catalog overviews return to their exact origin but relation actions and later unrelated entries do not reopen it', async () => {
  const h = overviewHarness();
  const drawer = h.api.createDrawer({ app: h.app, courseSlug: 'signals' });
  const dialog = h.document.body.children[0];
  const trigger = h.document.createElement('button');
  let dismissals = 0;
  let relations = 0;
  async function show(options) {
    const loading = drawer.open(
      { id: 'SS-01-01', title: '连续时间卷积' },
      {},
      trigger,
      () => {
        relations += 1;
      },
      options,
    );
    h.requests.at(-1).resolve({ node: { id: 'SS-01-01', title: '连续时间卷积', sections: {} } });
    await loading;
  }
  const options = {
    onDismiss() {
      dismissals += 1;
      return true;
    },
  };
  await show(options);
  h.byClass(dialog, 'knowledge-overview-drawer-header').children[1].fire('click');
  assert.equal(dismissals, 1);
  assert.equal(trigger.focusCount, 0, 'The catalog restores its own focused card');
  await show(options);
  h.byClass(dialog, 'knowledge-overview-drawer-footer').children[0].fire('click');
  assert.equal(dismissals, 1);
  assert.equal(relations, 1);
  await show();
  dialog.close();
  assert.equal(dismissals, 1, 'An unrelated point does not inherit the prior catalog');
  const before = trigger.focusCount;
  await show({ onDismiss: () => false });
  dialog.close();
  assert.equal(
    trigger.focusCount,
    before + 1,
    'A destroyed origin can fall back to the ordinary trigger',
  );
});

test('a deferred dialog close cannot steal the keyboard focus handed to the relationship destination', async () => {
  const h = overviewHarness();
  const drawer = h.api.createDrawer({ app: h.app, courseSlug: 'signals' });
  const dialog = h.document.body.children[0];
  const trigger = h.document.createElement('button');
  const destination = h.document.createElement('section');
  const opening = drawer.open({ id: 'SS-01-01', title: '卷积' }, {}, trigger, () =>
    destination.focus(),
  );
  h.requests[0].resolve({ node: { id: 'SS-01-01', title: '卷积', sections: {} } });
  await opening;
  h.byClass(dialog, 'knowledge-overview-drawer-footer').children[0].fire('click');
  dialog.fire('close');
  assert.equal(h.document.activeElement, destination);
  assert.equal(trigger.focusCount, 0);
});

test('overview style keeps short-screen scrolling, long text and themed explicit actions', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/knowledge-overview.css'), 'utf8');
  assert.match(
    css,
    /knowledge-overview-drawer-body\s*\{[^}]*overflow-y:\s*auto[^}]*min-height:\s*0/,
  );
  assert.match(css, /knowledge-overview-content h2\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /knowledge-overview-drawer-footer\s*\{[^}]*background:\s*var\(--ui-surface\)/);
  assert.match(
    css,
    /knowledge-overview-study\s*\{[^}]*color:\s*var\(--action-primary-text[^}]*background:\s*var\(--action-primary/,
  );
  assert.match(css, /@media \(max-height: 560px\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /:is\(button, a, summary\):focus-visible/);
});
