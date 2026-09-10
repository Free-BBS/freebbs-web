const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');
const plot = require('../public/circuit-plot');

const source = fs.readFileSync(path.join(__dirname, '../public/circuit-plot-controls.js'), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const decode = (value) =>
  String(value).replace(
    /&(amp|lt|gt|quot|#39);/g,
    (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity],
  );

// This small DOM executes the actual controls module, including its generated HTML,
// delegated events and synchronous parent re-render. Numerical validation is real.
function dom(document) {
  class Element {
    constructor(tag, attributes = {}) {
      this.tagName = tag.toLowerCase();
      this.attributes = attributes;
      this.dataset = Object.fromEntries(
        Object.entries(attributes)
          .filter(([key]) => key.startsWith('data-'))
          .map(([key, value]) => [
            key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
            value,
          ]),
      );
      this.children = [];
      this.listeners = {};
      this.open = Object.hasOwn(attributes, 'open');
      this.hidden = Object.hasOwn(attributes, 'hidden');
      this.disabled = Object.hasOwn(attributes, 'disabled');
      this.type = attributes.type || '';
      this.valid = true;
      this.selectionStart = 0;
      this.selectionEnd = 0;
    }

    matches(selector) {
      const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attribute)
        return (
          Object.hasOwn(this.attributes, attribute[1]) &&
          (attribute[2] === undefined || this.attributes[attribute[1]] === attribute[2])
        );
      return this.tagName === selector;
    }

    querySelectorAll(selector) {
      const parts = selector.split(' ');
      const matches = [];
      function visit(element) {
        element.children.forEach((child) => {
          if (child.matches(parts.at(-1))) {
            let parent = child.parentElement;
            let index = parts.length - 2;
            while (index >= 0 && parent) {
              if (parent.matches(parts[index])) index -= 1;
              parent = parent.parentElement;
            }
            if (index < 0) matches.push(child);
          }
          visit(child);
        });
      }
      visit(this);
      return matches;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    closest(selector) {
      for (let element = this; element; element = element.parentElement)
        if (element.matches(selector)) return element;
      return null;
    }

    contains(element) {
      return element === this || this.children.some((child) => child.contains(element));
    }

    remove() {
      this.parentElement.children = this.parentElement.children.filter(
        (element) => element !== this,
      );
      this.parentElement = null;
      if (this.contains(document.activeElement)) document.activeElement = null;
    }

    get value() {
      if (this.tagName !== 'select') return this.currentValue ?? this.attributes.value ?? '';
      if (this.currentValue !== undefined) return this.currentValue;
      const options = this.querySelectorAll('option');
      return (
        (options.find((option) => Object.hasOwn(option.attributes, 'selected')) || options[0])
          ?.attributes.value || ''
      );
    }

    set value(value) {
      this.currentValue = String(value);
    }

    focus() {
      document.activeElement = this;
    }

    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }

    checkValidity() {
      return this.valid;
    }

    reportValidity() {
      this.reported = true;
      return this.valid;
    }

    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }

    set innerHTML(html) {
      this.html = html;
      this.children = [];
      const stack = [this];
      const pattern = /<(\/?)([a-z][a-z0-9-]*)([^>]*)>/gi;
      for (const match of html.matchAll(pattern)) {
        const [, closing, tag, raw] = match;
        if (closing) {
          stack.pop();
          continue;
        }
        const attributes = {};
        for (const [, key, value] of raw.matchAll(/([^\s=/]+)(?:="([^"]*)")?/g))
          attributes[key] = decode(value || '');
        const element = new Element(tag, attributes);
        element.parentElement = stack.at(-1);
        element.parentElement.children.push(element);
        if (!['input', 'br', 'hr'].includes(tag.toLowerCase()) && !raw.endsWith('/'))
          stack.push(element);
      }
    }

    get innerHTML() {
      return this.html;
    }
  }
  return new Element('div');
}

function harness(settings = {}, { failChange = false, analysis = 'transient' } = {}) {
  const document = {
    activeElement: null,
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
  };
  const container = dom(document);
  const context = vm.createContext({
    document,
    FreeBbsCircuitEngine: engine,
    FreeBbsCircuitPlot: plot,
  });
  vm.runInContext(source, context);
  const result = {
    analysis: { type: analysis },
    x: [0, 1, 2],
    xLabel: '时间',
    xUnit: 's',
    warnings: [],
    traces: [
      { id: 'V:S1', label: 'CH1 电压', unit: 'V', values: [0, 1, 2] },
      { id: 'V:S1:CH2', label: 'CH2 电压', unit: 'V', values: [2, 1, 0] },
      { id: 'I:R1', label: 'R1 电流', unit: 'A', values: [0, 0.001, 0.002] },
    ],
  };
  let display = engine.normalizeDisplay({
    ch1: 'V:S1',
    ch2: 'V:S1:CH2',
    xyX: 'V:S1',
    xyY: 'V:S1:CH2',
    traceIds: ['V:S1', 'V:S1:CH2', 'M:M1'],
    math: [{ id: 'M1', label: '差值', expression: 'CH1-CH2', unit: '' }],
    ...settings,
  });
  const changes = [];
  const controls = context.FreeBbsCircuitPlotControls.create(container, (next) => {
    if (failChange) throw new Error('模拟父级拒绝本次更改');
    display = engine.normalizeDisplay(next);
    changes.push(clone(display));
    controls.update(plot.buildResult(result, display).result, display);
  });
  controls.update(plot.buildResult(result, display).result, display);
  const field = (key) => container.querySelector(`[data-plot-field="${key}"]`);
  const math = (id, key) =>
    container.querySelector(`[data-math-id="${id}"]`)?.querySelector(`[data-math-field="${key}"]`);
  return {
    controls,
    container,
    document,
    changes,
    field,
    math,
    get display() {
      return display;
    },
    change(target) {
      container.listeners.change({ target });
    },
    click(selector) {
      const target = container.querySelector(selector);
      assert.ok(target, selector);
      target.focus();
      container.listeners.click({ target });
    },
    get error() {
      return container.querySelector('[data-plot-error]');
    },
  };
}

test('valid edits preserve all entered fields, open sections, focus and selection across synchronous parent re-renders', () => {
  const h = harness();
  h.container.querySelector('[data-plot-ranges]').open = true;
  h.math('M1', 'label').value = '差值 "测试"';
  h.math('M1', 'unit').value = 'mV';
  h.field('xMin').value = '-2';
  const old = h.math('M1', 'expression');
  old.value = 'CH1 + CH2';
  old.focus();
  old.setSelectionRange(2, 5);
  h.change(old);
  assert.equal(h.changes.length, 1);
  assert.equal(h.display.math[0].expression, 'CH1 + CH2');
  assert.equal(h.display.math[0].label, '差值 "测试"');
  assert.equal(h.display.math[0].unit, 'mV');
  assert.equal(h.display.ranges.xMin, -2);
  assert.equal(h.math('M1', 'expression'), old);
  assert.equal(h.document.activeElement, h.math('M1', 'expression'));
  assert.equal(h.document.activeElement.selectionStart, 2);
  assert.equal(h.document.activeElement.selectionEnd, 5);
  assert.equal(h.container.querySelector('[data-plot-ranges]').open, true);
  assert.equal(h.container.querySelector('[data-plot-math]').open, true);
});

test('invalid drafts block addition without losing text, and a blank formula can be deleted immediately', () => {
  const h = harness();
  h.math('M1', 'expression').value = '';
  h.change(h.math('M1', 'expression'));
  assert.equal(h.changes.length, 0);
  assert.match(h.error.textContent, /表达式/);
  const input = h.math('M1', 'expression');
  h.field('yMax').value = '20';
  h.click('[data-add-math]');
  assert.equal(h.changes.length, 0);
  assert.equal(h.math('M1', 'expression'), input);
  assert.equal(input.value, '');
  h.click('[data-remove-math="M1"]');
  assert.equal(h.changes.length, 1);
  assert.equal(h.display.math.length, 0);
  assert.equal(h.display.ranges.yMax, 20);
  assert.equal(h.display.traceIds.includes('M:M1'), false);
  assert.equal(h.error.hidden, true);
  assert.equal(h.document.activeElement, h.container.querySelector('[data-add-math]'));
});

test('deleting a bad row preserves unrelated invalid drafts and commits the removal when those are corrected', () => {
  const h = harness({
    mode: 'xy',
    xyX: 'M:M1',
    math: [
      { id: 'M1', expression: 'CH1' },
      { id: 'M2', expression: 'CH2' },
    ],
  });
  h.math('M1', 'expression').value = 'CH1+';
  h.math('M2', 'expression').value = 'CH2/';
  h.math('M2', 'label').value = '仍在编辑的名称';
  h.field('xMin').value = '-5';
  const remaining = h.math('M2', 'expression');
  h.click('[data-remove-math="M1"]');
  assert.equal(h.math('M1', 'expression'), undefined);
  assert.equal(h.math('M2', 'expression'), remaining);
  assert.equal(remaining.value, 'CH2/');
  assert.equal(h.math('M2', 'label').value, '仍在编辑的名称');
  assert.equal(h.changes.length, 0);
  assert.equal(h.document.activeElement, remaining);
  assert.match(h.error.textContent, /表达式/);
  remaining.value = 'CH2/2';
  h.change(remaining);
  assert.equal(h.changes.length, 1);
  assert.deepEqual(clone(h.display.math.map((row) => row.id)), ['M2']);
  assert.equal(h.display.math[0].label, '仍在编辑的名称');
  assert.equal(h.display.ranges.xMin, -5);
  assert.equal(h.display.traceIds.includes('M:M1'), false);
  assert.equal(h.display.xyX, 'V:S1');
});

test('adding a curve preserves entered settings, selects its trace and focuses the new expression', () => {
  const h = harness();
  h.math('M1', 'expression').value = 'CH1*2';
  h.field('yMin').value = '-20';
  h.click('[data-add-math]');
  assert.equal(h.display.math[0].expression, 'CH1*2');
  assert.equal(h.display.math[1].id, 'M2');
  assert.equal(h.display.math[1].expression, 'CH1-CH2');
  assert.equal(h.display.ranges.yMin, -20);
  assert.equal(h.display.traceIds.includes('M:M2'), true);
  assert.equal(h.document.activeElement, h.math('M2', 'expression'));
});

test('missing selected IDs remain selected and visible; null channels do not silently choose physical traces', () => {
  const h = harness({ ch1: 'V:removed', ch2: null, mode: 'xy', xyX: 'M:M8', xyY: null });
  assert.equal(h.field('ch1').value, 'V:removed');
  assert.equal(h.field('xyX').value, 'M:M8');
  assert.equal(h.field('ch2').value, '');
  assert.equal(h.field('xyY').value, '');
  assert.match(h.container.innerHTML, /V:removed（通道不存在）/);
  h.field('xMin').value = '-1';
  h.change(h.field('xMin'));
  assert.equal(h.display.ch1, 'V:removed');
  assert.equal(h.display.ch2, null);
  assert.equal(h.display.xyX, 'M:M8');
  assert.equal(h.display.xyY, null);
});

test('ranges reject reversed, nonfinite and native-invalid values without losing other drafts', () => {
  const h = harness();
  h.field('xMin').value = '5';
  h.field('xMax').value = '2';
  h.math('M1', 'label').value = '保留名称';
  h.change(h.field('xMax'));
  assert.equal(h.changes.length, 0);
  assert.match(h.error.textContent, /下限必须小于上限/);
  assert.equal(h.math('M1', 'label').value, '保留名称');
  h.field('xMax').value = '1e309';
  assert.equal(h.controls.validate(), false);
  assert.match(h.error.textContent, /有限数值/);
  h.field('xMax').value = '';
  h.field('xMax').valid = false;
  assert.equal(h.controls.validate(), false);
  assert.equal(h.field('xMax').reported, true);
  h.field('xMax').valid = true;
  h.change(h.field('xMax'));
  assert.equal(h.display.ranges.xMax, null);
  assert.equal(h.display.math[0].label, '保留名称');
});

test('channel selection replaces its selected XT trace, follows default XY assignments and deduplicates choices', () => {
  const h = harness();
  h.field('ch1').value = 'V:S1:CH2';
  h.field('ch1').focus();
  h.change(h.field('ch1'));
  assert.equal(h.display.ch1, 'V:S1:CH2');
  assert.equal(h.display.xyX, 'V:S1:CH2');
  assert.deepEqual(h.display.traceIds, ['V:S1:CH2', 'M:M1']);
  assert.equal(h.document.activeElement, h.field('ch1'));
  const hidden = harness({ traceIds: [], xyX: 'M:M1' });
  hidden.field('ch1').value = 'I:R1';
  hidden.change(hidden.field('ch1'));
  assert.deepEqual(hidden.display.traceIds, [], 'explicitly hidden traces stay hidden');
  assert.equal(hidden.display.xyX, 'M:M1', 'custom XY assignment stays selected');
});

test('adding with a preselected missing math ID or 32 selected traces never creates invalid duplicate/overflow selections', () => {
  const missing = harness({ math: [], traceIds: ['M:M1'] });
  missing.click('[data-add-math]');
  assert.deepEqual(missing.display.traceIds, ['M:M1']);
  assert.equal(missing.display.math[0].id, 'M1');
  const full = harness({
    math: [],
    traceIds: Array.from({ length: 32 }, (_, index) => `V:R${index}`),
  });
  full.click('[data-add-math]');
  assert.equal(full.display.traceIds.length, 32);
  assert.equal(full.display.math.length, 1);
  assert.equal(full.display.traceIds.includes('M:M1'), false);
  assert.match(full.error.textContent, /已选 32 条曲线/);
});

test('parent rejection is shown as a recoverable inline error and read returns the current valid draft', () => {
  const h = harness({}, { failChange: true });
  const input = h.math('M1', 'expression');
  input.value = 'CH1*3';
  assert.doesNotThrow(() => h.change(input));
  assert.match(h.error.textContent, /父级拒绝/);
  assert.equal(h.math('M1', 'expression'), input);
  assert.equal(h.controls.read().math[0].expression, 'CH1*3');
  assert.equal(h.display.math[0].expression, 'CH1-CH2');
});

test('direct Add clicks retain the pressed button through native pointerdown/change/click ordering', () => {
  for (const eventType of ['pointerdown', 'mousedown']) {
    const h = harness();
    const expression = h.math('M1', 'expression');
    expression.value = 'CH1+CH2';
    expression.focus();
    const button = h.container.querySelector('[data-add-math]');
    h.container.listeners[eventType]({ target: button, button: 0 });
    h.change(expression);
    assert.equal(h.changes.length, 0, 'blur/change must wait for the pressed action');
    assert.equal(h.container.querySelector('[data-add-math]'), button);
    button.focus();
    h.document.listeners.pointerup({ target: button });
    h.document.listeners.mouseup({ target: button });
    assert.equal(h.changes.length, 0, 'release over the button must still wait for click');
    h.container.listeners.click({ target: button });
    assert.equal(h.changes.length, 1);
    assert.equal(h.display.math[0].expression, 'CH1+CH2');
    assert.equal(h.display.math[1].id, 'M2');
    assert.equal(h.document.activeElement, h.math('M2', 'expression'));
  }
});

test('direct Delete clicks remove the edited invalid formula without a blur validation stealing the action', () => {
  const h = harness();
  const expression = h.math('M1', 'expression');
  expression.value = '';
  const button = h.container.querySelector('[data-remove-math="M1"]');
  h.container.listeners.pointerdown({ target: button, button: 0 });
  h.container.listeners.mousedown({ target: button, button: 0 });
  h.change(expression);
  assert.equal(h.container.querySelector('[data-remove-math="M1"]'), button);
  assert.equal(h.error.hidden, true);
  h.container.listeners.click({ target: button });
  assert.equal(h.display.math.length, 0);
  assert.equal(h.changes.length, 1);
});

test('cancelled or released-outside gestures commit valid drafts without adding a curve or blocking later edits', () => {
  for (const cancellation of ['pointercancel', 'pointerup', 'mouseup', 'keydown']) {
    const h = harness();
    const expression = h.math('M1', 'expression');
    expression.value = 'CH1*2';
    const button = h.container.querySelector('[data-add-math]');
    h.container.listeners.pointerdown({ target: button, button: 0 });
    h.change(expression);
    h.document.listeners[cancellation]({ target: h.container, key: 'Escape' });
    assert.equal(h.changes.length, 1, cancellation);
    assert.equal(h.display.math.length, 1);
    assert.equal(h.display.math[0].expression, 'CH1*2');
    h.math('M1', 'expression').value = 'CH1*3';
    h.change(h.math('M1', 'expression'));
    assert.equal(h.display.math[0].expression, 'CH1*3');
    assert.equal(h.changes.length, 2);
  }
});

test('pointer cancellation preserves invalid drafts and keyboard button activation still works without pointerdown', () => {
  const h = harness();
  const expression = h.math('M1', 'expression');
  expression.value = 'CH1+';
  const button = h.container.querySelector('[data-add-math]');
  h.container.listeners.pointerdown({ target: button, button: 0 });
  h.change(expression);
  h.document.listeners.pointercancel({ target: button });
  assert.equal(h.changes.length, 0);
  assert.equal(h.math('M1', 'expression'), expression);
  assert.equal(expression.value, 'CH1+');
  assert.match(h.error.textContent, /表达式/);
  expression.value = 'CH1+CH2';
  h.change(expression);
  const add = h.container.querySelector('[data-add-math]');
  add.focus();
  h.document.listeners.keydown({ target: add, key: 'Enter' });
  h.container.listeners.click({ target: add, detail: 0 });
  assert.equal(h.display.math.length, 2);
  const remove = h.container.querySelector('[data-remove-math="M2"]');
  remove.focus();
  h.document.listeners.keydown({ target: remove, key: ' ' });
  h.container.listeners.click({ target: remove, detail: 0 });
  assert.equal(h.display.math.length, 1);
});

test('AC XY controls explain magnitude comparison while transient XY omits that AC-specific hint', () => {
  const ac = harness({ mode: 'xy' }, { analysis: 'ac' });
  assert.match(ac.container.innerHTML, /AC 的 X–Y 图比较各频点的幅值/);
  assert.match(ac.container.innerHTML, /李萨如图，请使用瞬态分析/);
  assert.doesNotMatch(harness({ mode: 'xy' }).container.innerHTML, /AC 的 X–Y 图/);
});

test('ordinary blur edits keep the next select/input and Tab target in place instead of swallowing navigation', () => {
  const h = harness();
  const expression = h.math('M1', 'expression');
  const mode = h.field('mode');
  const channel = h.field('ch1');
  const range = h.field('xMin');
  expression.value = 'CH1+CH2';
  h.container.listeners.pointerdown({ target: mode, button: 0 });
  h.change(expression);
  assert.equal(h.changes.length, 1);
  assert.equal(h.field('mode'), mode);
  assert.equal(h.field('ch1'), channel);
  assert.equal(h.field('xMin'), range);
  mode.focus();
  assert.equal(h.document.activeElement, mode);
  h.math('M1', 'label').value = '新名称';
  h.document.listeners.keydown({ target: h.math('M1', 'label'), key: 'Tab' });
  h.change(h.math('M1', 'label'));
  assert.equal(h.math('M1', 'expression'), expression);
  expression.focus();
  assert.equal(h.document.activeElement, expression);
  mode.value = 'xy';
  h.change(mode);
  assert.ok(h.field('xyX'), 'structural mode changes still create the required axis controls');
  assert.match(
    h.field('xyY').querySelectorAll('option').at(-1).textContent || h.container.innerHTML,
    /新名称/,
  );
});
