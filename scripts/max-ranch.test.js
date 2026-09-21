const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const {
  walkPose,
  standPose,
  greetPose,
  GROUND,
  SPEED,
  legPath,
  mount,
} = require('../public/max-ranch');

function ranchHarness(t, options = {}, reduced = false) {
  const oldWindow = global.window;
  const oldDocument = global.document;
  const frames = new Map();
  const timers = new Map();
  let sequence = 0;
  let now = 1000;
  const eventTarget = (extra = {}) => ({
    ...extra,
    listeners: new Map(),
    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    },
    removeEventListener(type, callback) {
      if (this.listeners.get(type) === callback) this.listeners.delete(type);
    },
    emit(type) {
      this.listeners.get(type)?.();
    },
  });
  const media = eventTarget({ matches: reduced });
  const document = eventTarget({ hidden: false });
  const window = eventTarget({
    matchMedia: () => media,
    requestAnimationFrame(callback) {
      sequence += 1;
      frames.set(sequence, callback);
      return sequence;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setTimeout(callback, delay) {
      sequence += 1;
      timers.set(sequence, { callback, due: now + delay });
      return sequence;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  const makeNode = () => ({
    attributes: {},
    dataset: {},
    children: new Map(),
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    querySelector(selector) {
      if (!this.children.has(selector)) this.children.set(selector, makeNode());
      return this.children.get(selector);
    },
  });
  const element = Object.assign(makeNode(), {
    innerHTML: '',
    style: {},
    clientWidth: 216,
    parentElement: { clientWidth: 700 },
  });
  global.window = window;
  global.document = document;
  const controller = mount(element, options);
  t.after(() => {
    controller.destroy();
    if (oldWindow === undefined) delete global.window;
    else global.window = oldWindow;
    if (oldDocument === undefined) delete global.document;
    else global.document = oldDocument;
  });
  const advance = (milliseconds) => {
    const end = now + milliseconds;
    while (now < end) {
      now = Math.min(end, now + 16);
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(now);
      }
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    }
  };
  const node = (selector) => element.querySelector(selector);
  return { element, controller, frames, timers, window, document, media, node, advance };
}

test('Max has four articulated legs; stance hooves stay on the ground throughout the gait', () => {
  const heights = [new Set(), new Set(), new Set(), new Set()];
  for (let n = 0; n < 240; n += 1) {
    const pose = walkPose(n / 100);
    assert.equal(pose.legs.length, 4);
    pose.legs.forEach((leg, i) => {
      assert.ok(leg.foot.y <= GROUND && leg.foot.y >= GROUND - 13);
      if (leg.planted) assert.equal(leg.foot.y, GROUND);
      heights[i].add(leg.foot.y.toFixed(1));
      assert.doesNotMatch(legPath(leg, i), /NaN|Infinity/);
    });
  }
  heights.forEach((samples) => assert.ok(samples.size > 10, 'each leg swings independently'));
});
test('planted hooves do not slide while the body advances', () => {
  for (let t = 0; t < 1.1; t += 0.01) {
    const a = walkPose(t);
    const b = walkPose(t + 0.005);
    a.legs.forEach((leg, i) => {
      if (leg.planted && b.legs[i].planted) {
        const worldA = SPEED * t + leg.foot.x;
        const worldB = SPEED * (t + 0.005) + b.legs[i].foot.x;
        assert.ok(Math.abs(worldA - worldB) < 0.00001);
      }
    });
  }
});
test('legacy standPose geometry remains compatible without being used by the live sheep', () => {
  for (let n = 0; n <= 100; n += 1) {
    const pose = standPose(n / 100, n / 30);
    for (const i of [0, 2]) {
      assert.equal(pose.legs[i].foot.y, GROUND);
      assert.equal(pose.legs[i].planted, true);
    }
    pose.legs.forEach((leg, i) => assert.doesNotMatch(legPath(leg, i), /NaN|Infinity/));
  }
  const standing = standPose();
  assert.ok(standing.angle < -60);
  assert.ok(standing.legs[3].foot.y < 70);
  assert.notEqual(standPose(1, 0).legs[3].foot.x, standPose(1, 0.2).legs[3].foot.x);
});

test('the warm SVG has curls, glasses, rounded split hooves, and a separate shearable fleece', (t) => {
  const { element, node } = ranchHarness(t, { woolReady: 2, woolStored: 5 });
  assert.match(element.innerHTML, /data-max-glasses/);
  assert.match(element.innerHTML, /data-wool-base/);
  assert.match(element.innerHTML, /fill="#fff5df"/);
  assert.match(element.innerHTML, /data-hoof-split/);
  assert.equal(element.dataset.woolReady, 'true');
  assert.equal(node('[data-wool-ready]').attributes.visibility, 'visible');
  assert.match(node('[data-leg="2"]').querySelector('[data-hoof]').attributes.d, /q/);
  assert.equal(node('[data-max-tears]').attributes.visibility, 'hidden');
});

test('Max has a short rounded face, compact muzzle and nose, and brighter gentle eyes', (t) => {
  const { element } = ranchHarness(t);
  const coordinates = (marker) => {
    const d = element.innerHTML.match(new RegExp(`${marker} d="([^"]+)"`))[1];
    // These face outlines deliberately use absolute coordinates for proportion checks.
    const numbers = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    return {
      x: numbers.filter((_, i) => i % 2 === 0),
      y: numbers.filter((_, i) => i % 2 === 1),
    };
  };
  const face = coordinates('data-max-face');
  const muzzle = coordinates('data-max-muzzle');
  const nose = coordinates('data-max-nose');
  assert.ok(Math.max(...face.y) <= 125, 'no elongated chin below the cheeks');
  assert.ok(Math.max(...muzzle.y) - Math.min(...muzzle.y) <= 16, 'short soft sheep muzzle');
  assert.ok(Math.max(...nose.x) - Math.min(...nose.x) <= 6, 'small nose');
  assert.ok(Math.max(...nose.y) - Math.min(...nose.y) <= 5);
  assert.match(element.innerHTML, /cx="132" cy="103.5" rx="4.4" ry="5.1"/);
  assert.match(element.innerHTML, /data-max-glasses/);
  assert.match(element.innerHTML, /data-max-eyelids/);
});

test('stored wool does not imply a mature fleece on Max', (t) => {
  const { element, node } = ranchHarness(t, { woolReady: 0, woolStored: 100 });
  assert.equal(element.dataset.woolReady, 'false');
  assert.equal(node('[data-wool-ready]').attributes.visibility, 'hidden');
});

test('breathing, tail sway, and a gentle head nod animate without changing the ground contract', (t) => {
  const { node, advance, frames } = ranchHarness(t);
  const initial = ['fleece', 'tail', 'head'].map(
    (name) => node(`[data-${name}]`).attributes.transform,
  );
  advance(400);
  ['fleece', 'tail', 'head'].forEach((name, i) => {
    assert.notEqual(node(`[data-${name}]`).attributes.transform, initial[i]);
  });
  for (let i = 0; i < 4; i += 1) {
    const leg = node(`[data-leg="${i}"]`);
    if (leg.dataset.planted === 'true') assert.equal(Number(leg.dataset.footY), GROUND);
  }
  assert.equal(frames.size, 1);
});

test('pause cancels RAF instead of spinning, and resuming never starts duplicate loops', (t) => {
  const { controller, frames, node, advance } = ranchHarness(t);
  advance(160);
  controller.pause(true);
  const frozen = node('[data-fleece]').attributes.transform;
  assert.equal(frames.size, 0);
  advance(500);
  assert.equal(node('[data-fleece]').attributes.transform, frozen);
  controller.pause(false);
  controller.pause(false);
  assert.equal(frames.size, 1);
  advance(100);
  assert.notEqual(node('[data-fleece]').attributes.transform, frozen);
});

test('reduced motion uses a static greeting and bounded feedback without creating RAF', (t) => {
  const { controller, frames, timers, node, media, advance } = ranchHarness(t, {}, true);
  assert.equal(frames.size, 0);
  assert.equal(controller.greet(), true);
  assert.equal(controller.celebrate('feed'), true);
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 1);
  const frozen = node('[data-head]').attributes.transform;
  advance(400);
  assert.equal(node('[data-head]').attributes.transform, frozen);
  advance(1500);
  assert.equal(node('[data-max-celebration]').attributes.visibility, 'hidden');
  assert.equal(timers.size, 0);
  media.matches = false;
  media.emit('change');
  assert.equal(frames.size, 1);
  media.matches = true;
  media.emit('change');
  assert.equal(frames.size, 0);
});

test('hidden pages stop all frames and clear feedback, then resume without a position jump', (t) => {
  const { controller, document, frames, timers, advance } = ranchHarness(t);
  advance(200);
  controller.celebrate('rub');
  document.hidden = true;
  document.emit('visibilitychange');
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(controller.greet(), false);
  assert.equal(controller.celebrate('shear'), false);
  const { x } = controller.snapshot();
  advance(60000);
  document.hidden = false;
  document.emit('visibilitychange');
  assert.equal(frames.size, 1);
  advance(16);
  assert.equal(controller.snapshot().x, x);
});

test('each celebration is brief, replaces prior feedback, and coexists with a greeting', (t) => {
  const { controller, node, element, frames, timers, advance } = ranchHarness(t);
  controller.greet();
  for (const kind of ['feed', 'shear', 'rub']) {
    assert.equal(controller.celebrate(kind), true);
    assert.equal(element.dataset.celebration, kind);
    assert.equal(element.dataset.pose, 'greet');
    assert.equal(node(`[data-effect-${kind}]`).attributes.visibility, 'visible');
    assert.equal(timers.size, 1);
    assert.equal(frames.size, 1);
  }
  assert.equal(controller.celebrate('unknown'), false);
  advance(1850);
  assert.equal(node('[data-max-celebration]').attributes.visibility, 'hidden');
  assert.equal(element.dataset.celebration, '');
  assert.equal(timers.size, 0);
  assert.equal(frames.size, 1);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(Number(node(`[data-leg="${i}"]`).dataset.footY), GROUND);
  }
  assert.match(node('[data-body]').attributes.transform, /rotate\(0 /);
});

test('hungry Max keeps the crying, lowered resting pose and grounded hooves without RAF', (t) => {
  const { controller, element, node, frames, advance } = ranchHarness(t, {
    hungry: true,
    woolReady: 1,
  });
  assert.equal(element.dataset.pose, 'hungry');
  assert.equal(node('[data-max-tears]').attributes.visibility, 'visible');
  assert.match(node('[data-body]').attributes.transform, /translate\(0 17\)/);
  assert.equal(node('[data-wool-ready]').attributes.visibility, 'visible');
  assert.equal(controller.greet(), false);
  controller.pause(false);
  advance(1000);
  assert.equal(frames.size, 0);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(Number(node(`[data-leg="${i}"]`).dataset.footY), GROUND);
  }
});

test('destroy cancels both frame and feedback timer and removes every lifecycle listener', (t) => {
  const { controller, frames, timers, window, document, media } = ranchHarness(t);
  const staleFrame = [...frames.values()][0];
  controller.celebrate('feed');
  controller.destroy();
  controller.destroy();
  staleFrame(99999);
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(window.listeners.size, 0);
  assert.equal(document.listeners.size, 0);
  assert.equal(media.listeners.size, 0);
  assert.equal(controller.greet(), false);
  assert.equal(controller.celebrate('rub'), false);
});

test('mount preserves a zero position and facing, and resize clamps safely on narrow ranches', (t) => {
  assert.equal(mount(null), null);
  const { controller, element, window, node, frames } = ranchHarness(t, {
    x: 0,
    direction: -1,
    paused: true,
  });
  assert.deepEqual(controller.snapshot(), { x: 0, direction: -1, paused: true });
  assert.equal(node('[data-facing]').attributes.transform, 'translate(180 0) scale(-1 1)');
  element.parentElement.clientWidth = 130;
  window.emit('resize');
  assert.equal(element.style.transform, 'translateX(0px)');
  assert.equal(frames.size, 0);
});

test('greetings settle four hooves without rearing or moving a planted hoof sideways', () => {
  const base = walkPose(0.42);
  for (let time = 0.3; time <= 2.8; time += 0.05) {
    const pose = greetPose(base, time);
    assert.equal(pose.angle, 0);
    assert.equal(pose.standing, 0);
    pose.legs.forEach((leg, i) => {
      assert.equal(leg.planted, true);
      assert.equal(leg.foot.y, GROUND);
      assert.equal(leg.foot.x, base.legs[i].foot.x);
      assert.ok(GROUND - leg.hip.y < 35, 'short natural sheep legs, not upright arms');
    });
  }
  assert.deepEqual(
    greetPose(base, 0).legs.map((leg) => leg.foot),
    base.legs.map((leg) => leg.foot),
  );
  assert.deepEqual(
    greetPose(base, 3.2).legs.map((leg) => leg.foot),
    base.legs.map((leg) => leg.foot),
  );
});

test('today’s shear displays short soft fleece while preserving real ready-wool availability', (t) => {
  const { element, node } = ranchHarness(t, { woolReady: 4, shearedToday: true });
  assert.equal(element.dataset.woolReady, 'true');
  assert.equal(element.dataset.fleece, 'short');
  assert.equal(node('[data-wool-ready]').attributes.visibility, 'hidden');
  assert.match(element.innerHTML, /data-wool-base[^>]+fill="#fff1d5"/);
});

test('unshorn mature wool uses the long fleece and the actual greeting stays on all fours', (t) => {
  const { controller, element, node, advance } = ranchHarness(t, {
    woolReady: 2,
    shearedToday: false,
  });
  assert.equal(element.dataset.fleece, 'long');
  advance(140);
  const previousHead = node('[data-head]').attributes.transform;
  controller.greet();
  advance(1300);
  assert.notEqual(node('[data-head]').attributes.transform, previousHead);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(node(`[data-leg="${i}"]`).dataset.planted, 'true');
    assert.equal(Number(node(`[data-leg="${i}"]`).dataset.footY), GROUND);
  }
  assert.equal(element.dataset.pose, 'greet');
  advance(2300);
  assert.equal(element.dataset.pose, 'walk');
});

test('scaled actors preserve world-space ground contact and respect their actual width', (t) => {
  const { controller, node, element, window, advance } = ranchHarness(t);
  advance(32);
  const first = Array.from({ length: 4 }, (_, i) => {
    const leg = node(`[data-leg="${i}"]`).dataset;
    return { planted: leg.planted, x: controller.snapshot().x + Number(leg.footX) * 1.2 };
  });
  advance(16);
  first.forEach((before, i) => {
    const after = node(`[data-leg="${i}"]`).dataset;
    if (before.planted === 'true' && after.planted === 'true') {
      assert.ok(
        Math.abs(before.x - (controller.snapshot().x + Number(after.footX) * 1.2)) < 0.00001,
      );
    }
  });
  controller.pause(true);
  element.parentElement.clientWidth = 220;
  window.emit('resize');
  assert.equal(controller.snapshot().x, 4);
});

test('pastoral scenery is layered, unfenced, palette-aware and the greeting label is animal-friendly', () => {
  const js = readFileSync(path.join(__dirname, '../public/profile-extras.js'), 'utf8');
  const css = readFileSync(path.join(__dirname, '../public/profile-extras.css'), 'utf8');
  const scene = js.slice(js.indexOf('<div class="ranch-scene'), js.indexOf('const ownerSign'));
  assert.match(scene, /ranch-landscape/);
  assert.match(scene, /ranch-wildflowers/);
  assert.match(scene, /ranch-distant-tree/);
  assert.match(scene, /class="ranch-distant-tree" fill="currentColor"/);
  assert.match(scene, /ranch-window/);
  assert.match(scene, /和 Max 打个招呼/);
  assert.doesNotMatch(scene, /站起来|fence|栅栏/);
  assert.match(css, /body\.theme-dark \.ranch-meadow-light/);
  assert.match(css, /body\.theme-dark \.ranch-window/);
  assert.match(css, /#public-profile-ranch\s*\{\s*scroll-margin-top: 110px/);
  assert.equal(
    [...css.matchAll(/--ranch-tree: #[a-f0-9]{6}/g)].length,
    4,
    'each card has day and night foliage',
  );
  assert.match(css, /\.ranch-pet-track\s*\{[^}]*height: 216px/s);
  assert.match(css, /\[data-max-actor\]\s*\{[^}]*width: min\(216px, 100%\)/s);
});
