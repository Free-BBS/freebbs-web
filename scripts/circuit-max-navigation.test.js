const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/circuit.js'), 'utf8');
const handoff = source.slice(
  source.indexOf('  function askMaxAboutCircuit()'),
  source.indexOf('  function renderWaveform()'),
);

test('asking Max opens an editable prompt pinned to the viewed saved circuit version', () => {
  const state = { cid: 'c_0123456789abcdef01234567', revision: 4, dirty: false, saving: false };
  const destinations = [];
  const context = {
    state,
    URLSearchParams,
    window: { location: { assign: (url) => destinations.push(url) } },
  };
  vm.runInNewContext(handoff, context);
  context.askMaxAboutCircuit();
  const url = new URL(destinations[0], 'https://example.test');
  assert.equal(url.pathname, '/aichat');
  const prompt = url.searchParams.get('prompt');
  assert.match(prompt, /revision=4&view=schematic/);
  assert.match(prompt, /检查元件参数和接线/);
  for (const change of [
    { dirty: true },
    { dirty: false, saving: true },
    { saving: false, cid: '' },
  ]) {
    Object.assign(state, change);
    context.askMaxAboutCircuit();
  }
  assert.equal(destinations.length, 1, 'unsaved edits cannot be presented as the saved circuit');
});
