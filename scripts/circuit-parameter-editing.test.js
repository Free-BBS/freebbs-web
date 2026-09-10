const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');

const source = fs.readFileSync(path.join(__dirname, '../public/circuit.js'), 'utf8');
const functions = [
  'renderSchematic',
  'parameterInput',
  'parameterFieldsHtml',
  'syncParameterPopover',
  'wireLabel',
  'renderInspector',
  'updateParameter',
  'sourceParameterHint',
  'renderSourceParameterHint',
  'validateParameterInputs',
];
const extracted = functions
  .map((name) => {
    const start = source.indexOf(`  function ${name}(`);
    assert.notEqual(start, -1, `Missing editor function ${name}`);
    const end = source.indexOf('\n  function ', start + 1);
    return source.slice(start, end === -1 ? undefined : end);
  })
  .join('\n');
const parameterLabels = source.slice(
  source.indexOf('  const parameterLabels ='),
  source.indexOf('  const state ='),
);
const clone = (value) => JSON.parse(JSON.stringify(value));

function input(key, value, focusState) {
  const focus = focusState;
  return {
    dataset: { parameter: key },
    value: String(value),
    validityMessage: '',
    setCustomValidity(message) {
      this.validityMessage = message;
    },
    focus() {
      focus.activeElement = this;
      focus.calls += 1;
    },
  };
}

function harness({ selectedId = 'R1', editable = true, listPage = false } = {}) {
  const focusState = { activeElement: null, calls: 0 };
  const state = {
    document: engine.validateDocument({
      version: 1,
      components: [
        { id: 'R1', type: 'resistor', x: 200, y: 200, params: { resistance: 1000 } },
        { id: 'V1', type: 'voltage', x: 100, y: 200, params: { dc: 5 } },
        { id: 'G1', type: 'ground', x: 100, y: 400 },
      ],
      wires: [],
      analysis: { type: 'dc' },
    }),
    selectedId,
    selectedWire: '',
    editable,
    wireStart: null,
  };
  const calls = { changed: 0, sweep: 0, schematic: 0, events: [], statuses: [] };
  let parameterHtml = '';
  let fields = [];
  const parameters = {
    valid: true,
    get innerHTML() {
      return parameterHtml;
    },
    set innerHTML(html) {
      parameterHtml = html;
      fields = [...html.matchAll(/<(input|select)\b([^>]*data-parameter="([^"]+)"[^>]*)>/g)].map(
        ([, tag, attributes, key]) => {
          const value =
            tag === 'input'
              ? attributes.match(/\bvalue="([^"]*)"/)?.[1] || ''
              : html
                  .slice(html.indexOf(`<select${attributes}>`))
                  .split('</select>')[0]
                  .match(/<option value="([^"]*)" selected>/)?.[1] || '';
          return input(key, value, focusState);
        },
      );
    },
    insertAdjacentHTML(_position, html) {
      parameterHtml += html;
    },
    querySelector(selector) {
      const key = selector.match(/data-parameter="([^"]+)"/)?.[1];
      return fields.find((field) => field.dataset.parameter === key) || null;
    },
    checkValidity() {
      calls.events.push('sidebar:check');
      return this.valid;
    },
    reportValidity() {
      calls.events.push('sidebar:report');
      return this.valid;
    },
  };
  const elements = { parameters };
  const popover = {
    valid: true,
    show(snapshot, options) {
      calls.events.push({ type: 'show', snapshot, options });
    },
    update(snapshot, options) {
      calls.events.push({ type: 'update', snapshot, options });
    },
    hide() {
      calls.events.push('hide');
    },
    reportValidity() {
      calls.events.push('popover:report');
      return this.valid;
    },
  };
  const context = {
    state,
    engine,
    listPage,
    window: {
      FreeBbsCircuitParameterPopover: popover,
      FreeBbsCircuitSidebar: { open: (tab) => calls.events.push(`sidebar:open:${tab}`) },
    },
    $: (id) => {
      if (!elements[id]) elements[id] = {};
      return elements[id];
    },
    escapeHtml: (value) =>
      String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    formatNumber: (value, unit) => `${value} ${unit}`,
    changed: () => {
      calls.changed += 1;
    },
    updateControls() {},
    renderSweepOptions: () => {
      calls.sweep += 1;
    },
    renderer: {
      renderSchematic() {
        calls.schematic += 1;
        return {};
      },
    },
    currentFrame: () => null,
    connectPin() {},
    addConnectionPoint() {},
    applySchematicHighlights() {},
    setStatus: (...args) => calls.statuses.push(args),
  };
  vm.createContext(context);
  vm.runInContext(parameterLabels + extracted, context);
  context.renderInspector();
  return { context, state, calls, elements, parameters, popover, focusState };
}

test('popover parameter edits update the sidebar and preserve the active popover input', () => {
  const h = harness();
  const target = input('resistance', '2200', h.focusState);
  h.focusState.activeElement = target;
  h.context.updateParameter({ target }, { componentId: 'R1', popover: true });

  assert.equal(h.state.document.components[0].params.resistance, 2200);
  assert.equal(h.parameters.querySelector('[data-parameter="resistance"]').value, '2200');
  assert.equal(h.focusState.activeElement, target);
  assert.equal(h.focusState.calls, 0);
  assert.equal(h.calls.changed, 1);
  assert.equal(h.calls.sweep, 1);
  assert.equal(h.calls.schematic, 1);
  const update = h.calls.events.find((event) => event.type === 'update');
  assert.deepEqual(clone(update.options), { preserveFocus: true });
  assert.match(update.snapshot.html, /value="2200"/);
});

test('sidebar waveform edits refresh both forms and focus the replacement sidebar select', () => {
  const h = harness({ selectedId: 'V1' });
  const original = h.parameters.querySelector('[data-parameter="waveform"]');
  h.focusState.activeElement = original;
  original.value = 'pulse';
  h.context.updateParameter({ target: original });

  const replacement = h.parameters.querySelector('[data-parameter="waveform"]');
  assert.notEqual(replacement, original);
  assert.equal(replacement.value, 'pulse');
  assert.equal(h.focusState.activeElement, replacement);
  assert.equal(h.focusState.calls, 1);
  assert.ok(h.parameters.querySelector('[data-parameter="duty"]'));
  assert.equal(h.calls.changed, 1);
  assert.equal(h.calls.events.at(-1).type, 'update');
  assert.match(h.calls.events.at(-1).snapshot.html, /data-parameter="duty"/);
});

test('sidebar number edits leave the current input in place while refreshing the popover', () => {
  const h = harness();
  const target = h.parameters.querySelector('[data-parameter="resistance"]');
  target.value = '4.7e3';
  h.focusState.activeElement = target;
  h.context.updateParameter({ target });

  assert.equal(h.state.document.components[0].params.resistance, 4700);
  assert.equal(h.parameters.querySelector('[data-parameter="resistance"]'), target);
  assert.equal(h.focusState.activeElement, target);
  assert.equal(h.focusState.calls, 0);
  assert.match(h.calls.events.at(-1).snapshot.html, /value="4700"/);
});

test('stale component events, read-only edits, missing components and unknown fields do not write', () => {
  const cases = [
    { options: { componentId: 'V1', popover: true } },
    { configuration: { editable: false } },
    { configuration: { selectedId: 'removed' } },
    { key: 'unknown' },
    { key: '' },
  ];
  cases.forEach(({ options, configuration, key = 'resistance' }) => {
    const h = harness(configuration);
    const before = clone(h.state.document);
    h.context.updateParameter({ target: input(key, '3000', h.focusState) }, options);
    assert.deepEqual(h.state.document, before);
    assert.equal(h.calls.changed, 0);
    assert.equal(h.calls.schematic, 0);
  });
});

test('empty or nonfinite numbers remain invalid without replacing the last valid value', () => {
  ['', '   ', 'NaN', 'Infinity', '-Infinity', '1e999'].forEach((value) => {
    const h = harness();
    const target = input('resistance', value, h.focusState);
    h.context.updateParameter({ target }, { componentId: 'R1', popover: true });
    assert.equal(h.state.document.components[0].params.resistance, 1000);
    assert.equal(target.validityMessage, '请填写有限数值。');
    assert.equal(h.calls.statuses.at(-1)[1], 'error');
    assert.equal(h.calls.changed, 0);
    assert.equal(h.calls.schematic, 0);
  });
});

test('the same numeric value clears validation without repeatedly marking the draft changed', () => {
  const h = harness();
  const target = input('resistance', '1e3', h.focusState);
  target.validityMessage = '请填写有限数值。';
  h.context.updateParameter({ target }, { componentId: 'R1', popover: true });
  assert.equal(target.validityMessage, '');
  assert.equal(h.calls.changed, 0);
  assert.equal(h.calls.schematic, 0);
  assert.deepEqual(h.calls.events, []);
});

test('DC, sine and pulse sources share exactly the same visible fields in both editing surfaces', () => {
  ['voltage', 'current'].forEach((type) => {
    ['dc', 'sine', 'pulse'].forEach((waveform) => {
      const h = harness({ selectedId: 'V1' });
      const component = h.state.document.components.find((item) => item.id === 'V1');
      component.type = type;
      component.params.waveform = waveform;
      h.context.renderInspector();
      h.context.syncParameterPopover({ show: true });
      const fields = h.context.parameterFieldsHtml(component);
      assert.ok(h.parameters.innerHTML.startsWith(fields));
      assert.ok(h.calls.events.at(-1).snapshot.html.startsWith(fields));
      const keys = [...fields.matchAll(/data-parameter="([^"]+)"/g)].map((match) => match[1]);
      assert.ok(keys.includes('dc'));
      assert.ok(keys.includes('acAmplitude'));
      assert.equal(keys.includes('duty'), waveform === 'pulse');
      ['amplitude', 'frequency', 'delay'].forEach((key) => {
        assert.equal(keys.includes(key), waveform !== 'dc');
      });
    });
  });
});

test('ordinary refreshes only update the popover and explicit selection is required to open it', () => {
  const h = harness();
  h.context.syncParameterPopover();
  h.context.syncParameterPopover({ focus: true });
  assert.deepEqual(
    h.calls.events.map((event) => event.type),
    ['update', 'update'],
  );
  h.context.syncParameterPopover({ show: true, focus: true });
  assert.equal(h.calls.events.at(-1).type, 'show');
  assert.deepEqual(clone(h.calls.events.at(-1).options), { focus: true });
  assert.equal(h.calls.events.at(-1).snapshot.componentId, 'R1');

  h.state.wireStart = { componentId: 'R1', pin: 0 };
  h.context.syncParameterPopover({ show: true });
  assert.equal(h.calls.events.at(-1), 'hide');
  h.state.wireStart = null;
  h.state.selectedId = '';
  h.context.syncParameterPopover();
  assert.equal(h.calls.events.at(-1), 'hide');
  const list = harness({ listPage: true });
  list.context.syncParameterPopover({ show: true });
  assert.deepEqual(list.calls.events, ['hide']);
});

test('invalid fields in the hidden sidebar are revealed before browser validation is reported', () => {
  const h = harness();
  h.parameters.valid = false;
  assert.equal(h.context.validateParameterInputs(), false);
  assert.deepEqual(h.calls.events, [
    'popover:report',
    'sidebar:check',
    'sidebar:open:parameters',
    'sidebar:report',
  ]);
});

test('invalid popover fields block submission first; fully valid forms leave the sidebar closed', () => {
  const invalid = harness();
  invalid.popover.valid = false;
  assert.equal(invalid.context.validateParameterInputs(), false);
  assert.deepEqual(invalid.calls.events, ['popover:report']);
  const valid = harness();
  assert.equal(valid.context.validateParameterInputs(), true);
  assert.deepEqual(valid.calls.events, ['popover:report', 'sidebar:check']);
});
