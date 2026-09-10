const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');
const annotations = require('../public/circuit-annotations');

const source = fs.readFileSync(
  path.join(__dirname, '../public/circuit-annotation-controls.js'),
  'utf8',
);
const clone = (value) => JSON.parse(JSON.stringify(value));
const decode = (value) =>
  String(value).replace(
    /&(amp|lt|gt|quot|#39);/g,
    (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity],
  );

// Run the real controls against a minimal DOM, with synchronous parent validation
// and rendering. Setting a textarea value moves its caret as it does in browsers.
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
      if (selector.includes(','))
        return selector.split(',').some((part) => this.matches(part.trim()));
      const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attribute)
        return (
          Object.hasOwn(this.attributes, attribute[1]) &&
          (attribute[2] === undefined || this.attributes[attribute[1]] === attribute[2])
        );
      return this.tagName === selector;
    }

    querySelectorAll(selector) {
      if (selector.includes(','))
        return [
          ...new Set(selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()))),
        ];
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

    hasAttribute(key) {
      return Object.hasOwn(this.attributes, key);
    }

    getAttribute(key) {
      return this.attributes[key] ?? null;
    }

    setAttribute(key, value) {
      this.attributes[key] = String(value);
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
      this.selectionStart = this.currentValue.length;
      this.selectionEnd = this.currentValue.length;
    }

    focus() {
      document.activeElement = this;
    }

    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }

    checkValidity() {
      if (this.disabled) return true;
      if (!this.valid) return false;
      if (this.tagName === 'form')
        return this.querySelectorAll('input,select,textarea').every((field) =>
          field.checkValidity(),
        );
      if (this.hasAttribute('required') && this.value === '') return false;
      if (this.type === 'number' && this.value !== '' && !Number.isFinite(Number(this.value)))
        return false;
      return true;
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

function marker(extra = {}) {
  return {
    id: 'A1',
    traceId: 'V:S1',
    at: 0.5,
    text: '原注释',
    mode: 'xt',
    axis: 'value',
    xTraceId: null,
    analysisKey: 'transient',
    ...extra,
  };
}

function harness(settings = {}, options = {}) {
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
    FreeBbsCircuitAnnotations: annotations,
    FreeBbsCircuitRenderer: { formatValue: (value, unit = '') => `${value} ${unit}`.trim() },
  });
  vm.runInContext(source, context);
  let result = {
    analysis: { type: 'transient' },
    x: [0, 0.25, 0.5, 0.75, 1],
    xUnit: 's',
    xLabel: '时间',
    traces: [
      { id: 'V:S1', label: 'CH1 电压', unit: 'V', values: [0, 1, 2, 1, 0] },
      { id: 'V:S1:CH2', label: 'CH2 电压', unit: 'V', values: [2, 1, 0, 1, 2] },
    ],
  };
  let display = engine.normalizeDisplay({
    ch1: 'V:S1',
    ch2: 'V:S1:CH2',
    xyX: 'V:S1',
    xyY: 'V:S1:CH2',
    traceIds: ['V:S1', 'V:S1:CH2'],
    ...settings,
  });
  let editable = options.editable !== false;
  let failChange = Boolean(options.failChange);
  const changes = [];
  const attempts = [];
  const pickingChanges = [];
  const controls = context.FreeBbsCircuitAnnotationControls.create(container, {
    onChange(next) {
      attempts.push(clone(next));
      if (failChange) throw new Error('父级拒绝本次更改');
      display = engine.normalizeDisplay(next);
      changes.push(clone(display));
      controls.update(result, display, { editable });
    },
    onPickingChange(value) {
      pickingChanges.push(value);
    },
  });
  controls.update(result, display, { editable });
  function dispatch(type, target, extra = {}) {
    const event = {
      target,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...extra,
    };
    for (let current = target; current; current = current.parentElement)
      current.listeners[type]?.(event);
    return event;
  }
  return {
    controls,
    container,
    document,
    changes,
    attempts,
    pickingChanges,
    dispatch,
    field: (key) => container.querySelector(`[data-annotation-field="${key}"]`),
    get display() {
      return display;
    },
    get result() {
      return result;
    },
    get form() {
      return container.querySelector('[data-annotation-form]');
    },
    get error() {
      return container.querySelector('[data-annotation-error]');
    },
    get picking() {
      return (
        container.querySelector('[data-annotation-pick]').getAttribute('aria-pressed') === 'true'
      );
    },
    click(selector) {
      const target = container.querySelector(selector);
      assert.ok(target, selector);
      if (target.disabled) return;
      target.focus();
      dispatch('click', target);
    },
    input(key, value, type = 'input') {
      const target = container.querySelector(`[data-annotation-field="${key}"]`);
      target.value = value;
      target.focus();
      dispatch(type, target);
    },
    update(next, nextResult = result) {
      display = engine.normalizeDisplay(next);
      result = nextResult;
      controls.update(result, display, { editable });
    },
    reject(value) {
      failChange = value;
    },
    setEditable(value) {
      editable = value;
      controls.setEditable(value);
    },
  };
}

test('point picks add a sampled marker immediately and text input persists without moving the caret', () => {
  const h = harness();
  h.controls.togglePicking();
  assert.equal(h.picking, true);
  h.controls.pick({ traceId: 'V:S1', at: 0.49, axis: 'value' });
  assert.equal(h.changes.length, 1);
  assert.equal(h.display.annotations[0].at, 0.5);
  assert.equal(h.display.annotations[0].text, '');
  assert.equal(h.picking, false);
  assert.equal(h.form.hidden, false);
  const textarea = h.field('text');
  textarea.value = '输出 <峰值> 与 "输入"';
  textarea.focus();
  textarea.setSelectionRange(3, 6);
  h.dispatch('input', textarea);
  assert.equal(h.changes.length, 2);
  assert.equal(h.display.annotations[0].text, textarea.value);
  assert.equal(h.field('text'), textarea);
  assert.equal(h.document.activeElement, textarea);
  assert.deepEqual([textarea.selectionStart, textarea.selectionEnd], [3, 6]);
  assert.match(
    h.container.querySelector('[data-annotation-list]').innerHTML,
    /&lt;峰值&gt;.*&quot;输入&quot;/,
  );
  h.controls.commitPending();
  assert.equal(h.changes.length, 2, 'unchanged blur/save does not create another edit');
});

test('coordinate addition keeps a draft until commit, supports cancellation and snaps only on commit', () => {
  const h = harness();
  h.click('[data-annotation-new]');
  assert.equal(h.form.hidden, false);
  assert.equal(h.document.activeElement, h.field('at'));
  h.input('at', '0.49');
  h.input('text', '坐标草稿');
  assert.equal(h.changes.length, 0);
  h.controls.update(h.result, h.display, { editable: true });
  assert.equal(h.field('at').value, '0.49');
  assert.equal(h.field('text').value, '坐标草稿');
  h.click('[data-annotation-cancel]');
  assert.equal(h.form.hidden, true);
  assert.equal(h.changes.length, 0);
  h.click('[data-annotation-new]');
  h.input('at', '0.49');
  h.input('text', '峰值');
  assert.equal(h.controls.commitPending(), true);
  assert.equal(h.changes.length, 1);
  assert.equal(h.display.annotations[0].at, 0.5);
  assert.equal(h.field('at').value, '0.5');
  assert.equal(h.field('text').value, '峰值');
  assert.equal(h.container.querySelector('[data-annotation-cancel]').textContent, '完成');
});

test('selected marker coordinate drafts validate on change and invalid markers can still be deleted', () => {
  const h = harness({ annotations: [marker(), marker({ id: 'A2', at: 0.75 })] });
  h.controls.select('A1');
  h.input('at', '0.');
  assert.equal(h.changes.length, 0, 'typing a decimal prefix cannot relocate the marker');
  h.input('at', '0.25', 'change');
  assert.equal(h.display.annotations[0].at, 0.25);
  h.input('at', '', 'change');
  assert.equal(h.controls.commitPending(), false);
  assert.match(h.error.textContent, /有效的采样坐标/);
  h.click('[data-annotation-delete="A1"]');
  assert.deepEqual(clone(h.display.annotations.map((item) => item.id)), ['A2']);
  assert.equal(h.form.hidden, true);
  assert.equal(h.error.hidden, true);
});

test('annotation count bounds block manual and picked additions but allow edits of an existing marker', () => {
  const h = harness({
    annotations: Array.from({ length: 32 }, (_, index) => marker({ id: `A${index + 1}` })),
  });
  h.click('[data-annotation-new]');
  assert.equal(h.form.hidden, true);
  assert.match(h.error.textContent, /32/);
  h.controls.togglePicking();
  h.controls.pick({ traceId: 'V:S1', at: 0.5 });
  assert.equal(h.changes.length, 0);
  assert.match(h.error.textContent, /32/);
  assert.equal(h.picking, true, 'a failed pick does not claim success or cancel selection');
  h.controls.cancelPicking();
  h.controls.select('A2');
  h.input('text', '更新已有标记');
  assert.equal(h.changes.length, 1);
  assert.equal(h.display.annotations.length, 32);
  assert.equal(h.display.annotations[1].text, '更新已有标记');
});

test('read-only controls allow inspection while every editing entry point is guarded', () => {
  const h = harness({ annotations: [marker()] }, { editable: false });
  h.click('[data-annotation-select="A1"]');
  assert.equal(h.form.hidden, false);
  assert.equal(h.field('text').value, '原注释');
  assert.equal(h.field('text').disabled, true);
  assert.equal(h.container.querySelector('[data-annotation-delete="A1"]').disabled, true);
  h.controls.pick({ traceId: 'V:S1', at: 0.25 });
  h.controls.togglePicking();
  h.input('text', '不得保存');
  h.dispatch('click', h.container.querySelector('[data-annotation-delete="A1"]'));
  h.dispatch('click', h.container.querySelector('[data-annotation-new]'));
  assert.equal(h.controls.commitPending(), true);
  assert.equal(h.picking, false);
  assert.equal(h.changes.length, 0);
  assert.equal(h.display.annotations[0].text, '原注释');
  h.click('[data-annotation-cancel]');
  assert.equal(h.form.hidden, true);
  h.setEditable(true);
  h.controls.togglePicking();
  assert.equal(h.picking, true);
  h.setEditable(false);
  assert.equal(h.picking, false);
});

test('hidden marker notes can change without rebinding their original analysis, mode or sample anchor', () => {
  const hidden = marker({
    mode: 'xy',
    xTraceId: 'V:S1:CH2',
    traceId: 'M:M1',
    at: 123,
    analysisKey: 'ac',
  });
  const h = harness({ annotations: [hidden] });
  h.controls.select('A1');
  assert.equal(h.field('traceId').value, 'M:M1');
  assert.match(h.field('traceId').innerHTML, /当前未显示/);
  h.input('text', '保留原先的交流标记位置');
  assert.equal(h.changes.length, 1);
  assert.deepEqual({ ...h.display.annotations[0], text: hidden.text }, hidden);
  assert.match(h.container.querySelector('[data-annotation-list]').innerHTML, /分析类型/);
});

test('external Max changes refresh the selected annotation while same-context drafts remain untouched', () => {
  const h = harness({ annotations: [marker()] });
  h.controls.select('A1');
  const textarea = h.field('text');
  textarea.focus();
  h.update({ ...h.display, annotations: [marker({ text: 'Max 新注释', at: 0.75 })] });
  assert.equal(h.field('text'), textarea);
  assert.equal(h.document.activeElement, textarea);
  assert.equal(h.field('text').value, 'Max 新注释');
  assert.equal(h.field('at').value, '0.75');
  assert.equal(h.controls.commitPending(), true);
  assert.equal(
    h.changes.length,
    0,
    're-rendered external values are not written back as stale edits',
  );
  h.input('at', '');
  h.update(h.display);
  assert.equal(
    h.field('at').value,
    '',
    'unchanged parent redraw leaves an invalid coordinate draft intact',
  );
  h.input('at', '0.75');
  h.click('[data-annotation-cancel]');
  h.click('[data-annotation-new]');
  h.input('text', '未提交的坐标草稿');
  h.update({ ...h.display, mode: 'xy' });
  assert.equal(h.form.hidden, true);
  assert.match(h.error.textContent, /草稿.*未保存/);
  assert.equal(h.changes.length, 0);
});

test('a rejected coordinate add stays a cancellable draft and a rejected pick stays in picking mode', () => {
  const h = harness({}, { failChange: true });
  h.click('[data-annotation-new]');
  h.input('at', '0.5');
  h.input('text', '保留待保存内容');
  assert.equal(h.controls.commitPending(), false);
  assert.equal(h.changes.length, 0);
  assert.match(h.error.textContent, /父级拒绝/);
  assert.equal(h.form.hidden, false);
  assert.equal(h.field('text').value, '保留待保存内容');
  assert.equal(h.container.querySelector('[data-annotation-cancel]').textContent, '取消');
  h.click('[data-annotation-cancel]');
  assert.equal(h.form.hidden, true);
  assert.equal(h.attempts.length, 1, 'cancel does not retry a rejected addition');
  h.controls.togglePicking();
  h.controls.pick({ traceId: 'V:S1', at: 0.5 });
  assert.equal(h.picking, true);
  assert.equal(h.form.hidden, true);
  assert.equal(h.changes.length, 0);
  h.reject(false);
  h.controls.pick({ traceId: 'V:S1', at: 0.5 });
  assert.equal(h.picking, false);
  assert.equal(h.display.annotations[0].id, 'A1');
});

test('rejected edits and deletes retain the selected form and show the parent error until a successful retry', () => {
  const h = harness({ annotations: [marker()] }, { failChange: true });
  h.controls.select('A1');
  const textarea = h.field('text');
  h.input('text', '未保存的更新');
  assert.equal(h.changes.length, 0);
  assert.equal(h.display.annotations[0].text, '原注释');
  assert.equal(h.form.hidden, false);
  assert.match(h.error.textContent, /父级拒绝/);
  h.click('[data-annotation-delete="A1"]');
  assert.equal(h.changes.length, 0);
  assert.equal(h.form.hidden, false);
  assert.equal(h.field('text'), textarea);
  assert.equal(h.field('text').value, '未保存的更新');
  assert.match(h.error.textContent, /父级拒绝/);
  h.reject(false);
  assert.equal(h.controls.commitPending(), true);
  assert.equal(h.display.annotations[0].text, '未保存的更新');
  assert.equal(h.error.hidden, true);
  h.click('[data-annotation-delete="A1"]');
  assert.equal(h.form.hidden, true);
  assert.deepEqual(clone(h.display.annotations), []);
});

test('reset clears old markers and Esc cancels picking without changing the document', () => {
  const h = harness({ annotations: [marker()] });
  h.controls.togglePicking();
  assert.equal(h.picking, true);
  const event = h.dispatch('keydown', h.container, { key: 'Escape' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.picking, false);
  h.controls.select('A1');
  h.controls.reset();
  assert.equal(h.form.hidden, true);
  assert.equal(h.container.querySelectorAll('[data-annotation-row]').length, 0);
  h.controls.togglePicking();
  h.controls.select('A1');
  h.controls.pick({ traceId: 'V:S1', at: 0.5 });
  h.click('[data-annotation-new]');
  assert.equal(h.picking, false);
  assert.equal(h.changes.length, 0);
});

test('list action presses survive coordinate blur without losing the click target', () => {
  const h = harness({ annotations: [marker(), marker({ id: 'A2', at: 0.75, text: '第二个' })] });
  h.controls.select('A1');
  h.field('at').value = '0.25';
  const selectButton = h.container.querySelector('[data-annotation-select="A2"]');
  h.dispatch('pointerdown', selectButton, { button: 0 });
  h.dispatch('change', h.field('at'));
  assert.equal(h.changes.length, 0);
  assert.equal(h.container.querySelector('[data-annotation-select="A2"]'), selectButton);
  h.dispatch('click', selectButton);
  assert.equal(h.display.annotations[0].at, 0.25);
  assert.equal(h.field('text').value, '第二个');
  h.field('at').value = '';
  const deleteButton = h.container.querySelector('[data-annotation-delete="A2"]');
  h.dispatch('mousedown', deleteButton, { button: 0 });
  h.dispatch('change', h.field('at'));
  assert.equal(h.container.querySelector('[data-annotation-delete="A2"]'), deleteButton);
  h.dispatch('click', deleteButton);
  assert.deepEqual(clone(h.display.annotations.map((item) => item.id)), ['A1']);
  assert.equal(h.error.hidden, true);
});

test('cancelled or released-outside list gestures flush coordinate changes without executing the action', () => {
  const h = harness({ annotations: [marker()] });
  h.controls.select('A1');
  h.field('at').value = '0.75';
  const deleteButton = h.container.querySelector('[data-annotation-delete="A1"]');
  h.dispatch('pointerdown', deleteButton, { button: 0 });
  h.dispatch('change', h.field('at'));
  h.document.listeners.pointerup({ target: h.container });
  assert.equal(h.display.annotations[0].at, 0.75);
  assert.equal(h.display.annotations.length, 1);
  h.field('at').value = '';
  h.dispatch('pointerdown', h.container.querySelector('[data-annotation-delete="A1"]'), {
    button: 0,
  });
  h.dispatch('change', h.field('at'));
  h.document.listeners.pointercancel({});
  assert.match(h.error.textContent, /有效的采样坐标/);
  h.input('at', '0.25', 'change');
  assert.equal(h.display.annotations[0].at, 0.25);
});
