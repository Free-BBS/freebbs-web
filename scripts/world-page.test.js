const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(path.join(projectRoot, 'public', 'world.html'), 'utf8');
const scriptSource = fs.readFileSync(path.join(projectRoot, 'public', 'world.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(projectRoot, 'public', 'world.css'), 'utf8');

function extractStudyWorlds() {
  const startMarker = 'const studyWorlds = ';
  const endMarker = '\n\nconst HIDDEN_ORBIT_SLOTS';
  const start = scriptSource.indexOf(startMarker);
  const end = scriptSource.indexOf(endMarker, start);

  assert.notEqual(start, -1, 'world.js should declare studyWorlds');
  assert.notEqual(end, -1, 'world.js should declare orbit constants after studyWorlds');

  const literal = scriptSource
    .slice(start + startMarker.length, end)
    .trim()
    .replace(/;$/, '');
  const value = vm.runInNewContext(`(${literal})`);
  return JSON.parse(JSON.stringify(value));
}

function extractHiddenSlots() {
  const match = scriptSource.match(/const HIDDEN_ORBIT_SLOTS = new Set\(\[([^\]]+)]\)/);
  assert.ok(match, 'world.js should declare hidden orbit slots');
  return match[1]
    .split(',')
    .map((value) => Number(value.trim()))
    .filter(Number.isFinite);
}

function islandButtonTags() {
  return pageSource.match(/<button\b(?=[^>]*class="[^"]*\bisland-orbit-item\b)[^>]*>/g) || [];
}

function attributeValue(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
}

const studyWorlds = extractStudyWorlds();
const hiddenSlots = extractHiddenSlots();

test('learning world declares exactly six subject islands in data and markup', () => {
  assert.equal(studyWorlds.length, 6);
  assert.deepEqual(
    studyWorlds.map((world) => world.id),
    ['mathematics', 'physics', 'circuits', 'signals', 'computing', 'laboratory'],
  );

  const buttons = islandButtonTags();
  assert.equal(buttons.length, 6);
  assert.deepEqual(
    buttons.map((tag) => Number(attributeValue(tag, 'data-world-index'))),
    [0, 1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    buttons.map((tag) => attributeValue(tag, 'data-world-id')),
    studyWorlds.map((world) => world.id),
  );
  assert.match(pageSource, /aria-label="六座知识岛围绕 FREE-BBS 学习中枢"/);
});

test('three islands are active and three coming islands expose no real course destination', () => {
  const activeWorlds = studyWorlds.filter((world) => world.status === 'active');
  const comingWorlds = studyWorlds.filter((world) => world.status === 'coming');

  assert.equal(activeWorlds.length, 3);
  assert.equal(comingWorlds.length, 3);
  assert.deepEqual(
    activeWorlds.map((world) => world.id),
    ['mathematics', 'circuits', 'signals'],
  );
  assert.deepEqual(
    comingWorlds.map((world) => world.id),
    ['physics', 'computing', 'laboratory'],
  );
  comingWorlds.forEach((world) => {
    assert.deepEqual(world.courses, [], `${world.id} must not advertise a placeholder course`);
    assert.equal(world.board, '', `${world.id} must not advertise a placeholder board`);
  });

  const buttons = islandButtonTags();
  assert.equal(buttons.filter((tag) => attributeValue(tag, 'data-status') === 'active').length, 3);
  assert.equal(buttons.filter((tag) => attributeValue(tag, 'data-status') === 'coming').length, 3);
  assert.ok(
    buttons.every(
      (tag) => attributeValue(tag, 'data-status') === attributeValue(tag, 'data-world-state'),
    ),
  );

  assert.match(scriptSource, /elements\.enterIsland\.disabled = !isActive/);
  assert.match(scriptSource, /elements\.discussionLink\.hidden = !isActive/);
  assert.match(scriptSource, /elements\.discussionLink\.removeAttribute\('href'\)/);
  assert.match(scriptSource, /if \(!world \|\| world\.status !== 'active'\) return/);
});

test('open islands alternate with coming islands around the complete circular orbit', () => {
  const circularWorlds = [...studyWorlds].sort((left, right) => left.baseSlot - right.baseSlot);
  circularWorlds.forEach((world, index) => {
    const nextWorld = circularWorlds[(index + 1) % circularWorlds.length];
    assert.notEqual(
      world.status,
      nextWorld.status,
      `${world.name} and ${nextWorld.name} alternate`,
    );
  });
  islandButtonTags().forEach((tag) => {
    const world = studyWorlds[Number(attributeValue(tag, 'data-world-index'))];
    assert.equal(Number(attributeValue(tag, 'data-orbit-slot')), world.baseSlot);
  });
  assert.doesNotMatch(pageSource, /ISLAND\s+0[1-6]/);
});

test('every orbit offset keeps four selectable islands and two background islands', () => {
  assert.deepEqual(hiddenSlots, [2, 3]);
  const normalizeSlot = (value) =>
    ((value % studyWorlds.length) + studyWorlds.length) % studyWorlds.length;

  for (let offset = 0; offset < studyWorlds.length; offset += 1) {
    const positions = studyWorlds.map((world) => normalizeSlot(world.baseSlot + offset));
    assert.equal(new Set(positions).size, 6, `offset ${offset} must occupy all six orbit slots`);
    assert.equal(
      positions.filter((slot) => hiddenSlots.includes(slot)).length,
      2,
      `offset ${offset} must keep two islands in the background`,
    );
    assert.equal(
      positions.filter((slot) => !hiddenSlots.includes(slot)).length,
      4,
      `offset ${offset} must keep four islands selectable`,
    );
  }

  const initialButtons = islandButtonTags();
  assert.equal(
    initialButtons.filter((tag) => attributeValue(tag, 'data-hidden') === 'true').length,
    2,
  );
  assert.equal(
    initialButtons.filter((tag) => attributeValue(tag, 'data-hidden') === 'false').length,
    4,
  );
  assert.match(scriptSource, /orbitButton\.dataset\.hidden = String\(hidden\)/);
  assert.match(scriptSource, /orbitButton\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(scriptSource, /orbitButton\.setAttribute\('inert', ''\)/);
  assert.match(styleSource, /\.island-orbit-item\[data-hidden='true']\s*,/);
});

test('selectable island slots stay in front of the parent 3D pointer hit-test plane', () => {
  // A negative translateZ can remain visible but send pointer clicks to the parent
  // orbit instead. Foreground slots must never inherit that background-only depth.
  [0, 1, 4, 5].forEach((slot) => {
    const selector = new RegExp(
      `\\.island-orbit-item\\[data-orbit-slot=['"]${slot}['"]\\]\\s*\\{([^}]*)\\}`,
      'g',
    );
    const depths = [...styleSource.matchAll(selector)].flatMap((block) =>
      [...block[1].matchAll(/--orbit-depth:\s*(-?\d+(?:\.\d+)?)px\s*;/g)].map((depth) =>
        Number(depth[1]),
      ),
    );
    assert.ok(depths.length > 0, `selectable slot ${slot} must declare its 3D depth`);
    depths.forEach((depth) => {
      assert.ok(
        depth >= 0,
        `selectable slot ${slot} depth ${depth}px would fall behind the parent pointer hit-test plane`,
      );
    });
  });
});

test('buttons, wheel, keyboard and horizontal touch gestures rotate the same orbit', () => {
  assert.equal((pageSource.match(/data-orbit-step="-?1"/g) || []).length, 2);
  assert.match(scriptSource, /rotateOrbit\(control\.dataset\.orbitStep\)/);

  assert.match(scriptSource, /elements\.orbit\.addEventListener\(\s*'wheel'/);
  assert.match(scriptSource, /event\.preventDefault\(\)/);
  assert.match(scriptSource, /Math\.abs\(wheelAccumulator\) < ORBIT_STEP_THRESHOLD/);
  assert.match(scriptSource, /wheelLockedUntil = now \+ ORBIT_STEP_COOLDOWN/);
  assert.match(scriptSource, /\{ passive: false \}/);

  assert.match(scriptSource, /elements\.orbit\.addEventListener\('keydown'/);
  assert.match(scriptSource, /event\.key === 'ArrowLeft' \|\| event\.key === 'ArrowRight'/);
  assert.match(scriptSource, /event\.key === 'Home'/);
  assert.match(scriptSource, /rotateOrbit\(event\.key === 'ArrowLeft' \? -1 : 1/);

  assert.match(scriptSource, /'touchstart'/);
  assert.match(scriptSource, /'touchend'/);
  assert.match(
    scriptSource,
    /Math\.abs\(deltaX\) < TOUCH_SWIPE_THRESHOLD \|\| Math\.abs\(deltaX\) <= Math\.abs\(deltaY\)/,
  );
  assert.match(scriptSource, /rotateOrbit\(deltaX < 0 \? 1 : -1\)/);
});

// Execute the real page handlers against a minimal DOM. The assertions below concern
// default browser scrolling and user interaction state, not a reimplementation of rotation.
function createWorldPageHarness(source = scriptSource) {
  let now = 1000;
  const nodes = new Map();

  function makeElement(id = '', tagName = 'div') {
    const attributes = new Map();
    const listeners = new Map();
    const classes = new Set();
    const styles = new Map();
    const element = {
      id,
      tagName: tagName.toUpperCase(),
      className: '',
      dataset: {},
      children: [],
      parentElement: null,
      hidden: false,
      clientHeight: 700,
      style: {
        setProperty(name, value) {
          styles.set(name, String(value));
        },
        getPropertyValue(name) {
          return styles.get(name) ?? '';
        },
      },
      classList: {
        add(name) {
          classes.add(name);
        },
        remove(name) {
          classes.delete(name);
        },
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
        },
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      hasAttribute(name) {
        return attributes.has(name);
      },
      removeAttribute(name) {
        attributes.delete(name);
      },
      contains(target) {
        let current = target;
        while (current) {
          if (current === element) return true;
          current = current.parentElement;
        }
        return false;
      },
      append(...children) {
        children.forEach((child) => {
          const childElement = child;
          childElement.parentElement = element;
          element.children.push(childElement);
        });
      },
      replaceChildren(...children) {
        element.children.forEach((child) => {
          const childElement = child;
          childElement.parentElement = null;
        });
        element.children = [];
        element.append(...children);
      },
      matches(selector) {
        if (selector.startsWith('.')) {
          return element.className.split(/\s+/).includes(selector.slice(1));
        }
        if (selector.startsWith('#')) return element.id === selector.slice(1);
        if (selector.startsWith('[')) return element.hasAttribute(selector.slice(1, -1));
        return element.tagName === selector.toUpperCase();
      },
      closest(selector) {
        let current = element;
        while (current) {
          if (current.matches(selector)) return current;
          current = current.parentElement;
        }
        return null;
      },
      focus() {
        document.activeElement = element;
      },
      querySelector(selector) {
        for (const child of element.children) {
          if (child.matches(selector)) return child;
          const descendant = child.querySelector(selector);
          if (descendant) return descendant;
        }
        return null;
      },
      addEventListener(type, listener, options) {
        const handlers = listeners.get(type) ?? [];
        handlers.push({ listener, capture: options === true || options?.capture === true });
        listeners.set(type, handlers);
      },
      invokeListeners(event, capture) {
        (listeners.get(event.type) ?? [])
          .filter((handler) => handler.capture === capture)
          .forEach((handler) => handler.listener(event));
      },
      dispatchEvent(event) {
        const ancestors = [];
        let current = element;
        while (current) {
          ancestors.push(current);
          current = current.parentElement;
        }
        for (const ancestor of [...ancestors].reverse()) {
          ancestor.invokeListeners(event, true);
          if (event.propagationStopped) return;
        }
        for (const ancestor of ancestors) {
          ancestor.invokeListeners(event, false);
          if (event.propagationStopped) return;
        }
      },
    };
    return element;
  }

  function byId(id) {
    if (!nodes.has(id)) nodes.set(id, makeElement(id));
    return nodes.get(id);
  }

  const islandButtons = islandButtonTags().map((tag) => {
    const button = makeElement();
    button.dataset.worldId = attributeValue(tag, 'data-world-id');
    button.dataset.worldIndex = attributeValue(tag, 'data-world-index');
    return button;
  });
  const controls = [-1, 1].map((step) => {
    const control = makeElement();
    control.dataset.orbitStep = String(step);
    return control;
  });
  const courseControls = [-1, 1].map((step) => {
    const control = makeElement();
    control.dataset.courseStep = String(step);
    return control;
  });
  const document = makeElement();
  document.body = makeElement();
  document.append(document.body);
  document.getElementById = byId;
  document.createElement = (tagName) => makeElement('', tagName);
  document.querySelector = () => byId('orbit-shell');
  document.querySelectorAll = (selector) => {
    if (selector === '[data-orbit-step]') return controls;
    if (selector === '[data-course-step]') return courseControls;
    return islandButtons;
  };
  document.body.append(byId('world-explorer'), byId('island-course-stage'), byId('world-modal'));
  byId('world-explorer').append(byId('world-orbit'));
  byId('world-orbit').append(byId('world-core'), ...islandButtons, ...controls);
  byId('world-modal').append(byId('world-enter-island'));
  byId('island-course-stage').append(
    byId('island-course-back'),
    byId('island-course-system'),
    byId('island-course-instruction'),
  );
  byId('island-course-system').append(
    byId('island-course-orbit'),
    byId('island-course-hub'),
    ...courseControls,
  );
  byId('island-course-hub').append(byId('island-course-hub-image'));
  byId('island-course-stage').hidden = true;

  const window = {
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    dispatchEvent() {},
    requestAnimationFrame(callback) {
      callback();
    },
  };
  vm.runInNewContext(source, { document, window, CustomEvent, Date: { now: () => now } });

  function emit(target, type, properties = {}) {
    const event = {
      type,
      target,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
      ...properties,
    };
    target.dispatchEvent(event);
    return event;
  }

  return {
    byId,
    islandButtons,
    controls,
    courseControls,
    emit,
    document,
    openCourses(worldId = 'mathematics') {
      const button = islandButtons.find((island) => island.dataset.worldId === worldId);
      assert.ok(button, `the test island ${worldId} must exist`);
      for (let step = 0; step < 6 && button.dataset.hidden === 'true'; step += 1) {
        emit(controls[1], 'click');
      }
      emit(button, 'click');
      assert.equal(byId('world-modal').hasAttribute('open'), true, 'island opens its overview');
      emit(byId('world-enter-island'), 'click');
      assert.equal(byId('world-modal').hasAttribute('open'), false, 'enter closes the overview');
      assert.equal(byId('island-course-stage').hidden, false, 'enter opens the course layer');
      return byId('island-course-orbit').children;
    },
    advanceTime(milliseconds = 400) {
      now += milliseconds;
    },
    wheel(properties = {}) {
      return emit(byId('world-orbit'), 'wheel', {
        deltaX: 0,
        deltaY: 120,
        deltaMode: 0,
        ctrlKey: false,
        ...properties,
      });
    },
    courseWheel(properties = {}) {
      return emit(byId('island-course-system'), 'wheel', {
        deltaX: 0,
        deltaY: 120,
        deltaMode: 0,
        ctrlKey: false,
        ...properties,
      });
    },
  };
}

test('wheel scroll stays native until the core is activated, and never captures browser zoom', () => {
  const page = createWorldPageHarness();
  const core = page.byId('world-core');
  const orbit = page.byId('world-orbit');

  assert.equal(page.wheel().defaultPrevented, false);
  assert.equal(orbit.dataset.orbitOffset, '0');
  assert.equal(core.getAttribute('aria-pressed'), 'false');

  page.emit(core, 'click');
  assert.equal(core.getAttribute('aria-pressed'), 'true');
  assert.equal(page.wheel({ ctrlKey: true }).defaultPrevented, false);
  assert.equal(orbit.dataset.orbitOffset, '0');

  assert.equal(page.wheel().defaultPrevented, true);
  assert.equal(orbit.dataset.orbitOffset, '1');
  page.wheel();
  assert.equal(orbit.dataset.orbitOffset, '1', 'wheel inertia must not skip several islands');

  for (let step = 0; step < 5; step += 1) {
    page.advanceTime();
    page.wheel();
    assert.equal(page.islandButtons.filter((node) => node.dataset.hidden === 'false').length, 4);
  }
  assert.equal(orbit.dataset.orbitOffset, '0', 'six wheel steps must complete the circular orbit');
});

test('outside click, Escape and clicking the core again restore ordinary scrolling immediately', () => {
  const page = createWorldPageHarness();
  const core = page.byId('world-core');
  const orbit = page.byId('world-orbit');

  page.emit(core, 'click');
  page.emit(page.document, 'click', { target: { parentElement: core } });
  assert.equal(core.getAttribute('aria-pressed'), 'true', 'clicking core content keeps the mode');
  page.emit(page.document, 'click', { target: page.byId('world-explorer') });
  assert.equal(core.getAttribute('aria-pressed'), 'false');
  assert.equal(page.wheel().defaultPrevented, false);

  page.emit(core, 'click');
  page.emit(page.document, 'keydown', { key: 'Escape' });
  assert.equal(page.wheel().defaultPrevented, false);
  assert.equal(core.getAttribute('aria-pressed'), 'false');

  page.emit(core, 'click');
  page.emit(core, 'click');
  assert.equal(page.wheel().defaultPrevented, false);
  assert.equal(orbit.dataset.orbitOffset, '0');
});

test('line-based mouse wheels rotate accessibly while small trackpad deltas accumulate', () => {
  const page = createWorldPageHarness();
  page.emit(page.byId('world-core'), 'click');
  page.wheel({ deltaY: 3, deltaMode: 1 });
  assert.equal(page.byId('world-orbit').dataset.orbitOffset, '1');

  page.advanceTime();
  page.wheel({ deltaY: -18 });
  assert.equal(page.byId('world-orbit').dataset.orbitOffset, '1');
  page.wheel({ deltaY: -18 });
  assert.equal(page.byId('world-orbit').dataset.orbitOffset, '0');
});

test('faint background islands remain inaccessible until they rotate into the selectable foreground', () => {
  const page = createWorldPageHarness();
  page.emit(page.byId('world-core'), 'click');

  for (let step = 0; step < 6; step += 1) {
    const background = page.islandButtons.filter((node) => node.dataset.hidden === 'true');
    const foreground = page.islandButtons.filter((node) => node.dataset.hidden === 'false');
    assert.equal(background.length, 2);
    assert.equal(foreground.length, 4);

    background.forEach((button) => {
      assert.equal(button.tabIndex, -1, 'background islands cannot receive sequential focus');
      assert.equal(button.getAttribute('aria-hidden'), 'true');
      assert.equal(button.hasAttribute('inert'), true);
      page.emit(button, 'click');
      assert.equal(page.byId('world-modal').hasAttribute('open'), false);
    });
    foreground.forEach((button) => {
      assert.equal(button.tabIndex, 0, 'foreground islands return to keyboard navigation');
      assert.equal(button.hasAttribute('aria-hidden'), false);
      assert.equal(button.hasAttribute('inert'), false);
    });

    page.advanceTime();
    page.wheel();
  }
});

test('active islands open a course-planet layer with the three real course routes', () => {
  assert.match(pageSource, /id="island-course-stage"[^>]*data-stage-state="closed"[^>]*hidden/);
  assert.match(pageSource, /id="island-course-orbit"[^>]*role="list"/);
  assert.match(scriptSource, /item\.className = 'island-course-node'/);
  assert.match(scriptSource, /link\.className = 'island-course-planet'/);
  assert.match(scriptSource, /link\.dataset\.courseSlug = course\.slug/);
  assert.match(scriptSource, /link\.href = courseHref\(course\.slug\)/);

  const activeRoutes = studyWorlds
    .filter((world) => world.status === 'active')
    .flatMap((world) => world.courses)
    .map((course) => `/course?course=${encodeURIComponent(course.slug)}`);
  assert.deepEqual(activeRoutes, [
    '/course?course=math',
    '/course?course=circuits',
    '/course?course=signals',
  ]);
  assert.equal(studyWorlds[0].courses[0].name, '高等微积分');
  assert.match(scriptSource, /elements\.courseOrbit\.replaceChildren/);
  assert.match(scriptSource, /world\.courses\.map\(\(course, index\) => createCoursePlanet/);
  assert.match(scriptSource, /--world-course-island-image/);
  assert.match(styleSource, /background:\s*var\(--world-course-island-image\)/);
});

test('real island clicks render each course route, accessible identity and separate central island', () => {
  const page = createWorldPageHarness();
  const worlds = studyWorlds.filter((world) => world.status === 'active');

  worlds.forEach((world) => {
    const nodes = page.openCourses(world.id);
    assert.equal(nodes.length, world.courses.length);
    assert.equal(page.byId('world-explorer').hidden, true);
    assert.equal(page.byId('island-course-hub-image').src, world.image);
    assert.equal(page.byId('island-course-hub').parentElement, page.byId('island-course-system'));
    assert.equal(
      page.byId('island-course-orbit').children.includes(page.byId('island-course-hub')),
      false,
    );

    nodes.forEach((node, index) => {
      const course = world.courses[index];
      const link = node.querySelector('a');
      assert.equal(node.getAttribute('role'), 'listitem');
      assert.equal(link.href, `/course?course=${course.slug}`);
      assert.equal(link.getAttribute('aria-label'), `进入课程：${course.name}`);
      assert.equal(link.querySelector('strong').textContent, course.name);
      assert.ok(link.querySelector('.island-course-identity'));
    });
    page.emit(page.byId('island-course-back'), 'click');
    assert.equal(page.byId('world-explorer').hidden, false);
  });
});

test('a single real course circles all six slots without disabled controls or duplicate planets', () => {
  const page = createWorldPageHarness();
  const [node] = page.openCourses();
  const orbit = page.byId('island-course-orbit');
  assert.equal(node.dataset.courseSlot, '0');

  for (let step = 1; step <= 6; step += 1) {
    assert.notEqual(page.courseControls[1].disabled, true);
    page.emit(page.courseControls[1], 'click');
    assert.equal(orbit.dataset.courseOffset, String(step % 6));
    assert.equal(node.dataset.courseSlot, String(step % 6));
    assert.equal(orbit.children.length, 1, 'rotation must not manufacture placeholder courses');
    assert.equal(orbit.children[0], node, 'rotation keeps the original real course node');
    assert.equal(node.querySelector('a').href, '/course?course=math');
  }
  page.emit(page.courseControls[0], 'click');
  assert.equal(node.dataset.courseSlot, '5', 'left rotation wraps backwards');
  assert.equal(node.dataset.courseDepth, 'back');
});

test('course arrow keys and Home operate through the same slot state and preserve link focus', () => {
  const page = createWorldPageHarness();
  const [node] = page.openCourses('signals');
  const link = node.querySelector('a');
  link.focus();

  assert.equal(page.emit(link, 'keydown', { key: 'ArrowLeft' }).defaultPrevented, true);
  assert.equal(node.dataset.courseSlot, '5');
  assert.equal(page.emit(link, 'keydown', { key: 'ArrowRight' }).defaultPrevented, true);
  assert.equal(node.dataset.courseSlot, '0');
  page.emit(link, 'keydown', { key: 'ArrowRight' });
  assert.equal(node.dataset.courseSlot, '1');
  assert.equal(page.emit(link, 'keydown', { key: 'Home' }).defaultPrevented, true);
  assert.equal(node.dataset.courseSlot, '0');
  assert.equal(page.document.activeElement, link);
  assert.equal(page.emit(link, 'keydown', { key: 'ArrowDown' }).defaultPrevented, false);
});

test('course wheels remain native until central-island activation and do not capture browser zoom', () => {
  const page = createWorldPageHarness();
  const [node] = page.openCourses();
  const hub = page.byId('island-course-hub');
  const system = page.byId('island-course-system');
  assert.equal(page.courseWheel().defaultPrevented, false);
  assert.equal(node.dataset.courseSlot, '0');
  assert.equal(hub.getAttribute('aria-pressed'), 'false');

  page.emit(page.byId('island-course-hub-image'), 'click');
  assert.equal(hub.getAttribute('aria-pressed'), 'true', 'the image click bubbles to its button');
  assert.equal(system.dataset.rotationActive, 'true');
  assert.equal(page.courseWheel({ ctrlKey: true }).defaultPrevented, false);
  assert.equal(page.courseWheel({ deltaY: 0, deltaX: 0 }).defaultPrevented, false);
  assert.equal(node.dataset.courseSlot, '0');

  assert.equal(page.courseWheel({ deltaY: 3, deltaMode: 1 }).defaultPrevented, true);
  assert.equal(node.dataset.courseSlot, '1');
  page.courseWheel();
  assert.equal(node.dataset.courseSlot, '1', 'wheel inertia is throttled');

  page.advanceTime();
  page.courseWheel({ deltaY: -18 });
  assert.equal(node.dataset.courseSlot, '1');
  page.courseWheel({ deltaY: -18 });
  assert.equal(node.dataset.courseSlot, '0', 'small trackpad deltas accumulate');
  page.emit(hub, 'click');
  assert.equal(hub.getAttribute('aria-pressed'), 'false');
  assert.equal(page.courseWheel().defaultPrevented, false);
});

test('outside click and first Escape leave course browsing intact; back or second Escape reset the next visit', () => {
  const page = createWorldPageHarness();
  const hub = page.byId('island-course-hub');
  const stage = page.byId('island-course-stage');
  page.openCourses('signals');
  page.emit(hub, 'click');
  page.courseWheel();
  page.emit(page.byId('island-course-instruction'), 'click');
  assert.equal(hub.getAttribute('aria-pressed'), 'false');
  assert.equal(stage.hidden, false);
  assert.equal(page.courseWheel().defaultPrevented, false);

  page.emit(hub, 'click');
  page.emit(page.document, 'keydown', { key: 'Escape' });
  assert.equal(hub.getAttribute('aria-pressed'), 'false');
  assert.equal(stage.hidden, false, 'first Escape exits rotation rather than the course page');
  assert.equal(page.courseWheel().defaultPrevented, false);
  page.emit(page.document, 'keydown', { key: 'Escape' });
  assert.equal(stage.hidden, true);
  assert.equal(page.byId('world-explorer').hidden, false);

  const [reopenedNode] = page.openCourses('signals');
  assert.equal(reopenedNode.dataset.courseSlot, '0');
  assert.equal(page.byId('island-course-orbit').dataset.courseOffset, '0');
  assert.equal(hub.getAttribute('aria-pressed'), 'false');
  page.emit(hub, 'click');
  page.courseWheel();
  page.emit(page.byId('island-course-back'), 'click');
  assert.equal(stage.hidden, true);
  assert.equal(page.byId('island-course-system').dataset.rotationActive, 'false');
  assert.equal(page.courseWheel().defaultPrevented, false);
  assert.equal(page.openCourses('signals')[0].dataset.courseSlot, '0');
});

test('horizontal course swipes rotate and suppress accidental navigation without blocking vertical touch scrolling', () => {
  const page = createWorldPageHarness();
  const [node] = page.openCourses();
  const link = node.querySelector('a');
  const origin = { clientX: 200, clientY: 300 };
  const touchStart = (touches = [origin]) =>
    page.emit(link, 'touchstart', { touches, changedTouches: [origin] });
  const touchEnd = (clientX, clientY) =>
    page.emit(link, 'touchend', { touches: [], changedTouches: [{ clientX, clientY }] });

  assert.equal(touchStart().defaultPrevented, false);
  assert.equal(touchEnd(195, 420).defaultPrevented, false);
  assert.equal(node.dataset.courseSlot, '0', 'vertical gestures preserve native page scrolling');
  touchStart([origin, { clientX: 250, clientY: 300 }]);
  touchEnd(100, 300);
  assert.equal(node.dataset.courseSlot, '0', 'two-finger gestures do not rotate');

  touchStart();
  touchEnd(140, 308);
  assert.equal(node.dataset.courseSlot, '1');
  const releaseClick = page.emit(link, 'click');
  assert.equal(releaseClick.defaultPrevented, true);
  assert.equal(releaseClick.propagationStopped, true);
  assert.equal(link.href, '/course?course=math', 'the real course destination is unchanged');
  page.advanceTime(500);
  assert.equal(
    page.emit(link, 'click').defaultPrevented,
    false,
    'a later ordinary tap follows the link',
  );

  touchStart();
  touchEnd(260, 300);
  assert.equal(node.dataset.courseSlot, '0', 'right swipes reverse the rotation');
  touchStart();
  page.emit(link, 'touchcancel');
  touchEnd(100, 300);
  assert.equal(node.dataset.courseSlot, '0', 'cancelled gestures do not rotate');
});

test('two and three real courses distribute evenly when supplied to the course layer', () => {
  const realCourses = studyWorlds
    .filter((world) => world.status === 'active')
    .flatMap((world) => world.courses);
  [2, 3].forEach((count) => {
    // Test-only in-memory fixture: no placeholder courses are added to the site data.
    const courses = realCourses.slice(0, count);
    const source = scriptSource.replace(
      'const HIDDEN_ORBIT_SLOTS',
      `studyWorlds[0].courses = ${JSON.stringify(courses)};\nconst HIDDEN_ORBIT_SLOTS`,
    );
    const page = createWorldPageHarness(source);
    const nodes = page.openCourses();
    assert.equal(nodes.length, count);
    assert.deepEqual(
      nodes.map((node) => node.dataset.courseSlot),
      count === 2 ? ['0', '3'] : ['0', '2', '4'],
    );
    assert.deepEqual(
      nodes.map((node) => node.querySelector('a').href),
      courses.map((course) => `/course?course=${course.slug}`),
    );
    page.emit(page.courseControls[1], 'click');
    assert.deepEqual(
      nodes.map((node) => node.dataset.courseSlot),
      count === 2 ? ['1', '4'] : ['1', '3', '5'],
    );
  });
});

test('world styles retain dark/light themes, responsive layouts and reduced-motion fallbacks', () => {
  assert.match(styleSource, /:root\s*{[^}]*color-scheme:\s*dark/s);
  assert.match(styleSource, /body\.theme-light\.world-page\s*{[^}]*color-scheme:\s*light/s);
  assert.match(styleSource, /body\.world-page\s*{[^}]*--world-coming-surface:/s);
  assert.match(styleSource, /body\.theme-light\.world-page\s*{[^}]*--world-coming-surface:/s);
  assert.match(styleSource, /@media \(max-width: 900px\)/);
  assert.match(styleSource, /@media \(max-width: 640px\)/);
  assert.match(styleSource, /@media \(max-width: 420px\)/);
  assert.match(styleSource, /@media \(max-height: 760px\) and \(min-width: 901px\)/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(
    styleSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/,
  );
  assert.match(
    styleSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none !important/,
  );
  assert.match(styleSource, /\.island-orbit-item:focus-visible/);
});
