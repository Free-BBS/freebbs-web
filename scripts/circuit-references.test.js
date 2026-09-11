const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { parseReference } = require('../public/circuit-embeds');
const { getPins, formatValue } = require('../public/circuit-renderer');

const origin = 'https://www.free-bbs.cn';
const cid = 'c_0123456789abcdef01234567';

test('references resolve only explicit same-site circuit views pinned to a revision', () => {
  for (const view of ['live', 'waveform', 'schematic']) {
    assert.deepEqual(parseReference(`/circuit?cid=${cid}&revision=4&view=${view}`, origin), {
      cid,
      revision: 4,
      view,
    });
    assert.deepEqual(
      parseReference(`${origin}/circuit?view=${view}&revision=4&cid=${cid}`, origin),
      { cid, revision: 4, view },
    );
  }
  for (const value of [
    `/circuit?cid=${cid}`,
    `/circuit?cid=${cid}&view=live`,
    `/circuit?cid=${cid}&revision=0&view=live`,
    `/circuit?cid=${cid}&revision=01&view=live`,
    `/circuit?cid=${cid}&revision=1&view=constructor`,
    `/circuit?cid=${cid}&revision=1&view=live&view=waveform`,
    `/circuit?cid=${cid}&revision=1&view=live&cid=${cid}`,
    `https://attacker.example/circuit?cid=${cid}&revision=1&view=live`,
    `//attacker.example/circuit?cid=${cid}&revision=1&view=live`,
    // eslint-disable-next-line no-script-url -- rejected input for the reference URL parser
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    `/circuit?cid=../../secret&revision=1&view=live`,
  ])
    assert.equal(parseReference(value, origin), null, value);
});

test('rotated electrical pin positions preserve the declared netlist ordering', () => {
  const component = { id: 'R1', type: 'resistor', x: 100, y: 100, rotation: 90 };
  assert.deepEqual(
    getPins(component).map(({ x, y }) => [x, y]),
    [
      [100, 60],
      [100, 140],
    ],
  );
  const transistor = getPins({ ...component, type: 'bjt', rotation: 0 });
  assert.deepEqual(
    transistor.map(({ label }) => label),
    ['C', 'B', 'E'],
  );
  assert.deepEqual(
    transistor.map(({ x, y }) => [x, y]),
    [
      [100, 60],
      [60, 100],
      [100, 140],
    ],
  );
  assert.equal(getPins({ ...component, type: 'vcvs' }).length, 4);
});

test('instrument readings display SI prefixes without inventing nonfinite measurements', () => {
  assert.equal(formatValue(0.001, 'A'), '1 mA');
  assert.equal(formatValue(1000, 'Ω'), '1 kΩ');
  assert.equal(formatValue(-0.000001, 'A'), '-1 µA');
  assert.equal(formatValue(0, 'V'), '0 V');
  assert.equal(formatValue(NaN, 'V'), '—');
});

test('the common Markdown enhancement enables references for posts, replies and knowledge content', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
  const functionBody = source.slice(
    source.indexOf('function enhanceMarkdownContent'),
    source.indexOf('\nfunction setAiChatStatus'),
  );
  assert.match(functionBody, /enhanceCircuitReferences\(root\)/);
  assert.match(source, /script\.src = '\/circuit-embeds\.js'/);
  assert.match(source, /'\/circuits': '电路实验室'/);
});
