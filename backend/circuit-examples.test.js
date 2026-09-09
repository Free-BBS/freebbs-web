const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');
const { getDefaultExamples } = require('../public/circuit-default-examples');
const { validateExampleInput, validateDeleteInput } = require('./circuit-examples');

function input() {
  const { seedKey, ...example } = getDefaultExamples()[0];
  return example;
}

test('the three initial examples retain their circuit parameters and can be simulated', () => {
  const examples = getDefaultExamples();
  assert.deepEqual(
    examples.map((example) => example.seedKey),
    ['builtin-divider-v1', 'builtin-rc-v1', 'builtin-diode-v1'],
  );
  assert.deepEqual(
    examples.map((example) => example.title),
    ['电阻分压实验', 'RC 充电响应', '二极管伏安与整流'],
  );
  examples.forEach(({ seedKey, ...example }) => {
    const validated = validateExampleInput(example);
    const result = engine.simulate(validated.document);
    assert.ok(result.x.length);
    assert.ok(result.traces.every((trace) => trace.values.every(Number.isFinite)));
  });
  const divider = engine.simulate(examples[0].document);
  assert.equal(divider.traces.find((trace) => trace.id === 'V:VM1').values[0], 2.5);
  const first = examples[0].document;
  first.components[0].params.dc = 999;
  assert.equal(
    getDefaultExamples()[0].document.components[0].params.dc,
    5,
    'callers cannot mutate shared seed documents',
  );
});

test('default examples also expose a browser factory without requiring CommonJS', () => {
  const context = vm.createContext({ FreeBbsCircuitEngine: engine });
  const source = fs.readFileSync(
    path.join(__dirname, '../public/circuit-default-examples.js'),
    'utf8',
  );
  vm.runInContext(source, context);
  assert.equal(context.FreeBbsCircuitDefaultExamples.getDefaultExamples().length, 3);
});

test('example mutations reuse strict circuit document validation and revision checks', () => {
  const draft = input();
  assert.equal(
    validateExampleInput({ ...draft, expectedRevision: 1 }, { updating: true }).expectedRevision,
    1,
  );
  for (const changes of [
    { title: '' },
    { description: 'x'.repeat(2001) },
    { seed_key: 'builtin-divider-v1' },
    { is_deleted: 0 },
    { created_by: 1 },
    { document: null },
  ])
    assert.throws(() => validateExampleInput({ ...draft, ...changes }));
  const invalid = input();
  invalid.document.components[0].params.dc = Infinity;
  assert.throws(() => validateExampleInput(invalid));
  const polluted = JSON.parse('{"title":"x","document":{"__proto__":{"polluted":true}}}');
  assert.throws(() => validateExampleInput(polluted));
  assert.equal({}.polluted, undefined);
  for (const body of [
    undefined,
    null,
    [],
    {},
    { expectedRevision: '1' },
    { expectedRevision: 0 },
    { expectedRevision: 4294967295 },
    { expectedRevision: 1, is_deleted: 0 },
  ]) {
    assert.throws(() => validateDeleteInput(body));
  }
  assert.equal(validateDeleteInput({ expectedRevision: 2 }), 2);
});
