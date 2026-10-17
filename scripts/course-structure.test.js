const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  buildModel,
  initialState,
  reduceState,
  viewModel,
  layout,
  searchNodes,
  searchChapters,
  resumePoint,
  revealChapterInList,
  isChapterNode,
  abbreviateNodeId,
  isValidNodeId,
  nodeLevel,
  paginateMatches,
  normalizePickerState,
  relationGroups,
} = require('../public/course-structure');
const { isValidNodeId: isValidPublishedNodeId } = require('../backend/course-maps');
const learningContent = require('../public/learning-content');

const nodes = [
  { id: 'SS-01-00', title: '时域分析', summary: '课程组正式板块概览' },
  { id: 'SS-01-01', title: '卷积', aliases: ['convolution'], metadata: { 知识点层级: '核心' } },
  { id: 'SS-01-02', title: '脉冲响应', sections: { basicInfoMarkdown: '知识点层级：一般' } },
  { id: 'SS-01-03', title: '离散卷积', level: 'extension' },
  { id: 'SS-02-00', title: '频域分析' },
  { id: 'SS-02-01', title: '傅里叶变换' },
  { id: 'SS-02-02', title: '频谱' },
  { id: 'SS-03-01', title: '系统函数', chapterTitle: '系统分析' },
];
const edges = [
  { source: 'SS-01-00', target: 'SS-02-00', type: 'ordered', note: '课程组发布的板块顺序' },
  { source: 'SS-01-01', target: 'SS-01-02', type: 'ordered' },
  { source: 'SS-01-01', target: 'SS-02-01', type: 'related', note: '变换域表述' },
  { source: 'SS-01-01', target: 'SS-03-01', type: 'related' },
  { source: 'SS-02-01', target: 'SS-02-02', type: 'related' },
  { source: 'SS-01-00', target: 'SS-01-01', type: 'related' },
  { source: 'SS-99-01', target: 'SS-01-01', type: 'ordered' },
];
const model = buildModel(nodes, edges);

test('reader identifiers match the published API for legacy, deep and bounded node IDs', () => {
  const cases = [
    'SS-01',
    'SS-01-01',
    'SS-01-01-01',
    'CIRCUIT-A1-02-DEEP',
    `SS-${'A'.repeat(61)}`,
    `SS-${'A'.repeat(62)}`,
    'S-A',
    'SS',
    'ss-01',
    'SS--01',
    'SS-01-',
    '../SS-01',
    'SS-01/<script>',
    '信号-01',
    null,
    undefined,
    42,
    {},
  ];
  for (const id of cases) assert.equal(isValidNodeId(id), isValidPublishedNodeId(id), String(id));
  assert.equal(isValidNodeId('SS-01'), true);
  assert.equal(isValidNodeId('SS-01-01-01'), true);
  assert.equal(isValidNodeId(`SS-${'A'.repeat(61)}`), true);
  assert.equal(isValidNodeId(`SS-${'A'.repeat(62)}`), false);
});

test('legacy and deeper points stay in their original chapter with only direct cross-chapter relations', () => {
  const compatible = buildModel(
    [
      { id: 'SS-01', title: '历史知识点' },
      { id: 'SS-01-00', title: '时域分析' },
      { id: 'SS-01-01-01', title: '深入卷积' },
      { id: 'SS-01-01-00', title: '普通深层编号，并非章节概览' },
      { id: 'SS-02-00', title: '频域分析' },
      { id: 'SS-02-01-01', title: '变换域联系' },
      { id: 'SS-02-02', title: '非直接关联' },
    ],
    [
      { source: 'SS-01', target: 'SS-01-01-01', type: 'ordered' },
      { source: 'SS-01-01-01', target: 'SS-02-01-01', type: 'related' },
      { source: 'SS-02-01-01', target: 'SS-02-02', type: 'ordered' },
    ],
  );
  assert.equal(compatible.nodes.length, 7);
  assert.equal(isChapterNode(compatible.byId.get('SS-01')), false);
  assert.equal(isChapterNode(compatible.byId.get('SS-01-01-00')), false);
  assert.equal(compatible.chapters[0].overview.id, 'SS-01-00');
  assert.deepEqual(
    compatible.chapters.map((chapter) => chapter.title),
    ['时域分析', '频域分析'],
  );
  const focused = reduceState(initialState(), { type: 'focus', id: 'SS-01-01-01' }, compatible);
  assert.equal(focused.selectedChapterId, 'SS-01');
  const view = viewModel(compatible, focused);
  assert.deepEqual(
    view.knowledgeNodes.map((point) => point.id),
    ['SS-01', 'SS-01-01-01', 'SS-02-01-01'],
  );
  assert.equal(view.satellites[0].id, 'SS-02');
  assert.equal(view.links.length, 2);
  assert.deepEqual(
    layout(compatible, view)
      .boxes.map((box) => box.id)
      .sort(),
    ['SS-01', 'SS-01-01-01', 'SS-02-01-01'],
  );
  const legacy = reduceState(focused, { type: 'focus', id: 'SS-01' }, compatible);
  assert.equal(viewModel(compatible, legacy).focus.id, 'SS-01');
  assert.deepEqual(viewModel(compatible, initialState()).knowledgeNodes, []);
});

test('macro groups prefer real zero-level names and use only explicitly published zero-to-zero edges', () => {
  assert.deepEqual(
    model.chapters.map((group) => group.title),
    ['时域分析', '频域分析', '系统分析'],
  );
  assert.equal(model.chapters[0].overview.id, 'SS-01-00');
  assert.equal(model.macroEdges.length, 1);
  assert.equal(model.macroEdges[0].source, 'SS-01-00');
  assert.equal(model.knowledgeEdges.length, 4);
  assert.equal(isChapterNode({ id: 'SS-01-00' }), true);
  assert.equal(isChapterNode({ id: 'SS-01-01' }), false);
});

test('structure and directory share actual names instead of empty or ordinal chapter placeholders', () => {
  const points = [
    { id: 'CAL-01-000', title: '第 1 章' },
    { id: 'CAL-01-001', title: '实数', chapterTitle: '第1章' },
    { id: 'CAL-01-002', title: '数域', chapterTitle: '第1章 实数与实数的运算' },
    { id: 'CAL-02-000', title: '   ' },
    { id: 'CAL-02-001', title: '极限', metadata: { '章节/单元': '极限与连续' } },
    { id: 'CAL-03-001', title: '未知章内容', chapterTitle: '第X章' },
  ];
  const chapters = buildModel(points).chapters;
  assert.deepEqual(
    chapters.map((chapter) => chapter.title),
    ['第1章 实数与实数的运算', '极限与连续', 'CAL-03'],
  );
  for (const chapter of chapters)
    assert.equal(chapter.title, learningContent.chapterName(points, chapter.id));
  assert.equal(learningContent.chapterName(points, 'CAL-03', 'Chapter 3'), 'CAL-03');
  assert.equal(learningContent.chapterName(points, 'CAL-03', 'Chapter N'), 'CAL-03');
  assert.equal(learningContent.chapterName(points, 'CAL-03', 'Unit n'), 'CAL-03');
  assert.equal(learningContent.chapterName(points, 'CAL-03', '第3章'), 'CAL-03');
  assert.equal(
    learningContent.chapterName([{ id: 'CAL-01-000', title: '正式章名' }, ...points], 'CAL-01'),
    '正式章名',
  );
});
test('missing overview is a summary of actual chapter members and creates no fake knowledge node', () => {
  const group = model.chapters.at(-1);
  assert.equal(group.virtual, true);
  assert.equal(group.overview, null);
  assert.deepEqual(
    group.nodes.map((node) => node.id),
    ['SS-03-01'],
  );
  assert.equal(model.byId.has('SS-03-00'), false);
  assert.equal(model.nodes.length, nodes.length);
});
test('chapter selection and legacy expansion choose a chapter without drawing all its knowledge points', () => {
  let state = reduceState(initialState(), { type: 'select', id: 'SS-01' }, model);
  assert.equal(state.selectedChapterId, 'SS-01');
  assert.equal(viewModel(model, state).knowledgeNodes.length, 0);
  state = reduceState(state, { type: 'expand', id: 'SS-01' }, model);
  state = reduceState(state, { type: 'select', id: 'SS-02' }, model);
  assert.equal(state.selectedChapterId, 'SS-02');
  state = reduceState(state, { type: 'expand', id: 'SS-02' }, model);
  assert.equal(state.selectedChapterId, 'SS-02');
  assert.equal(state.focusedNodeId, '');
  const view = viewModel(model, state);
  assert.equal(view.focus, null);
  assert.deepEqual(view.knowledgeNodes, []);
  assert.deepEqual(view.links, []);
  assert.deepEqual(
    layout(model, view).boxes.map((box) => [box.kind, box.id]),
    [
      ['chapter', 'SS-01'],
      ['chapter', 'SS-02'],
      ['chapter', 'SS-03'],
    ],
  );
  assert.deepEqual(layout(model, view).regions, []);
});
test('an unfocused legacy state cannot restore an expanded whole-chapter graph', () => {
  const view = viewModel(model, { ...initialState(), expandedChapterId: 'SS-01' });
  assert.equal(view.focus, null);
  assert.deepEqual(view.knowledgeNodes, []);
  assert.deepEqual(view.links, []);
  assert.deepEqual(view.satellites, []);
  const graph = layout(model, view);
  assert.equal(graph.boxes.length, model.chapters.length);
  assert.equal(
    graph.boxes.every((box) => box.kind === 'chapter'),
    true,
  );
  assert.deepEqual(graph.regions, []);
});
test('one-hop focus shows only direct neighbors and aggregates satellites by their real chapter owner', () => {
  const state = reduceState(initialState(), { type: 'focus', id: 'SS-01-01' }, model);
  const view = viewModel(model, state);
  assert.deepEqual(
    view.knowledgeNodes.map((node) => node.id),
    ['SS-01-01', 'SS-01-02', 'SS-02-01', 'SS-03-01'],
  );
  assert.deepEqual(
    view.satellites.map((group) => [group.id, group.title, group.nodes.map((node) => node.id)]),
    [
      ['SS-02', '频域分析', ['SS-02-01']],
      ['SS-03', '系统分析', ['SS-03-01']],
    ],
  );
  assert.equal(
    view.knowledgeNodes.some((node) => node.id === 'SS-02-02'),
    false,
  );
  assert.equal(view.links.length, 3);
  assert.equal(
    view.links.every((edge) => edge.source === view.focus.id || edge.target === view.focus.id),
    true,
  );
  const moved = reduceState(state, { type: 'focus', id: 'SS-02-01' }, model);
  assert.equal(moved.selectedChapterId, 'SS-02');
  const movedView = viewModel(model, moved);
  assert.deepEqual(
    movedView.knowledgeNodes.map((node) => node.id),
    ['SS-01-01', 'SS-02-01', 'SS-02-02'],
  );
  assert.deepEqual(
    movedView.satellites.map((group) => [group.id, group.nodes.map((node) => node.id)]),
    [['SS-01', ['SS-01-01']]],
  );
});
test('clearing focus, choosing a chapter and resetting return to the macro graph without a whole chapter', () => {
  const focused = reduceState(initialState(), { type: 'focus', id: 'SS-02-01' }, model);
  for (const action of [
    { type: 'unfocus' },
    { type: 'select', id: 'SS-01' },
    { type: 'expand', id: 'SS-02' },
    { type: 'collapse' },
    { type: 'reset' },
  ]) {
    const state = reduceState(focused, action, model);
    const view = viewModel(model, state);
    assert.equal(state.focusedNodeId, '', action.type);
    assert.equal(view.focus, null, action.type);
    assert.deepEqual(view.knowledgeNodes, [], action.type);
    assert.deepEqual(view.links, [], action.type);
    assert.deepEqual(view.satellites, [], action.type);
    assert.equal(
      layout(model, view).boxes.every((box) => box.kind === 'chapter'),
      true,
      action.type,
    );
    assert.deepEqual(layout(model, view).regions, [], action.type);
  }
  assert.equal(reduceState(focused, { type: 'unfocus' }, model).selectedChapterId, 'SS-02');
  assert.deepEqual(reduceState(focused, { type: 'reset' }, model), initialState());
});
test('legacy learning-order edges stay explicitly learning order rather than becoming academic prerequisites', () => {
  const state = reduceState(initialState(), { type: 'focus', id: 'SS-01-01' }, model);
  const filtered = viewModel(
    model,
    reduceState(state, { type: 'filter', value: 'related' }, model),
  );
  assert.equal(filtered.links.find((edge) => edge.type === 'ordered').active, false);
  assert.equal(
    filtered.links.filter((edge) => edge.type === 'related').every((edge) => edge.active),
    true,
  );
  assert.equal(
    filtered.links.some((edge) => edge.type === 'prerequisite'),
    false,
  );
});
test('search supports published names, IDs and aliases and immediately focuses a knowledge result', () => {
  assert.equal(searchNodes(model, 'convolution')[0].id, 'SS-01-01');
  assert.equal(searchNodes(model, '时域')[0].id, 'SS-01-00');
  assert.equal(searchNodes(model, ' ss-02-01 ')[0].id, 'SS-02-01');
  assert.equal(searchNodes(model, '不存在').length, 0);
  const result = searchNodes(model, '傅里叶')[0];
  const state = reduceState(initialState(), { type: 'locate', id: result.id }, model);
  assert.equal(state.selectedChapterId, 'SS-02');
  assert.equal(state.focusedNodeId, 'SS-02-01');
  assert.deepEqual(state, reduceState(initialState(), { type: 'focus', id: result.id }, model));
  assert.deepEqual(
    viewModel(model, state).knowledgeNodes.map((node) => node.id),
    ['SS-01-01', 'SS-02-01', 'SS-02-02'],
  );
  const moved = reduceState(state, { type: 'locate', id: 'SS-03-01' }, model);
  assert.equal(moved.selectedChapterId, 'SS-03');
  assert.equal(moved.focusedNodeId, 'SS-03-01');
  assert.deepEqual(
    viewModel(model, moved).knowledgeNodes.map((node) => node.id),
    ['SS-01-01', 'SS-03-01'],
  );
});
test('published core, general and optional levels remain distinct from selection and unknown metadata', () => {
  assert.equal(nodeLevel(nodes[1]), 'core');
  assert.equal(nodeLevel(nodes[2]), 'general');
  assert.equal(nodeLevel(nodes[3]), 'extension');
  assert.equal(nodeLevel(nodes[5]), '');
});
test('a 600-point chapter stays a macro node until a single point and its direct relations are selected', () => {
  const large = buildModel(
    [
      { id: 'SS-01-000', title: '大章节' },
      ...Array.from({ length: 600 }, (_, index) => ({
        id: `SS-01-${String(index + 1).padStart(3, '0')}`,
        title: `知识点 ${index}`,
      })),
      { id: 'SS-02-00', title: '关联章节' },
      { id: 'SS-02-01', title: '跨章直接关联' },
      { id: 'SS-02-02', title: '跨章二跳关联' },
    ],
    [
      { source: 'SS-01-001', target: 'SS-01-002', type: 'ordered' },
      { source: 'SS-01-002', target: 'SS-01-003', type: 'related' },
      { source: 'SS-02-01', target: 'SS-01-001', type: 'related' },
      { source: 'SS-02-01', target: 'SS-02-02', type: 'related' },
    ],
  );
  assert.equal(large.chapters[0].nodes.length, 600);
  for (const type of ['select', 'expand']) {
    const state = reduceState(initialState(), { type, id: 'SS-01' }, large);
    const view = viewModel(large, state);
    assert.equal(view.knowledgeNodes.length, 0, type);
    assert.equal(view.links.length, 0, type);
    assert.equal(layout(large, view).boxes.length, 2, type);
    assert.deepEqual(layout(large, view).regions, [], type);
  }
  const focused = reduceState(initialState(), { type: 'focus', id: 'SS-01-001' }, large);
  const view = viewModel(large, focused);
  assert.deepEqual(
    view.knowledgeNodes.map((node) => node.id),
    ['SS-01-001', 'SS-01-002', 'SS-02-01'],
  );
  assert.equal(view.links.length, 2);
  assert.deepEqual(
    view.satellites.map((group) => [group.id, group.nodes.map((node) => node.id)]),
    [['SS-02', ['SS-02-01']]],
  );
  const first = layout(large, view);
  const second = layout(large, view);
  assert.equal(first.boxes.length, 3);
  assert.deepEqual(first, second);
  assert.equal(Number.isFinite(first.width) && Number.isFinite(first.height), true);
  assert.equal(
    first.boxes.every((box) => Number.isFinite(box.x) && Number.isFinite(box.y)),
    true,
  );
});
test('compact layout keeps two-chapter one-hop graphs in bounded, non-overlapping single columns', () => {
  const compactModel = buildModel(
    [
      { id: 'SS-01-00', title: '中心章节', position: { x: 500, y: 800 } },
      { id: 'SS-01-01', title: '中心知识点', position: { x: 500, y: 800 } },
      { id: 'SS-01-02', title: '同章直接关联', position: { x: 900, y: 800 } },
      { id: 'SS-01-03', title: '同章二跳关联' },
      { id: 'SS-02-00', title: '关联章节', position: { x: 9000, y: 800 } },
      { id: 'SS-02-01', title: '跨章入向关联', position: { x: 1000, y: 500 } },
      { id: 'SS-02-02', title: '跨章出向关联', position: { x: 2000, y: 500 } },
      { id: 'SS-02-03', title: '跨章二跳关联' },
    ],
    [
      { source: 'SS-01-01', target: 'SS-01-02', type: 'ordered' },
      { source: 'SS-01-02', target: 'SS-01-03', type: 'related' },
      { source: 'SS-02-01', target: 'SS-01-01', type: 'related' },
      { source: 'SS-01-01', target: 'SS-02-02', type: 'related' },
      { source: 'SS-02-01', target: 'SS-02-03', type: 'related' },
    ],
  );
  const state = reduceState(initialState(), { type: 'focus', id: 'SS-01-01' }, compactModel);
  const view = viewModel(compactModel, state);
  const compact = layout(compactModel, view, { compact: true });
  const desktop = layout(compactModel, view);
  assert.deepEqual(compact.boxes.map((box) => box.id).sort(), [
    'SS-01-01',
    'SS-01-02',
    'SS-02-01',
    'SS-02-02',
  ]);
  assert.equal(compact.boxes.length, desktop.boxes.length);
  assert.deepEqual(compact.regions, []);
  assert.equal(compact.width <= 380, true);
  assert.deepEqual(compact, layout(compactModel, view, { compact: true }));
  assert.equal(new Set(compact.boxes.map((box) => box.x)).size, 1);
  assert.equal(compact.boxes[0].id, view.focus.id);
  for (let index = 1; index < compact.boxes.length; index += 1)
    assert.equal(
      compact.boxes[index].y >= compact.boxes[index - 1].y + compact.boxes[index - 1].height,
      true,
    );
  assert.equal(
    compact.boxes.every(
      (box) =>
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= compact.width &&
        box.y + box.height <= compact.height,
    ),
    true,
  );
  const macro = layout(compactModel, viewModel(compactModel), { compact: true });
  assert.equal(macro.boxes.length, 2);
  assert.equal(macro.boxes[0].x, macro.boxes[1].x);
  assert.equal(macro.boxes[1].y >= macro.boxes[0].y + macro.boxes[0].height, true);
  assert.equal(macro.width <= 380, true);
  assert.deepEqual(macro.regions, []);
});
test('sparse authored coordinates are reused while collisions fall back to readable deterministic slots', () => {
  const links = [{ source: 'SS-01-01', target: 'SS-01-02', type: 'related' }];
  const positioned = buildModel(
    [
      { id: 'SS-01-01', title: 'A', position: { x: 500, y: 800 } },
      { id: 'SS-01-02', title: 'B', position: { x: 900, y: 800 } },
    ],
    links,
  );
  const state = reduceState(initialState(), { type: 'focus', id: 'SS-01-01' }, positioned);
  const boxes = layout(positioned, viewModel(positioned, state)).boxes.filter(
    (box) => box.kind === 'knowledge',
  );
  assert.equal(boxes[1].x - boxes[0].x, 400);
  assert.equal(boxes[1].y, boxes[0].y);
  const overlapping = buildModel(
    positioned.nodes.map((node) => ({ ...node, position: { x: 0, y: 0 } })),
    links,
  );
  const fallback = layout(overlapping, viewModel(overlapping, state)).boxes.filter(
    (box) => box.kind === 'knowledge',
  );
  assert.equal(fallback[1].x - fallback[0].x, 234);
});
test('invalid transitions, duplicate IDs and mixed-level links do not corrupt published models', () => {
  const input = JSON.stringify({ nodes, edges });
  const cleaned = buildModel([...nodes, nodes[0], { id: '<invalid>', title: 'bad' }], edges);
  assert.equal(cleaned.nodes.length, nodes.length);
  assert.deepEqual(
    reduceState(initialState(), { type: 'expand', id: 'missing' }, model),
    initialState(),
  );
  assert.deepEqual(
    reduceState(initialState(), { type: 'focus', id: 'SS-01-00' }, model),
    initialState(),
  );
  assert.equal(JSON.stringify({ nodes, edges }), input);
});

function matchingPoints(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `SS-01-${String(index + 1).padStart(4, '0')}`,
    title: `卷积 practice ${index + 1}`,
  }));
}

test('search returns all 55 or 1000 real matches and paginates every result exactly once at forty per page', () => {
  for (const count of [0, 40, 41, 55, 80, 81, 1000]) {
    const large = buildModel(matchingPoints(count));
    const matches = searchNodes(large, ' 卷积 practice ');
    assert.equal(matches.length, count);
    const ids = [];
    const pageCount = Math.max(1, Math.ceil(count / 40));
    for (let index = 0; index < pageCount; index += 1) {
      const page = paginateMatches(matches, index);
      assert.equal(page.total, count);
      assert.equal(page.pageCount, pageCount);
      assert.equal(page.page, index);
      assert.equal(page.nodes.length <= 40, true);
      assert.equal(page.start, count ? index * 40 + 1 : 0);
      assert.equal(page.end, Math.min((index + 1) * 40, count));
      ids.push(...page.nodes.map((node) => node.id));
    }
    assert.deepEqual(
      ids,
      matches.map((node) => node.id),
    );
    assert.equal(new Set(ids).size, count);
    assert.equal(paginateMatches(matches, Number.MAX_VALUE).page, pageCount - 1);
  }
});

test('picker normalization rejects malformed scope/query/page without inferring relations or losing typed spaces', () => {
  const large = buildModel(matchingPoints(1000));
  for (const value of [null, [], 'SS-01', 42])
    assert.deepEqual(normalizePickerState(large, value), { chapterId: '', query: '', page: 0 });
  for (const page of [NaN, Infinity, -10, '2', {}, null])
    assert.equal(normalizePickerState(large, { page }).page, 0);
  assert.equal(normalizePickerState(large, { page: 2.9 }).page, 2);
  assert.equal(normalizePickerState(large, { page: Number.MAX_VALUE }).page, 24);
  assert.deepEqual(normalizePickerState(large, { chapterId: 'missing', query: {}, page: 99 }), {
    chapterId: '',
    query: '',
    page: 24,
  });
  assert.deepEqual(
    normalizePickerState(large, { chapterId: 'SS-01', query: ' 卷积 practice ', page: 1 }),
    {
      chapterId: 'SS-01',
      query: ' 卷积 practice ',
      page: 1,
    },
  );
  assert.equal(normalizePickerState(large, { query: '不存在', page: 100 }).page, 0);
  assert.deepEqual(large.knowledgeEdges, []);
});

function readerFixture(inputNodes, inputEdges = [], fixtureOptions = {}) {
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.attributes = {};
      this.listeners = new Map();
      this.className = '';
      this.dataset = {};
      this.value = '';
      this.hidden = false;
      this.disabled = false;
      this.clientWidth = 800;
      this.clientHeight = 500;
      this.copy = '';
      this.classList = {
        contains: (name) => this.className.split(' ').includes(name),
        add: (name) => {
          if (!this.classList.contains(name)) this.className = `${this.className} ${name}`.trim();
        },
        remove: (name) => {
          this.className = this.className
            .split(' ')
            .filter((item) => item !== name)
            .join(' ');
        },
        toggle: (name, enabled) => {
          if (enabled) this.classList.add(name);
          else this.classList.remove(name);
        },
      };
    }

    get textContent() {
      return this.copy + this.children.map((child) => child.textContent).join('');
    }

    set textContent(value) {
      this.copy = String(value);
      this.children = [];
    }

    get childNodes() {
      return this.children;
    }

    append(...children) {
      children.forEach((child) => {
        child.parent = this;
        this.children.push(child);
      });
    }

    replaceChildren(...children) {
      this.children = [];
      this.append(...children);
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'class') this.className = String(value);
    }

    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    }

    dispatch(type, extra = {}) {
      this.listeners.get(type)?.({ target: this, preventDefault() {}, ...extra });
    }

    click() {
      if (!this.disabled) this.dispatch('click');
    }

    focus(options) {
      this.focusOptions = options;
      document.activeElement = this;
    }

    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
    }

    setPointerCapture(pointerId) {
      this.pointerId = pointerId;
    }

    closest(selector) {
      if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) return this;
      return this.parent?.closest(selector) || null;
    }

    remove() {
      if (this.parent)
        this.parent.children = this.parent.children.filter((child) => child !== this);
    }
  }
  const document = {
    createElement: (tag) => new Element(tag),
    createElementNS: (namespace, tag) => new Element(tag),
  };
  const container = new Element('main');
  container.ownerDocument = document;
  let nativeBack = 0;
  const window = {
    document,
    history: {
      back: () => {
        nativeBack += 1;
      },
    },
    location: {},
    FreeBbsKnowledgeOverview: require('../public/knowledge-overview'),
    FreeBbsLearningContent: learningContent,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/course-structure.js'), 'utf8'),
    { window, URLSearchParams },
  );
  const controller = window.FreeBbsCourseStructure.render({
    container,
    nodes: inputNodes,
    edges: inputEdges,
    ...fixtureOptions,
  });
  const all = (predicate, item = container) => [
    ...(predicate(item) ? [item] : []),
    ...item.children.flatMap((child) => all(predicate, child)),
  ];
  return {
    controller,
    activeElement: () => document.activeElement,
    nativeBack: () => nativeBack,
    byClass: (name) => all((item) => item.classList.contains(name))[0],
    byLabel: (label) => all((item) => item.attributes['aria-label'] === label)[0],
    button: (label) => all((item) => item.tag === 'button' && item.textContent === label)[0],
    point: (id) => all((item) => item.dataset.coursePointId === id)[0],
    graphIds: () =>
      all((item) => item.classList.contains('is-knowledge'))
        .map((item) => item.attributes['aria-label'].split(' ')[0])
        .sort(),
  };
}

test('real reader search UI shows totals and all 55/1000 results, then reveals the selected filtered picker page', () => {
  for (const count of [55, 1000]) {
    const h = readerFixture(matchingPoints(count));
    const search = h.byLabel('查找课程知识点');
    search.value = '卷积 practice';
    search.dispatch('input');
    assert.match(
      h.byClass('course-structure-search-summary').textContent,
      new RegExp(`共 ${count} 个结果`),
    );
    const ids = [];
    for (let index = 0; index < Math.ceil(count / 40); index += 1) {
      const buttons = h
        .byClass('course-structure-search-results')
        .children.filter((item) => item.tag === 'button');
      assert.equal(buttons.length <= 40, true);
      ids.push(...buttons.map((item) => item.textContent.split(' ')[0]));
      if (index < Math.ceil(count / 40) - 1) h.byClass('course-structure-search-next').click();
      else buttons.at(-1).click();
    }
    assert.equal(new Set(ids).size, count);
    assert.equal(h.controller.getState().focusedNodeId, matchingPoints(count).at(-1).id);
    assert.deepEqual(
      { ...h.controller.getPickerState() },
      { chapterId: 'SS-01', query: '卷积 practice', page: Math.ceil(count / 40) - 1 },
    );
    assert.ok(h.point(matchingPoints(count).at(-1).id));
    assert.equal(h.byClass('course-structure-search-panel').hidden, true);
    h.byClass('course-structure-back').click();
    assert.equal(h.byClass('course-structure-search-panel').hidden, false);
    assert.match(
      h.byClass('course-structure-search-paging').textContent,
      new RegExp(`${Math.ceil(count / 40)} / ${Math.ceil(count / 40)}`),
    );
    search.value = 'practice 1';
    search.dispatch('input');
    assert.match(h.byClass('course-structure-search-paging').textContent, /^上一页1 \/ /);
  }
});

test('cross-chapter focus/back restores all-chapter filtered second-page context and camera operations create no navigation', () => {
  const many = matchingPoints(100);
  many.slice(55).forEach((node) => {
    node.title = '未匹配正文';
  });
  const target = 'SS-01-0045';
  const h = readerFixture(
    [...many, { id: 'SS-02-01', title: '跨章直接关联' }, { id: 'SS-02-02', title: '二跳点' }],
    [
      { source: target, target: 'SS-02-01', type: 'related' },
      { source: 'SS-02-01', target: 'SS-02-02', type: 'ordered' },
    ],
  );
  const pickerSearch = h.byClass('course-structure-picker-search');
  for (const value of ['卷积 ', '卷积 practice']) {
    pickerSearch.value = value;
    pickerSearch.dispatch('input');
    assert.equal(pickerSearch.value, value);
  }
  h.byClass('course-structure-picker-next').click();
  h.point(target).click();
  assert.deepEqual(h.graphIds(), [target, 'SS-02-01']);
  h.controller.focusNode('SS-02-01');
  assert.deepEqual(h.graphIds(), [target, 'SS-02-01', 'SS-02-02']);
  const viewer = h.byClass('course-structure-viewer');
  viewer.dispatch('wheel', { deltaY: -1, clientX: 100, clientY: 100 });
  viewer.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
  viewer.dispatch('pointermove', { pointerId: 1, clientX: 120, clientY: 80 });
  viewer.dispatch('pointerup');
  for (const key of ['+', '-', 'Home', 'ArrowLeft', 'ArrowDown'])
    viewer.dispatch('keydown', { key });
  h.button('重置图位置').click();
  h.byClass('course-structure-back').click();
  assert.equal(h.controller.getState().focusedNodeId, target);
  assert.deepEqual(
    { ...h.controller.getPickerState() },
    { chapterId: '', query: '卷积 practice', page: 1 },
  );
  assert.ok(h.point(target));
  h.controller.focusNode('missing');
  h.controller.selectChapter('missing');
  h.byClass('course-structure-back').click();
  assert.equal(h.controller.getState().focusedNodeId, '');
  assert.deepEqual(
    { ...h.controller.getPickerState() },
    { chapterId: '', query: '卷积 practice', page: 1 },
  );
  h.byClass('course-structure-back').click();
  assert.equal(h.nativeBack(), 1, 'Invalid transitions and camera gestures did not add history');
});

test('chapter ID search selects a real chapter without leaving its point picker empty and back restores the search', () => {
  const h = readerFixture(nodes, edges);
  const search = h.byLabel('查找课程知识点');
  search.value = 'SS-02-00';
  search.dispatch('input');
  h.byClass('course-structure-search-chapters')
    .children.find((item) => item.tag === 'button')
    .click();
  assert.equal(h.controller.getState().selectedChapterId, 'SS-02');
  assert.equal(h.controller.getState().focusedNodeId, '');
  assert.deepEqual(h.graphIds(), []);
  assert.deepEqual(
    { ...h.controller.getPickerState() },
    { chapterId: 'SS-02', query: '', page: 0 },
  );
  assert.ok(h.point('SS-02-01'));
  h.byClass('course-structure-back').click();
  assert.equal(search.value, 'SS-02-00');
  assert.equal(h.byClass('course-structure-search-panel').hidden, false);
});

test('legacy chapter names have independent search entries without creating zero-level nodes or opening a document', () => {
  const points = [
    { id: 'CAL-11-001', title: '数项级数', chapterTitle: '第11章 级数' },
    { id: 'CAL-11-002', title: '幂级数', chapterTitle: '第11章 级数' },
    { id: 'CAL-12-001', title: '含参积分', chapterTitle: '第12章 含参积分' },
  ];
  const current = buildModel(points);
  assert.equal(current.nodes.length, 3);
  assert.deepEqual(
    searchChapters(current, '第11章 级数').map((chapter) => chapter.id),
    ['CAL-11'],
  );
  assert.deepEqual(
    searchChapters(current, 'CAL-12').map((chapter) => chapter.id),
    ['CAL-12'],
  );
  assert.deepEqual(searchChapters(current, ''), []);
  assert.deepEqual(searchChapters(current, '<img>'), []);
  let openings = 0;
  const h = readerFixture(points, [], {
    onOpenOverview: () => {
      openings += 1;
    },
  });
  const search = h.byLabel('查找课程知识点');
  search.value = '第11章 级数';
  search.dispatch('input');
  assert.match(h.byClass('course-structure-search-summary').textContent, /1 个章节 · 2 个知识点/);
  const entry = h.byClass('course-structure-search-chapters').children[0];
  assert.equal(entry.dataset.courseSearchChapterId, 'CAL-11');
  entry.click();
  assert.equal(h.controller.getState().selectedChapterId, 'CAL-11');
  assert.equal(h.controller.getState().focusedNodeId, '');
  assert.equal(
    openings,
    0,
    'A derived chapter group must never be opened as a fake authoring node',
  );
  assert.deepEqual(h.graphIds(), []);
  assert.equal(h.byClass('course-structure-search-label').children[0].textContent, '全课程搜索');
  assert.equal(
    h.byClass('course-structure-picker-search-label').children[0].textContent,
    '筛选当前章节',
  );
  h.byClass('course-structure-back').click();
  assert.equal(search.value, '第11章 级数');
  assert.equal(h.byClass('course-structure-search-panel').hidden, false);
});

test('resume is a validated ordinary point with explicit read and locate actions rather than an automatic learning transition', () => {
  const points = matchingPoints(67);
  const current = buildModel([...points, { id: 'SS-01-00', title: '真实章名' }]);
  assert.equal(resumePoint(current, 'SS-01-0066').id, 'SS-01-0066');
  for (const value of ['', null, {}, 'SS-99-01', 'SS-01-00', '<img>'])
    assert.equal(resumePoint(current, value), null);
  let openings = 0;
  const h = readerFixture(points, [], {
    course: { slug: 'signals', name: '信号与系统' },
    resumeNodeId: 'SS-01-0066',
    onOpenOverview: () => {
      openings += 1;
    },
  });
  const recent = h.byClass('course-structure-resume');
  assert.equal(recent.dataset.courseResumeId, 'SS-01-0066');
  assert.match(recent.textContent, /上次看到.*卷积 practice.*继续阅读.*查看位置/);
  const link = h
    .byClass('course-structure-resume-actions')
    .children.find((item) => item.tag === 'a');
  assert.equal(link.href, '/knowledge?course=signals&point=SS-01-0066&view=reading');
  assert.equal(h.controller.getState().focusedNodeId, '');
  assert.equal(openings, 0);
  h.button('查看位置').click();
  assert.equal(h.controller.getState().focusedNodeId, 'SS-01-0066');
  assert.deepEqual(
    { ...h.controller.getPickerState() },
    { chapterId: 'SS-01', query: '', page: 1 },
  );
  assert.ok(h.point('SS-01-0066'));
  assert.equal(openings, 0, 'Locating a recent point does not read or submit anything');
  assert.deepEqual(h.graphIds(), ['SS-01-0066']);
  for (const resumeNodeId of ['', 'SS-99-01', 'SS-01-00']) {
    const fresh = readerFixture([...points, { id: 'SS-01-00', title: '真实章名' }], [], {
      course: { slug: 'signals' },
      resumeNodeId,
    });
    assert.equal(fresh.byClass('course-structure-resume'), undefined);
  }
});

test('chapter visibility adjusts only its own scroll offset, with no focus or document scrolling', () => {
  const list = {
    clientHeight: 200,
    clientTop: 0,
    scrollTop: 100,
    getBoundingClientRect: () => ({ top: 100 }),
  };
  const item = (top, bottom) => ({
    getBoundingClientRect: () => ({ top, bottom }),
    focus: () => {
      throw new Error('Must not change keyboard focus');
    },
    scrollIntoView: () => {
      throw new Error('Must not scroll the document');
    },
  });
  revealChapterInList(list, item(340, 380));
  assert.equal(list.scrollTop, 184);
  list.scrollTop = 100;
  revealChapterInList(list, item(70, 90));
  assert.equal(list.scrollTop, 66);
  list.scrollTop = 100;
  revealChapterInList(list, item(120, 180));
  assert.equal(list.scrollTop, 100);
  revealChapterInList(list, item(400, 900));
  assert.equal(list.scrollTop, 396);
});

test('a cross-chapter global result reveals the owner-filtered page instead of reusing its global page and returns the prior picker', () => {
  const first = matchingPoints(55);
  const second = matchingPoints(55).map((node) => ({
    ...node,
    id: node.id.replace('SS-01-', 'SS-02-'),
  }));
  const h = readerFixture([...first, ...second]);
  h.controller.selectChapter('SS-01');
  const picker = h.byClass('course-structure-picker-search');
  picker.value = '卷积 practice';
  picker.dispatch('input');
  h.byClass('course-structure-picker-next').click();
  h.point('SS-01-0045').click();
  const search = h.byLabel('查找课程知识点');
  search.value = '卷积 practice';
  search.dispatch('input');
  h.byClass('course-structure-search-next').click();
  h.byClass('course-structure-search-next').click();
  const result = h
    .byClass('course-structure-search-results')
    .children.find((item) => item.tag === 'button' && item.textContent.startsWith('SS-02-0045 '));
  assert.ok(result);
  result.click();
  assert.equal(h.controller.getState().focusedNodeId, 'SS-02-0045');
  assert.deepEqual(
    { ...h.controller.getPickerState() },
    { chapterId: 'SS-02', query: '卷积 practice', page: 1 },
  );
  assert.ok(h.point('SS-02-0045'));
  assert.deepEqual(
    h.graphIds(),
    ['SS-02-0045'],
    'Identifier order does not generate prerequisite or neighbor edges',
  );
  h.byClass('course-structure-back').click();
  assert.equal(h.controller.getState().focusedNodeId, 'SS-01-0045');
  assert.deepEqual(
    { ...h.controller.getPickerState() },
    { chapterId: 'SS-01', query: '卷积 practice', page: 1 },
  );
  assert.equal(h.byClass('course-structure-search-panel').hidden, false);
  assert.match(h.byClass('course-structure-search-paging').textContent, /3 \/ 3/);
});

const directionalNodes = [
  { id: 'EE-01-00', title: '真实章名一' },
  {
    id: 'EE-01-01',
    title: '当前内容',
    metadata: { 知识点层级: '核心' },
    sections: { basicInfoMarkdown: '知识点层级：核心' },
  },
  { id: 'EE-01-02', title: '课程组标记前序' },
  { id: 'EE-01-03', title: '课程组标记后序' },
  { id: 'EE-02-00', title: '真实章名二' },
  { id: 'EE-02-01', title: '跨章补充内容' },
  { id: 'EE-02-02', title: '不直接相关' },
];
const directionalEdges = [
  { source: 'EE-01-02', target: 'EE-01-01', type: 'ordered', note: '发布的前序说明' },
  { source: 'EE-01-01', target: 'EE-01-03', type: 'ordered' },
  { source: 'EE-02-01', target: 'EE-01-01', type: 'related', note: '发布的补充说明' },
  { source: 'EE-02-01', target: 'EE-02-02', type: 'ordered' },
  { source: 'EE-01-00', target: 'EE-02-00', type: 'ordered' },
];

test('relationship text groups only published one-hop edges by actual direction and never creates academic prerequisites', () => {
  const before = JSON.stringify({ directionalNodes, directionalEdges });
  const source = buildModel(directionalNodes, directionalEdges);
  const focused = reduceState(initialState(), { type: 'focus', id: 'EE-01-01' }, source);
  const groups = relationGroups(viewModel(source, focused));
  assert.deepEqual(
    groups.map((group) => [group.key, group.title, group.items.map((item) => item.node.id)]),
    [
      ['incoming', '可先了解', ['EE-01-02']],
      ['outgoing', '接着了解', ['EE-01-03']],
      ['related', '补充联系', ['EE-02-01']],
    ],
  );
  assert.equal(groups.flatMap((group) => group.items).flatMap((item) => item.edges).length, 3);
  assert.equal(
    groups.flatMap((group) => group.items).some((item) => item.node.id === 'EE-02-02'),
    false,
  );
  const filtered = relationGroups(
    viewModel(source, reduceState(focused, { type: 'filter', value: 'related' }, source)),
  );
  assert.deepEqual(
    filtered.map((group) => group.items.length),
    [0, 0, 1],
  );
  assert.deepEqual(
    relationGroups(viewModel(source)).map((group) => group.items),
    [[], [], []],
  );
  assert.equal(JSON.stringify({ directionalNodes, directionalEdges }), before);
});

test('directory containment is separate from current-point relations and metadata comes after readable relationship text', () => {
  const h = readerFixture(directionalNodes, directionalEdges);
  const directory = h.byClass('course-structure-sidebar');
  assert.equal(directory.children[0].className, 'course-structure-chapters');
  assert.match(directory.children[0].textContent, /真实章名一包含 3 个知识点/);
  assert.match(directory.children[0].textContent, /真实章名二包含 2 个知识点/);
  directory.children[0].children.find((item) => item.dataset.courseChapterId === 'EE-01').click();
  assert.equal(h.controller.getState().focusedNodeId, '');
  assert.deepEqual(h.graphIds(), []);
  h.point('EE-01-01').click();
  const content = h.byClass('course-structure-current');
  const detail = h.byClass('course-structure-details');
  assert.equal(content.children[0], detail);
  assert.equal(content.children[1].tag, 'details');
  assert.equal(Boolean(content.children[1].open), false);
  assert.match(detail.textContent, /所属章节：真实章名一 · EE-01-01/);
  assert.match(detail.textContent, /可先了解1 个课程组标记前序/);
  assert.match(detail.textContent, /接着了解1 个课程组标记后序/);
  assert.match(detail.textContent, /补充联系1 个跨章补充内容所属章节：真实章名二/);
  assert.match(detail.textContent, /不表示必须先修/);
  assert.ok(
    detail.children.indexOf(h.byClass('course-structure-relations')) <
      detail.children.indexOf(h.byClass('course-structure-information')),
  );
  assert.equal(Boolean(h.byClass('course-structure-information').open), false);
  assert.ok(h.button('学习概览'));
  assert.deepEqual(h.graphIds(), ['EE-01-01', 'EE-01-02', 'EE-01-03', 'EE-02-01']);
});

test('chapter entry previews use at most three actual points without a fabricated overview or whole-chapter graph', () => {
  const title = '真实作者提供的长章节名称：连续时间系统的时域分析与信号处理';
  const points = Array.from({ length: 67 }, (_, index) => ({
    id: `SS-01-${String(index + 1).padStart(3, '0')}`,
    title: `真实知识点 ${index + 1}：允许完整显示的长标题`,
    chapterTitle: title,
    level: index % 2 ? 'core' : 'general',
  }));
  const h = readerFixture(points);
  h.controller.selectChapter('SS-01');
  const detail = h.byClass('course-structure-details');
  const entries = h.byClass('course-structure-chapter-entries');
  assert.match(detail.textContent, new RegExp(title));
  assert.match(detail.textContent, /67 个知识点/);
  assert.doesNotMatch(detail.textContent, /概览尚未发布|暂无板块概览/);
  assert.deepEqual(
    entries.children.map((entry) => entry.dataset.coursePreviewPointId),
    ['SS-01-001', 'SS-01-002', 'SS-01-003'],
  );
  assert.deepEqual(h.graphIds(), [], 'Choosing a chapter does not expand its point graph');
  const before = h.controller.getState();
  h.byClass('course-structure-picker-open').click();
  assert.equal(h.activeElement(), h.byClass('course-structure-picker-search'));
  assert.deepEqual(h.controller.getState(), before, 'Opening the search creates no navigation');
  entries.children[1].click();
  assert.equal(h.controller.getState().focusedNodeId, 'SS-01-002');
  assert.deepEqual(h.graphIds(), ['SS-01-002']);
  assert.equal(
    h.byClass('course-structure-filters'),
    undefined,
    'No unused filter for no relations',
  );
});

test('relation cards visibly separate published categories and cross-chapter ownership while retaining local navigation', () => {
  const h = readerFixture(directionalNodes, directionalEdges);
  h.controller.focusNode('EE-01-01');
  const cards = h.byClass('course-structure-relations');
  assert.deepEqual(
    cards.children.map((card) => card.dataset.relationGroup),
    ['incoming', 'outgoing', 'related'],
  );
  assert.equal(cards.children[0].children[1].classList.contains('is-cross-chapter'), false);
  assert.equal(cards.children[2].children[1].classList.contains('is-cross-chapter'), true);
  const entry = cards.children[2].children[1].children[0];
  assert.equal(entry.dataset.courseRelatedId, 'EE-02-01');
  entry.click();
  assert.equal(h.controller.getState().focusedNodeId, 'EE-02-01');
  h.byClass('course-structure-back').click();
  assert.equal(h.controller.getState().focusedNodeId, 'EE-01-01');
});

test('empty relationships stay honest and the accessible auxiliary graph remains optional with no chapter fences', () => {
  const h = readerFixture(directionalNodes);
  h.controller.focusNode('EE-01-01');
  assert.match(h.byClass('course-structure-relations').textContent, /尚未发布直接关系/);
  const graph = h.byClass('course-structure-graph-area');
  assert.equal(graph.tag, 'details');
  assert.equal(graph.children[0].tag, 'summary');
  assert.match(graph.children[0].textContent, /当前点直连关系图/);
  assert.equal(Boolean(graph.open), false);
  graph.open = true;
  graph.dispatch('toggle');
  assert.equal(h.byClass('course-structure-region'), undefined);
  assert.equal(
    h.byClass('course-structure-legend').textContent,
    '实线箭头：学习顺序 · 虚线：补充联系',
  );
  const viewer = h.byClass('course-structure-viewer');
  const transform = viewer.children[0].children[0].attributes.transform;
  assert.ok(
    Number(transform.match(/scale\(([^)]+)\)/)[1]) >= 1,
    'Default fit never shrinks core text',
  );
  viewer.dispatch('keydown', {
    target: h.byClass('course-structure-picker-search'),
    key: 'ArrowDown',
  });
  assert.equal(
    viewer.children[0].children[0].attributes.transform,
    transform,
    'Form direction keys are not graph controls',
  );
  h.byClass('course-structure-back').click();
  assert.equal(h.controller.getState().focusedNodeId, '');
  assert.match(graph.children[0].textContent, /板块顺序图/);
  assert.match(h.byClass('course-structure-legend').textContent, /尚未发布板块之间/);
});

test('knowledge graph cards omit overflowing summaries while full text metadata and chapter counts remain available', () => {
  const summary = '这是一段很长的正式摘要，完整内容应在知识点信息中阅读，而不是溢出辅助图卡片。';
  const h = readerFixture(
    directionalNodes.map((node) => (node.id === 'EE-01-01' ? { ...node, summary } : node)),
    directionalEdges,
  );
  assert.match(h.byClass('course-structure-node-detail').textContent, /3 个知识点/);
  h.controller.focusNode('EE-01-01');
  assert.equal(h.byClass('course-structure-node-detail'), undefined);
  assert.match(h.byClass('course-structure-information').textContent, new RegExp(summary));
  const viewer = h.byClass('course-structure-viewer');
  viewer.dispatch('keydown', { key: '+' });
  assert.equal(h.byClass('course-structure-node-detail'), undefined);
  assert.match(h.byClass('course-structure-information').textContent, new RegExp(summary));
});

test('graph ID abbreviation preserves ordinary IDs and distinguishable head/tail while navigation and access names keep the full ID', () => {
  assert.equal(abbreviateNodeId('SS-01-01'), 'SS-01-01');
  const longId = `SS-01-${'A'.repeat(54)}-END`;
  assert.equal(longId.length, 64);
  assert.equal(abbreviateNodeId(longId), 'SS-01…-END');
  assert.notEqual(abbreviateNodeId(longId), abbreviateNodeId(longId.replace(/END$/, 'ALT')));
  assert.equal(abbreviateNodeId(longId, 5), 'SS…ND');
  for (const limit of [NaN, Infinity, null, -1, '10'])
    assert.match(abbreviateNodeId(longId, limit), /^SS.*….*ND$/);
  const h = readerFixture([
    { id: 'SS-01-00', title: '真实章节' },
    { id: longId, title: '真实长编号内容' },
  ]);
  h.point(longId).click();
  assert.equal(h.controller.getState().focusedNodeId, longId);
  const node = h.byLabel(`${longId} 真实长编号内容`);
  assert.equal(node.children[1].textContent, `${abbreviateNodeId(longId)} · 当前点`);
  assert.match(node.children.at(-1).textContent, new RegExp(longId));
  assert.match(h.byClass('course-structure-details').textContent, new RegExp(longId));
});

test('relationship filter replacement restores focus to the new same-key button without changing point selection', () => {
  const h = readerFixture(directionalNodes, directionalEdges);
  h.controller.focusNode('EE-01-01');
  const original = h.button('学习顺序');
  original.focus();
  original.click();
  const replacement = h.button('学习顺序');
  assert.notEqual(replacement, original);
  assert.equal(h.activeElement(), replacement);
  assert.equal(replacement.dataset.courseRelationFilter, 'ordered');
  assert.equal(h.controller.getState().focusedNodeId, 'EE-01-01');
  assert.equal(h.controller.getState().filter, 'ordered');
  replacement.click();
  assert.equal(h.activeElement(), replacement, 'Already active filtering keeps the existing focus');
  h.button('补充关联').click();
  assert.equal(h.activeElement(), h.button('补充关联'));
});

test('local Back restores its focused replacement without resetting picker or visible search context', () => {
  const h = readerFixture([...matchingPoints(55), { id: 'SS-02-01', title: '跨章目标' }]);
  const pickerSearch = h.byClass('course-structure-picker-search');
  pickerSearch.value = '卷积 practice';
  pickerSearch.dispatch('input');
  h.byClass('course-structure-picker-next').click();
  h.point('SS-01-0045').click();
  const search = h.byLabel('查找课程知识点');
  search.value = '卷积 practice';
  search.dispatch('input');
  h.byClass('course-structure-search-next').click();
  const previousState = JSON.parse(JSON.stringify(h.controller.getState()));
  const previousPicker = { ...h.controller.getPickerState() };
  const previousSummary = h.byClass('course-structure-search-summary').textContent;
  const previousPaging = h.byClass('course-structure-search-paging').textContent;
  h.controller.focusNode('SS-02-01');
  const original = h.byClass('course-structure-back');
  original.focus();
  original.click();
  const replacement = h.byClass('course-structure-back');
  assert.notEqual(replacement, original);
  assert.ok(h.activeElement() === replacement, 'A replaced Back control must remain focused');
  assert.equal(replacement.focusOptions?.preventScroll, true, 'Focus alone must not scroll');
  assert.deepEqual(JSON.parse(JSON.stringify(h.controller.getState())), previousState);
  assert.deepEqual({ ...h.controller.getPickerState() }, previousPicker);
  assert.ok(h.point('SS-01-0045'));
  assert.equal(search.value, '卷积 practice');
  assert.equal(pickerSearch.value, '卷积 practice');
  assert.equal(h.byClass('course-structure-search-panel').hidden, false);
  assert.equal(h.byClass('course-structure-search-summary').textContent, previousSummary);
  assert.equal(h.byClass('course-structure-search-paging').textContent, previousPaging);
});

test('local Back does not steal a stable input focus and native history Back adds no focus mutation', () => {
  const h = readerFixture(nodes, edges);
  h.controller.focusNode('SS-01-01');
  h.controller.focusNode('SS-02-01');
  const search = h.byLabel('查找课程知识点');
  search.focus();
  h.byClass('course-structure-back').click();
  assert.equal(
    h.activeElement(),
    search,
    'Only the replaced focused Back button needs restoration',
  );
  assert.equal(h.controller.getState().focusedNodeId, 'SS-01-01');
  h.byClass('course-structure-back').click();
  const original = h.byClass('course-structure-back');
  original.focus();
  original.click();
  assert.equal(h.nativeBack(), 1);
  assert.equal(h.byClass('course-structure-back'), original);
  assert.equal(
    h.activeElement(),
    original,
    'Native history owns navigation when local history is empty',
  );
});

test('mobile reader CSS reserves the document focus scrollport above navigation without changing its layer or desktop layout', () => {
  // Source contract only: actual Chromium Tab scrolling and occlusion need the
  // separate native browser check, not this lightweight DOM fixture.
  const css = fs.readFileSync(path.join(__dirname, '../public/course-structure.css'), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 900px)'));
  assert.match(
    mobile,
    /html:has\(body\.course-reader-page\)\s*\{\s*scroll-padding-block-end:\s*calc\(\s*var\(--mobile-nav-space,\s*calc\(64px\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\)\)\s*\+\s*12px\s*\);\s*\}/,
  );
  assert.match(
    mobile,
    /body\.course-reader-page\s+\.course-structure\s+:where\(button, input, select, a, summary, \[tabindex\]\)\s*\{\s*scroll-margin-block-end:\s*8px;\s*\}/,
  );
  assert.doesNotMatch(
    css.slice(0, css.indexOf('@media (max-width: 900px)')),
    /scroll-padding-block-end/,
  );
  assert.doesNotMatch(mobile, /z-index\s*:|position\s*:\s*fixed|overflow\s*:\s*hidden/);
  assert.match(css, /\.course-structure-current\s*\{[^}]*scroll-margin-top:\s*90px;/);
});
