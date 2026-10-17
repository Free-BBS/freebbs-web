const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { buildRoute } = require('../public/learning-route');

const node = (id) => ({ id, title: id, position: { x: 0, y: 0 } });
const series = (count, chapter = 'SS-01') =>
  Array.from({ length: count }, (_, index) =>
    node(`${chapter}-${String(index + 1).padStart(3, '0')}`),
  );
const link = (source, target, type = 'ordered') => ({ source, target, type });
const options = { chapterId: 'SS-01' };

function check(result, inputEdges) {
  assert.ok(result.steps.length <= result.pageSize && result.steps.length <= 12);
  assert.ok(result.page >= 0 && result.page === result.currentPage);
  const visible = new Set(result.steps.map((step) => step.id));
  const stageMembers = result.stages.flatMap((stage) => stage.steps);
  assert.deepEqual(stageMembers, result.steps);
  result.steps.forEach((step) => {
    assert.equal(step.locked, false);
    assert.ok(Number.isInteger(step.index) && step.index >= 0);
    assert.ok(Number.isInteger(step.stage) && step.stage >= 0);
    for (const edge of [...step.incoming, ...step.outgoing, ...step.relations])
      assert.ok(inputEdges.includes(edge), 'every claimed relationship has an actual input edge');
    step.incoming.forEach((edge) => assert.equal(edge.target, step.id));
    step.outgoing.forEach((edge) => assert.equal(edge.source, step.id));
  });
  result.connections.forEach((connection) => {
    assert.ok(inputEdges.includes(connection.edge));
    assert.equal(connection.edge.type, 'ordered');
    assert.equal(connection.source, connection.edge.source);
    assert.equal(connection.target, connection.edge.target);
    assert.equal(connection.sourceVisible, visible.has(connection.source));
    assert.equal(connection.targetVisible, visible.has(connection.target));
    assert.ok(connection.sourceVisible || connection.targetVisible);
  });
}

test('UMD chapter route can load in Node or a browser global without DOM or other reader modules', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/learning-route.js'), 'utf8'),
    sandbox,
  );
  assert.equal(typeof sandbox.window.FreeBbsLearningRoute.buildRoute, 'function');
});

test('an empty or invalid chapter has honest empty directory state and no synthetic point', () => {
  const result = buildRoute();
  assert.equal(result.total, 0);
  assert.equal(result.kind, 'directory');
  assert.equal(result.pageCount, 0);
  assert.equal(result.previous, null);
  assert.equal(result.next, null);
  assert.equal(result.entry, null);
  assert.deepEqual(result.steps, []);
  assert.equal(buildRoute(series(3), [], { chapterId: 'not a chapter' }).total, 0);
});

test('without published order the model preserves directory input order, not ID-based prerequisites', () => {
  const nodes = [node('SS-01-Z'), node('SS-01-A'), node('SS-01-M')];
  const edges = [link('SS-01-A', 'SS-01-M', 'related')];
  const result = buildRoute(nodes, edges, options);
  check(result, edges);
  assert.equal(result.kind, 'directory');
  assert.equal(result.label, '章节目录顺序');
  assert.deepEqual(
    result.steps.map((step) => step.id),
    nodes.map((point) => point.id),
  );
  assert.deepEqual(result.connections, []);
  assert.ok(
    result.steps.every(
      (step) => step.kind === 'directory' && !step.incoming.length && !step.outgoing.length,
    ),
  );
  assert.deepEqual(result.entry, { nodeId: 'SS-01-Z', kind: 'start', page: 0 });
});

test('real fork and merge edges form stages but never a fabricated adjacent chain', () => {
  const nodes = series(5);
  const edges = [
    link(nodes[0].id, nodes[1].id),
    link(nodes[0].id, nodes[2].id),
    link(nodes[1].id, nodes[3].id),
    link(nodes[2].id, nodes[3].id),
    link(nodes[3].id, nodes[4].id, 'related'),
  ];
  const result = buildRoute(nodes, edges, options);
  check(result, edges);
  assert.equal(result.kind, 'ordered');
  assert.equal(result.label, '已发布学习顺序');
  assert.equal(result.steps[0].branch.fork, true);
  assert.equal(result.steps.find((step) => step.id === nodes[3].id).branch.merge, true);
  assert.deepEqual(
    result.steps.map((step) => step.stage),
    [0, 1, 1, 2, 3],
  );
  assert.equal(result.steps.at(-1).kind, 'independent');
  assert.equal(result.steps.at(-1).relations[0], edges.at(-1));
  assert.equal(result.connections.length, 4);
  assert.equal(
    result.connections.some(
      (connection) => connection.source === nodes[1].id && connection.target === nodes[2].id,
    ),
    false,
  );
});

test('cycles, self links and parallel edges remain finite, explicit and freely accessible', () => {
  const nodes = series(5);
  const edges = [
    link(nodes[0].id, nodes[1].id),
    link(nodes[1].id, nodes[2].id),
    link(nodes[2].id, nodes[0].id),
    link(nodes[2].id, nodes[3].id),
    link(nodes[3].id, nodes[3].id),
    link(nodes[2].id, nodes[3].id),
  ];
  const result = buildRoute(nodes, edges, options);
  check(result, edges);
  assert.deepEqual(
    result.steps.slice(0, 3).map((step) => step.stage),
    [0, 0, 0],
  );
  assert.ok(result.steps.slice(0, 4).every((step) => step.branch.cycle));
  assert.equal(result.steps[3].stage, 1);
  assert.equal(
    result.steps[3].branch.merge,
    false,
    'parallel links and a self loop do not invent distinct incoming branches',
  );
  assert.equal(result.steps[4].kind, 'independent');
  assert.equal(result.connections.length, edges.length);
});

test('related or cross-chapter one-hop links remain visible facts without creating chapter learning order', () => {
  const nodes = [...series(4), ...series(2, 'SS-02')];
  const edges = [
    link(nodes[0].id, nodes[4].id),
    link(nodes[5].id, nodes[1].id),
    link(nodes[1].id, nodes[2].id, 'related'),
    link(nodes[3].id, nodes[5].id, 'related'),
  ];
  const result = buildRoute(nodes, edges, options);
  check(result, edges);
  assert.equal(result.total, 4);
  assert.equal(result.kind, 'directory');
  assert.equal(result.connections.length, 0);
  assert.equal(result.steps[0].relations[0], edges[0]);
  assert.equal(result.steps[1].relations.length, 2);
  assert.ok(result.steps.every((step) => !step.branch.fork && !step.branch.merge));
});

test('invalid IDs, dangling and unsupported links cannot manufacture route entries, while legacy and deep IDs remain usable', () => {
  const nodes = [
    null,
    {},
    node('SS-01-000'),
    node('SS-01-001'),
    node('SS-01-001'),
    node('SS-01-001-SUB'),
    node('SS-01'),
    node('bad-id'),
    node('SS-01-002<script>'),
    node('X'.repeat(65)),
  ];
  const edges = [
    link('SS-01-001', 'SS-01-001-SUB'),
    link('SS-01-000', 'SS-01-001'),
    link('SS-01-001', 'SS-01-UNKNOWN'),
    link('SS-01', 'SS-01-001', 'mystery'),
  ];
  const result = buildRoute(nodes, edges, options);
  check(result, edges);
  assert.equal(result.total, 3);
  assert.ok(!result.steps.some((step) => step.id === 'SS-01-000'));
  assert.equal(result.connections.length, 1);
  assert.equal(result.steps.find((step) => step.id === 'SS-01').kind, 'independent');
});

test('resume locates its real page, selected point takes priority, and an explicit legal page always wins', () => {
  const nodes = series(49);
  const resumeNodeId = nodes[40].id;
  const selectedNodeId = nodes[14].id;
  const resumed = buildRoute(nodes, [], { ...options, resumeNodeId });
  assert.equal(resumed.page, 6);
  assert.deepEqual(resumed.entry, { nodeId: resumeNodeId, kind: 'continue', page: 6 });
  assert.equal(resumed.steps.filter((step) => step.resume).length, 1);
  const selected = buildRoute(nodes, [], { ...options, resumeNodeId, selectedNodeId });
  assert.equal(selected.page, 2);
  assert.equal(selected.entry.kind, 'selected');
  assert.equal(selected.steps.find((step) => step.entry).id, selectedNodeId);
  const explicit = buildRoute(nodes, [], { ...options, resumeNodeId, selectedNodeId, page: 0 });
  assert.equal(explicit.page, 0);
  assert.equal(
    explicit.entry.page,
    2,
    'an off-page real entry remains locatable without overriding the explicit page',
  );
  assert.equal(
    explicit.steps.some((step) => step.entry),
    false,
  );
});

test('invalid or other-chapter resume never sends a learner to a made-up point or a different course chapter', () => {
  const nodes = [...series(10), ...series(10, 'SS-02')];
  const result = buildRoute(nodes, [], {
    ...options,
    resumeNodeId: 'SS-02-008',
    selectedNodeId: 'missing',
  });
  assert.equal(result.entry.kind, 'start');
  assert.equal(result.entry.nodeId, nodes[0].id);
  assert.equal(result.page, 0);
});

test('all 49, 165 and 600 actual-shaped chapter points remain reachable exactly once through bounded pages', () => {
  for (const count of [49, 165, 600]) {
    const nodes = series(count);
    const edges = nodes.slice(1).map((point, index) => link(nodes[index].id, point.id));
    const gathered = [];
    const seenEdges = new Set();
    const first = buildRoute(nodes, edges, options);
    for (let page = 0; page < first.pageCount; page += 1) {
      const result = buildRoute(nodes, edges, { ...options, page });
      check(result, edges);
      assert.equal(result.total, count);
      assert.equal(result.previous, page > 0 ? page - 1 : null);
      assert.equal(result.next, page + 1 < first.pageCount ? page + 1 : null);
      result.steps.forEach((step) => gathered.push(step.id));
      result.connections.forEach((connection) => seenEdges.add(connection.edge));
    }
    assert.deepEqual(
      gathered,
      nodes.map((point) => point.id),
    );
    assert.equal(new Set(gathered).size, count);
    assert.equal(seenEdges.size, edges.length);
  }
});

test('cross-page connections name only actual endpoints and report their real page rather than a decorative next-point edge', () => {
  const nodes = series(13);
  const edges = [
    link(nodes[0].id, nodes[8].id),
    link(nodes[0].id, nodes[9].id),
    link(nodes[8].id, nodes[10].id),
    link(nodes[9].id, nodes[10].id),
  ];
  const result = buildRoute(nodes, edges, { ...options, pageSize: 2 });
  check(result, edges);
  assert.ok(result.connections.some((connection) => !connection.targetVisible));
  for (const connection of result.connections) {
    assert.equal(connection.sourcePage, 0);
    assert.ok(connection.targetPage === 0 || connection.targetPage === 1);
  }
});

test('bounded page settings reject malformed state, clamp range and do not permit a 600-card render', () => {
  const nodes = series(600);
  assert.equal(buildRoute(nodes, [], { ...options, page: 999999 }).page, 99);
  assert.equal(buildRoute(nodes, [], { ...options, pageSize: 999 }).steps.length, 12);
  for (const page of [-1, 1.5, Infinity, NaN, '2']) {
    const result = buildRoute(nodes, [], { ...options, page, resumeNodeId: nodes[19].id });
    assert.equal(result.page, 3);
  }
  for (const pageSize of [0, -1, 1.5, Infinity, NaN, 'invalid'])
    assert.equal(buildRoute(nodes, [], { ...options, pageSize }).pageSize, 6);
});

test('route building never mutates author positions, original progress or provided relationships', () => {
  const nodes = series(8);
  nodes[2].progress = { stars: 2, completed: true };
  const edges = [link(nodes[6].id, nodes[0].id), link(nodes[2].id, nodes[3].id, 'related')];
  const snapshot = JSON.stringify({ nodes, edges });
  nodes.forEach((point) => {
    Object.freeze(point.position);
    if (point.progress) Object.freeze(point.progress);
    Object.freeze(point);
  });
  edges.forEach(Object.freeze);
  Object.freeze(nodes);
  Object.freeze(edges);
  const result = buildRoute(nodes, edges, { ...options, selectedNodeId: nodes[7].id });
  check(result, edges);
  assert.equal(JSON.stringify({ nodes, edges }), snapshot);
  assert.ok(
    result.steps.every((step) => step.node === nodes.find((point) => point.id === step.id)),
  );
});

test('a 600-member ordered cycle does not recurse, hang, infer mastery or lose isolated material', () => {
  const nodes = series(601);
  const edges = nodes
    .slice(0, 600)
    .map((point, index) => link(point.id, nodes[(index + 1) % 600].id));
  const result = buildRoute(nodes, edges, { ...options, resumeNodeId: nodes[599].id });
  check(result, edges);
  assert.equal(result.total, 601);
  assert.equal(result.entry.kind, 'continue');
  assert.ok(
    result.steps
      .filter((step) => step.kind === 'ordered')
      .every((step) => step.branch.cycle && step.stage === 0),
  );
  const last = buildRoute(nodes, edges, { ...options, selectedNodeId: nodes[600].id });
  assert.equal(last.steps.find((step) => step.id === nodes[600].id).kind, 'independent');
});
