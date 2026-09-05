const studyWorlds = [
  {
    id: 'mathematics',
    baseSlot: 0,
    code: 'ISLAND',
    name: '数学基础',
    status: 'active',
    image: '/assets/math_island.webp',
    board: 'math',
    symbol: '∑',
    topics: '微积分 · 线性代数 · 复指数 · 概率统计',
    description:
      '从微积分、线性代数、复指数到概率统计，建立后续信号、电路与系统分析需要的数学基础。',
    courses: [
      {
        code: 'COURSE 01',
        name: '高等微积分',
        slug: 'math',
        description: '以极限、微分、积分与级数构建描述连续变化的基础语言。',
      },
    ],
  },
  {
    id: 'physics',
    baseSlot: 1,
    code: 'ISLAND',
    name: '物理本质',
    status: 'coming',
    image: '/assets/physics_island_v2.webp',
    board: '',
    symbol: 'Φ',
    topics: '电磁场 · 量子与统计 · 固体物理',
    description: '从基本规律和物理图像出发，连接理论模型、实验现象与工程问题。',
    courses: [],
  },
  {
    id: 'circuits',
    baseSlot: 2,
    code: 'ISLAND',
    name: '电路架构',
    status: 'active',
    image: '/assets/circuits_island.webp',
    board: 'circuit',
    symbol: '⌁',
    topics: '电路基础 · 运算放大器 · 滤波器 · 反馈系统',
    description: '从基尔霍夫定律、运算放大器、滤波器到反馈系统，逐步进入电路与系统设计。',
    courses: [
      {
        code: 'COURSE 01',
        name: '电子电路与系统基础',
        slug: 'circuits',
        description: '从电路定律和典型器件出发，理解分析、设计与反馈的基本方法。',
      },
    ],
  },
  {
    id: 'signals',
    baseSlot: 4,
    code: 'ISLAND',
    name: '信号系统',
    status: 'active',
    image: '/assets/signals_island.webp',
    board: 'signal',
    symbol: '∿',
    topics: '信号分类 · 卷积 · 傅里叶分析 · 采样定理',
    description: '围绕信号分类、卷积、傅里叶分析与采样定理，理解信号在时域和频域中的结构。',
    courses: [
      {
        code: 'COURSE 01',
        name: '信号与系统',
        slug: 'signals',
        description: '用系统观点串联时域、频域、变换域与采样等核心知识。',
      },
    ],
  },
  {
    id: 'computing',
    baseSlot: 3,
    code: 'ISLAND',
    name: '计算机科学',
    status: 'coming',
    image: '/assets/digital_island.webp',
    board: '',
    symbol: '01',
    topics: '程序设计 · 数据结构 · 计算机系统',
    description: '从程序、数据与硬件协同的角度，建立解决计算问题的系统方法。',
    courses: [],
  },
  {
    id: 'laboratory',
    baseSlot: 5,
    code: 'ISLAND',
    name: '实验能力',
    status: 'coming',
    image: '/assets/laboratory_island_v2.webp',
    board: '',
    symbol: 'LAB',
    topics: '仪器使用 · 测量方法 · 系统实现',
    description: '把理论落实到测量、调试和系统实现，形成可复现的实验能力。',
    courses: [],
  },
];

const HIDDEN_ORBIT_SLOTS = new Set([2, 3]);
const ORBIT_STEP_THRESHOLD = 36;
const ORBIT_STEP_COOLDOWN = 320;
const TOUCH_SWIPE_THRESHOLD = 42;
const COURSE_ORBIT_SLOTS = 6;

const elements = {
  explorer: document.getElementById('world-explorer'),
  orbitShell: document.querySelector('.world-orbit-shell'),
  orbit: document.getElementById('world-orbit'),
  core: document.getElementById('world-core'),
  orbitInstruction: document.getElementById('world-orbit-instruction'),
  orbitControls: Array.from(document.querySelectorAll('[data-orbit-step]')),
  islandButtons: Array.from(document.querySelectorAll('.island-orbit-item[data-world-index]')),
  orbitStatus: document.getElementById('world-orbit-status'),
  courseStage: document.getElementById('island-course-stage'),
  courseBack: document.getElementById('island-course-back'),
  courseCode: document.getElementById('island-course-code'),
  courseTitle: document.getElementById('island-course-title'),
  courseDescription: document.getElementById('island-course-description'),
  courseSystem: document.getElementById('island-course-system'),
  courseOrbit: document.getElementById('island-course-orbit'),
  courseHub: document.getElementById('island-course-hub'),
  courseHubImage: document.getElementById('island-course-hub-image'),
  courseControls: Array.from(document.querySelectorAll('[data-course-step]')),
  courseInstruction: document.getElementById('island-course-instruction'),
  courseStatus: document.getElementById('island-course-status'),
  modal: document.getElementById('world-modal'),
  modalImage: document.getElementById('world-modal-image'),
  modalSymbol: document.getElementById('world-modal-symbol'),
  modalKicker: document.getElementById('world-modal-kicker'),
  modalTitle: document.getElementById('world-modal-title'),
  modalStatus: document.getElementById('world-modal-status'),
  modalDescription: document.getElementById('world-modal-description'),
  modalTopics: document.getElementById('world-modal-topics'),
  enterIsland: document.getElementById('world-enter-island'),
  discussionLink: document.getElementById('world-discussion-link'),
};

let orbitOffset = 0;
let selectedWorldIndex = null;
let lastActiveIslandButton = null;
let orbitMotionTimer = null;
let wheelAccumulator = 0;
let wheelLockedUntil = 0;
let wheelResetTimer = null;
let touchStart = null;
let wheelRotationActive = false;
let courseOrbitOffset = 0;
let courseNodes = [];
let courseWheelRotationActive = false;
let courseWheelAccumulator = 0;
let courseWheelLockedUntil = 0;
let courseWheelResetTimer = null;
let courseTouchStart = null;
let courseSuppressClickUntil = 0;

function setWheelRotationActive(active) {
  wheelRotationActive = active && !elements.explorer.hidden;
  elements.orbitShell.dataset.rotationActive = String(wheelRotationActive);
  elements.core.setAttribute('aria-pressed', String(wheelRotationActive));
  elements.core.setAttribute(
    'aria-label',
    wheelRotationActive
      ? 'FREE-BBS 学习中枢，点击退出滚轮旋转'
      : 'FREE-BBS 学习中枢，点击开启滚轮旋转',
  );
  elements.orbitInstruction.textContent = wheelRotationActive
    ? '已进入轨道旋转模式：滚动鼠标切换知识岛；点击外部或按 Esc 恢复页面滚动。'
    : '点击中央星球后，用滚轮旋转知识岛；点击外部恢复页面滚动。也可使用左右按钮、方向键或横向滑动。';
  wheelAccumulator = 0;
  wheelLockedUntil = 0;
  window.clearTimeout(wheelResetTimer);
}

function normalizeSlot(value) {
  return ((value % studyWorlds.length) + studyWorlds.length) % studyWorlds.length;
}

function courseHref(course) {
  return `/course?course=${encodeURIComponent(course)}`;
}

function discussionHref(board) {
  return `/discussion?board=${encodeURIComponent(board)}`;
}

function emitWorldEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function worldAtSlot(slot) {
  return studyWorlds.find((world) => normalizeSlot(world.baseSlot + orbitOffset) === slot);
}

function buttonForWorld(worldId) {
  return elements.islandButtons.find((button) => button.dataset.worldId === worldId);
}

function updateOrbitState({ moveFocus = false } = {}) {
  const visibleWorldIds = [];

  elements.islandButtons.forEach((button) => {
    const orbitButton = button;
    const world = studyWorlds[Number(button.dataset.worldIndex)];
    if (!world) return;

    const slot = normalizeSlot(world.baseSlot + orbitOffset);
    const hidden = HIDDEN_ORBIT_SLOTS.has(slot);

    orbitButton.dataset.worldState = world.status;
    orbitButton.dataset.orbitSlot = String(slot);
    orbitButton.dataset.orbitPosition = String(slot);
    orbitButton.dataset.hidden = String(hidden);
    orbitButton.style.setProperty('--orbit-slot', String(slot));
    orbitButton.classList.toggle('is-orbit-visible', !hidden);
    orbitButton.classList.toggle('is-hidden-behind-core', hidden);
    orbitButton.tabIndex = hidden ? -1 : 0;

    if (hidden) {
      orbitButton.setAttribute('aria-hidden', 'true');
      orbitButton.setAttribute('inert', '');
    } else {
      orbitButton.removeAttribute('aria-hidden');
      orbitButton.removeAttribute('inert');
      visibleWorldIds.push(world.id);
    }
  });

  elements.orbit.dataset.orbitOffset = String(orbitOffset);
  const frontWorld = worldAtSlot(0);
  const frontStatus = frontWorld?.status === 'active' ? '已开放' : '建设中';
  elements.orbitStatus.textContent = frontWorld
    ? `轨道前景：${frontWorld.name}（${frontStatus}）`
    : '';

  if (moveFocus && frontWorld) {
    buttonForWorld(frontWorld.id)?.focus();
  }

  elements.orbit.classList.add('is-orbit-moving');
  elements.orbitShell?.classList.add('is-orbit-moving');
  window.clearTimeout(orbitMotionTimer);
  orbitMotionTimer = window.setTimeout(() => {
    elements.orbit.classList.remove('is-orbit-moving');
    elements.orbitShell?.classList.remove('is-orbit-moving');
  }, 520);

  emitWorldEvent('world:orbit-change', {
    offset: orbitOffset,
    frontWorldId: frontWorld?.id ?? null,
    visibleWorldIds,
  });
}

function rotateOrbit(step, { moveFocus = false } = {}) {
  orbitOffset = normalizeSlot(orbitOffset + (Number(step) < 0 ? -1 : 1));
  updateOrbitState({ moveFocus });
}

function renderModalVisual(world) {
  if (world.image) {
    elements.modalImage.src = world.image;
    elements.modalImage.alt = `${world.name}知识岛`;
    elements.modalImage.hidden = false;
    elements.modalSymbol.hidden = true;
  } else {
    elements.modalImage.removeAttribute('src');
    elements.modalImage.alt = '';
    elements.modalImage.hidden = true;
    elements.modalSymbol.textContent = world.symbol;
    elements.modalSymbol.hidden = false;
  }
}

function openWorldModal(worldIndex, trigger) {
  const world = studyWorlds[worldIndex];
  if (!world || trigger?.dataset.hidden === 'true') return;

  setWheelRotationActive(false);

  selectedWorldIndex = worldIndex;
  lastActiveIslandButton = trigger ?? buttonForWorld(world.id);
  renderModalVisual(world);
  elements.modalKicker.textContent = `${world.code} · 学习岛屿`;
  elements.modalTitle.textContent = world.name;
  elements.modalDescription.textContent = world.description;
  elements.modalTopics.textContent = world.topics;

  const isActive = world.status === 'active';
  elements.modal.classList.toggle('is-coming', !isActive);
  elements.modalStatus.textContent = isActive ? '板块已开放' : '建设中 · 敬请期待';
  elements.enterIsland.disabled = !isActive;
  elements.enterIsland.classList.toggle('is-disabled', !isActive);
  elements.enterIsland.textContent = isActive ? '进入板块课程' : '敬请期待';
  elements.discussionLink.hidden = !isActive;

  if (isActive) {
    elements.discussionLink.href = discussionHref(world.board);
  } else {
    elements.discussionLink.removeAttribute('href');
  }

  if (typeof elements.modal.showModal === 'function') {
    elements.modal.showModal();
  } else {
    elements.modal.setAttribute('open', '');
  }

  document.body.classList.add('world-modal-open');
  window.requestAnimationFrame(() => elements.modal.querySelector('[data-close-modal]')?.focus());
}

function closeWorldModal({ restoreFocus = true } = {}) {
  const wasOpen = elements.modal.hasAttribute('open');

  if (typeof elements.modal.close === 'function' && wasOpen) {
    elements.modal.close();
  } else {
    elements.modal.removeAttribute('open');
  }

  document.body.classList.remove('world-modal-open');
  if (restoreFocus) lastActiveIslandButton?.focus();
}

function createCoursePlanet(course, index) {
  const item = document.createElement('article');
  item.className = 'island-course-node';
  item.setAttribute('role', 'listitem');
  item.style.setProperty('--course-index', String(index));
  item.dataset.courseIndex = String(index);

  const link = document.createElement('a');
  link.className = 'island-course-planet';
  link.href = courseHref(course.slug);
  link.dataset.courseSlug = course.slug;
  link.setAttribute('aria-label', `进入课程：${course.name}`);

  const code = document.createElement('small');
  code.textContent = course.code;
  const name = document.createElement('strong');
  name.textContent = course.name;
  const description = document.createElement('span');
  description.textContent = course.description;
  const action = document.createElement('span');
  action.className = 'island-course-action';
  action.textContent = '进入课程地图 ↗';

  const identity = document.createElement('span');
  identity.className = 'island-course-identity';
  identity.append(code, name, description, action);
  link.append(identity);
  item.append(link);
  return item;
}

function normalizeCourseSlot(value) {
  return ((value % COURSE_ORBIT_SLOTS) + COURSE_ORBIT_SLOTS) % COURSE_ORBIT_SLOTS;
}

function setCourseWheelRotationActive(active) {
  courseWheelRotationActive = active && !elements.courseStage.hidden;
  elements.courseSystem.dataset.rotationActive = String(courseWheelRotationActive);
  elements.courseHub.setAttribute('aria-pressed', String(courseWheelRotationActive));
  const world = studyWorlds[selectedWorldIndex];
  elements.courseHub.setAttribute(
    'aria-label',
    `${world?.name ?? '当前'}知识岛，点击${courseWheelRotationActive ? '退出' : '开启'}课程滚轮旋转`,
  );
  elements.courseInstruction.textContent = courseWheelRotationActive
    ? '已进入课程轨道旋转模式：滚动鼠标转动课程星球；点击外部或按 Esc 恢复页面滚动。'
    : '点击中央知识岛后，用滚轮转动课程星球；点击外部恢复页面滚动。也可使用左右按钮、方向键或横向滑动，单门课程也可沿轨道环绕。';
  courseWheelAccumulator = 0;
  courseWheelLockedUntil = 0;
  window.clearTimeout(courseWheelResetTimer);
}

function updateCourseOrbitState() {
  courseNodes.forEach((node, index) => {
    const baseSlot = Math.floor((index * COURSE_ORBIT_SLOTS) / courseNodes.length);
    const slot = normalizeCourseSlot(baseSlot + courseOrbitOffset);
    const courseNode = node;
    courseNode.dataset.courseSlot = String(slot);
    courseNode.dataset.courseDepth = slot >= 4 ? 'back' : 'front';
  });
  elements.courseOrbit.dataset.courseOffset = String(courseOrbitOffset);
  emitWorldEvent('world:course-orbit-change', {
    offset: courseOrbitOffset,
    worldId: studyWorlds[selectedWorldIndex]?.id ?? null,
  });
}

function rotateCourseOrbit(step) {
  if (elements.courseStage.hidden || !courseNodes.length) return;
  courseOrbitOffset = normalizeCourseSlot(courseOrbitOffset + (Number(step) < 0 ? -1 : 1));
  updateCourseOrbitState();
}

function renderCourseStage(world) {
  elements.courseCode.textContent = `${world.code} · COURSE SYSTEM`;
  elements.courseTitle.textContent = world.name;
  elements.courseDescription.textContent = world.description;
  elements.courseOrbit.style.setProperty('--world-course-island-image', `url("${world.image}")`);
  elements.courseOrbit.dataset.worldId = world.id;
  elements.courseSystem.dataset.worldId = world.id;
  elements.courseHubImage.src = world.image;
  courseOrbitOffset = 0;
  courseNodes = world.courses.map((course, index) => createCoursePlanet(course, index));
  elements.courseOrbit.replaceChildren(...courseNodes);
  updateCourseOrbitState();
  elements.courseOrbit.setAttribute('aria-label', `${world.name}板块课程`);
  elements.courseStatus.textContent = `已开放 ${world.courses.length} 门课程，选择课程小星球进入现有学习地图。`;
}

function openCourseStage(worldIndex) {
  const world = studyWorlds[worldIndex];
  if (!world || world.status !== 'active') return;

  setWheelRotationActive(false);

  selectedWorldIndex = worldIndex;
  renderCourseStage(world);
  elements.explorer.hidden = true;
  elements.courseStage.hidden = false;
  setCourseWheelRotationActive(false);
  elements.courseStage.dataset.stageState = 'open';
  elements.courseStage.classList.add('is-open');
  document.body.classList.add('world-course-stage-open');
  document.body.dataset.worldView = 'courses';
  document.title = `FREE-BBS - ${world.name}`;
  window.requestAnimationFrame(() => {
    elements.courseStage.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    elements.courseTitle.focus({ preventScroll: true });
  });

  emitWorldEvent('world:stage-change', {
    view: 'courses',
    worldId: world.id,
    courseSlugs: world.courses.map((course) => course.slug),
  });
}

function closeCourseStage() {
  const world = studyWorlds[selectedWorldIndex];
  setCourseWheelRotationActive(false);
  courseTouchStart = null;
  elements.courseStage.hidden = true;
  elements.courseStage.dataset.stageState = 'closed';
  elements.courseStage.classList.remove('is-open');
  elements.explorer.hidden = false;
  document.body.classList.remove('world-course-stage-open');
  document.body.dataset.worldView = 'orbit';
  document.title = 'FREE-BBS - 学习世界';

  const preferredButton = world ? buttonForWorld(world.id) : null;
  const fallbackWorld = worldAtSlot(0);
  let focusTarget = elements.orbit;
  if (preferredButton?.dataset.hidden === 'false') {
    focusTarget = preferredButton;
  } else if (fallbackWorld) {
    focusTarget = buttonForWorld(fallbackWorld.id);
  }
  window.requestAnimationFrame(() => focusTarget?.focus());

  emitWorldEvent('world:stage-change', {
    view: 'orbit',
    worldId: world?.id ?? null,
  });
}

elements.orbitControls.forEach((control) => {
  control.addEventListener('click', () => rotateOrbit(control.dataset.orbitStep));
});

elements.core.addEventListener('click', () => {
  setWheelRotationActive(!wheelRotationActive);
});

document.addEventListener('click', (event) => {
  if (wheelRotationActive && !elements.core.contains(event.target)) {
    setWheelRotationActive(false);
  }
  if (courseWheelRotationActive && !elements.courseHub.contains(event.target)) {
    setCourseWheelRotationActive(false);
  }
});

elements.islandButtons.forEach((button) => {
  button.addEventListener('click', () => {
    openWorldModal(Number(button.dataset.worldIndex), button);
  });
});

elements.orbit.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    rotateOrbit(event.key === 'ArrowLeft' ? -1 : 1, {
      moveFocus: event.target.closest?.('.island-orbit-item') != null,
    });
  } else if (event.key === 'Home') {
    event.preventDefault();
    orbitOffset = 0;
    updateOrbitState({ moveFocus: true });
  }
});

elements.orbit.addEventListener(
  'wheel',
  (event) => {
    if (!wheelRotationActive || event.ctrlKey || elements.explorer.hidden) return;

    const primaryDelta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!primaryDelta) return;

    event.preventDefault();
    const now = Date.now();
    if (now < wheelLockedUntil) return;

    // Mouse wheels may report lines or pages; trackpads normally report pixels.
    const deltaUnit = event.deltaMode === 1 ? 16 : 1;
    const pageUnit = event.deltaMode === 2 ? elements.orbit.clientHeight : deltaUnit;
    wheelAccumulator += primaryDelta * pageUnit;
    window.clearTimeout(wheelResetTimer);
    wheelResetTimer = window.setTimeout(() => {
      wheelAccumulator = 0;
    }, 180);

    if (Math.abs(wheelAccumulator) < ORBIT_STEP_THRESHOLD) return;

    rotateOrbit(wheelAccumulator > 0 ? 1 : -1);
    wheelAccumulator = 0;
    wheelLockedUntil = now + ORBIT_STEP_COOLDOWN;
  },
  { passive: false },
);

elements.orbit.addEventListener(
  'touchstart',
  (event) => {
    const touch = event.changedTouches[0];
    touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
  },
  { passive: true },
);

elements.orbit.addEventListener(
  'touchend',
  (event) => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;
    touchStart = null;

    if (Math.abs(deltaX) < TOUCH_SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    rotateOrbit(deltaX < 0 ? 1 : -1);
  },
  { passive: true },
);

elements.enterIsland.addEventListener('click', () => {
  const world = studyWorlds[selectedWorldIndex];
  if (!world || world.status !== 'active') return;
  closeWorldModal({ restoreFocus: false });
  openCourseStage(selectedWorldIndex);
});

elements.courseControls.forEach((control) => {
  control.addEventListener('click', () => rotateCourseOrbit(control.dataset.courseStep));
});

elements.courseHub.addEventListener('click', () => {
  setCourseWheelRotationActive(!courseWheelRotationActive);
});

elements.courseSystem.addEventListener('keydown', (event) => {
  if (elements.courseStage.hidden) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    rotateCourseOrbit(event.key === 'ArrowLeft' ? -1 : 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    courseOrbitOffset = 0;
    updateCourseOrbitState();
  }
});

elements.courseSystem.addEventListener(
  'wheel',
  (event) => {
    if (!courseWheelRotationActive || event.ctrlKey || elements.courseStage.hidden) return;
    const primaryDelta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!primaryDelta) return;

    event.preventDefault();
    const now = Date.now();
    if (now < courseWheelLockedUntil) return;
    const deltaUnit = event.deltaMode === 1 ? 16 : 1;
    const pageUnit = event.deltaMode === 2 ? elements.courseSystem.clientHeight : deltaUnit;
    courseWheelAccumulator += primaryDelta * pageUnit;
    window.clearTimeout(courseWheelResetTimer);
    courseWheelResetTimer = window.setTimeout(() => {
      courseWheelAccumulator = 0;
    }, 180);
    if (Math.abs(courseWheelAccumulator) < ORBIT_STEP_THRESHOLD) return;

    rotateCourseOrbit(courseWheelAccumulator > 0 ? 1 : -1);
    courseWheelAccumulator = 0;
    courseWheelLockedUntil = now + ORBIT_STEP_COOLDOWN;
  },
  { passive: false },
);

elements.courseSystem.addEventListener(
  'touchstart',
  (event) => {
    const touch = event.touches.length === 1 ? event.changedTouches[0] : null;
    courseTouchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
  },
  { passive: true },
);

elements.courseSystem.addEventListener(
  'touchend',
  (event) => {
    if (!courseTouchStart) return;
    const start = courseTouchStart;
    courseTouchStart = null;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < TOUCH_SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) return;

    rotateCourseOrbit(deltaX < 0 ? 1 : -1);
    // A swipe starting on a course should rotate it, not follow its link on release.
    courseSuppressClickUntil = Date.now() + 400;
  },
  { passive: true },
);

elements.courseSystem.addEventListener(
  'touchcancel',
  () => {
    courseTouchStart = null;
  },
  { passive: true },
);

elements.courseSystem.addEventListener(
  'click',
  (event) => {
    if (Date.now() < courseSuppressClickUntil && event.target.closest?.('.island-course-planet')) {
      event.preventDefault();
      event.stopPropagation();
    }
  },
  true,
);

elements.courseBack.addEventListener('click', closeCourseStage);

elements.modal.addEventListener('click', (event) => {
  if (event.target === elements.modal || event.target.closest('[data-close-modal]')) {
    closeWorldModal();
  }
});

elements.modal.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeWorldModal();
});

elements.modal.addEventListener('close', () => {
  document.body.classList.remove('world-modal-open');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && courseWheelRotationActive) {
    setCourseWheelRotationActive(false);
    return;
  }
  if (event.key === 'Escape' && wheelRotationActive) {
    setWheelRotationActive(false);
  }
  if (
    event.key === 'Escape' &&
    !elements.courseStage.hidden &&
    !elements.modal.hasAttribute('open')
  ) {
    closeCourseStage();
  }
});

document.body.dataset.worldView = 'orbit';
setWheelRotationActive(false);
setCourseWheelRotationActive(false);
updateOrbitState();
