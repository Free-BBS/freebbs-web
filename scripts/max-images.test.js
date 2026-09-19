const assert = require('node:assert/strict');
const test = require('node:test');
const { validateFile, createController, bindImageInput } = require('../public/max-images');

function element() {
  return {
    disabled: false,
    children: [],
    addEventListener() {},
    setAttribute() {},
    replaceChildren() {
      this.children = [];
    },
    append(...items) {
      this.children.push(...items);
    },
  };
}
function harness(
  prepareImage = async (file) => ({ label: file.name, dataUrl: 'data:image/jpeg;base64,YQ==' }),
) {
  const nodes = new Map();
  global.document = { createElement: element };
  const controller = createController({
    root: {
      querySelector(selector) {
        if (!nodes.has(selector)) nodes.set(selector, element());
        return nodes.get(selector);
      },
    },
    prepareImage,
  });
  return { controller, nodes };
}
const file = { name: 'test.png', type: 'image/png', size: 100 };
test('accepts supported image files and rejects unsupported, empty and oversized files', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) validateFile({ ...file, type });
  for (const invalid of [{ type: 'image/svg+xml' }, { size: 0 }, { size: 10485761 }])
    assert.throws(() => validateFile({ ...file, ...invalid }));
});
test('adding images automatically enables vision; text-only sending remains blocked', async () => {
  const { controller: c, nodes } = harness();
  await c.select([file]);
  assert.equal(nodes.get('[data-image-add]').disabled, false);
  assert.equal(c.snapshot().length, 1);
  c.setVision(false);
  assert.throws(() => c.snapshot(), /视觉模型/);
  c.setVision(true);
  assert.equal(c.snapshot().length, 1);
  c.setBusy(true);
  await c.select([file]);
  assert.equal(c.snapshot().length, 1);
  c.clear();
  assert.deepEqual(c.snapshot(), []);
});
test('count limits and decode failures preserve the existing attachments', async () => {
  const { controller: c, nodes } = harness(async (item) => {
    if (item.bad) throw new Error('读取失败');
    return { label: item.name, dataUrl: 'preview' };
  });
  c.setVision(true);
  await c.select([file]);
  await c.select([file, file, file, file]);
  assert.equal(c.snapshot().length, 1);
  assert.match(nodes.get('[data-image-status]').textContent, /最多/);
  await c.select([file, { bad: true }]);
  assert.equal(c.snapshot().length, 1);
});
test('processing blocks sending and clearing prevents a late attachment from entering another dialog', async () => {
  let finish;
  const { controller: c } = harness(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  c.setVision(true);
  const pending = c.select([file]);
  assert.throws(() => c.snapshot(), /正在处理/);
  c.clear();
  await Promise.resolve();
  finish({ label: 'late', dataUrl: 'preview' });
  await pending;
  assert.deepEqual(c.snapshot(), []);
});

test('chat options forward uploaded images and reject them for text-only models', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../public/max-models'), 'utf8');
  for (const vision of [true, false]) {
    const window = {
      freeBbsApp: { userState: { token: 'test', uid: 'test' } },
      addEventListener() {},
      dispatchEvent() {},
    };
    vm.runInNewContext(source, {
      window,
      document: { readyState: 'loading', addEventListener() {}, querySelectorAll: () => [] },
      localStorage: { getItem: () => '{}' },
      API_BASE_URL: '/api',
      CustomEvent: class {},
      fetch: async () => ({
        ok: true,
        json: async () => ({
          defaultModel: 'test',
          models: [{ id: 'test', vision, efforts: ['auto'], defaultEffort: 'auto' }],
        }),
      }),
    });
    const images = [{ label: '题目', dataUrl: 'data:image/jpeg;base64,YQ==' }];
    const request = window.FreeBbsMaxModels.chatOptions({
      message: '解释图片',
      vision_images: images,
    });
    if (vision) {
      const options = await request;
      assert.equal(options.model, 'test');
      assert.equal(JSON.stringify(options.vision_images), JSON.stringify(images));
      assert.equal(options.vision, undefined);
    } else {
      await assert.rejects(request, /视觉模型/);
    }
  }
});

test('dropping files and pasting images share attachment handling without intercepting text', () => {
  const listeners = {};
  const added = [];
  const classes = new Set();
  const area = {
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
  };
  const input = {
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
    disabled: false,
    value: '',
    maxLength: 12000,
    selectionStart: 0,
    selectionEnd: 0,
    setRangeText(text) {
      this.value = text;
    },
    dispatchEvent() {},
  };
  bindImageInput({ area, input, controller: { select: (files) => added.push(files) } });
  let prevented = 0;
  const drag = {
    preventDefault: () => {
      prevented += 1;
    },
    dataTransfer: { types: ['Files'], files: [file] },
  };
  listeners.dragenter(drag);
  assert.ok(classes.has('is-image-dragging'));
  listeners.drop(drag);
  assert.deepEqual(added, [[file]]);
  assert.equal(classes.size, 0);
  const paste = {
    preventDefault: () => {
      prevented += 1;
    },
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      getData: () => '说明',
    },
  };
  listeners.paste(paste);
  assert.equal(input.value, '说明');
  assert.deepEqual(added, [[file], [file]]);
  const before = prevented;
  listeners.paste({ ...paste, clipboardData: { items: [{ kind: 'string', type: 'text/plain' }] } });
  assert.equal(prevented, before);
  listeners.drop({ ...drag, dataTransfer: { types: ['text/plain'] } });
  assert.equal(prevented, before);
});

test('already-selected visual models are locked for every new image batch', async () => {
  const calls = [];
  global.document = { createElement: element };
  const controller = createController({
    root: { querySelector: element },
    requireVision: async (value) => calls.push(value),
    prepareImage: async () => ({ label: 'image', dataUrl: 'preview' }),
  });
  controller.setVision(true);
  await controller.select([file]);
  assert.deepEqual(calls, [true]);
  controller.clear();
  await controller.select([file]);
  assert.deepEqual(calls, [true, false, true]);
  assert.equal(controller.snapshot().length, 1);
});
