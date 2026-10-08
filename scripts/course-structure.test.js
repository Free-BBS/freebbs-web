const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildModel,
  initialState,
  reduceState,
  viewModel,
  layout,
  searchNodes,
  isChapterNode,
  nodeLevel,
} = require('../public/course-structure');

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
  assert.equal(compact.regions.length, 2);
  assert.equal(compact.width <= 380, true);
  assert.deepEqual(compact, layout(compactModel, view, { compact: true }));
  const central = compact.regions.find((region) => !region.satellite);
  const satellite = compact.regions.find((region) => region.satellite);
  assert.equal(satellite.y >= central.y + central.height, true);
  for (const [index, region] of compact.regions.entries()) {
    const members = compact.boxes.filter((box) => box.id.startsWith(`${region.id}-`));
    assert.equal(new Set(members.map((box) => box.x)).size, 1, region.id);
    assert.equal(members[1].y > members[0].y, true, region.id);
    assert.equal(
      members.every(
        (box) =>
          box.x >= region.x &&
          box.y >= region.y &&
          box.x + box.width <= region.x + region.width &&
          box.y + box.height <= region.y + region.height,
      ),
      true,
      region.id,
    );
    for (const other of compact.regions.slice(index + 1))
      assert.equal(
        region.x + region.width <= other.x ||
          other.x + other.width <= region.x ||
          region.y + region.height <= other.y ||
          other.y + other.height <= region.y,
        true,
        `${region.id} and ${other.id}`,
      );
  }
  assert.equal(
    compact.regions.every(
      (region) =>
        region.x >= 0 &&
        region.y >= 0 &&
        region.x + region.width <= compact.width &&
        region.y + region.height <= compact.height,
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
