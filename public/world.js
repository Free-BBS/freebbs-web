const studyWorlds = [
  {
    name: '数理基础',
    image: '/assets/math_island.webp',
    mobileImage: '/assets/math_island_mobile.webp',
    board: 'math',
    course: 'math',
    description:
      '从微积分、线性代数、复指数到概率统计，建立后续信号、电路与系统分析需要的数学基础。',
  },
  {
    name: '信号系统',
    image: '/assets/signals_island.webp',
    mobileImage: '/assets/signals_island_mobile.webp',
    board: 'signal',
    course: 'signals',
    description:
      '围绕信号分类、卷积、傅里叶分析与采样定理，理解信号在时域和频域中的结构与变化。',
  },
  {
    name: '电子电路与系统',
    image: '/assets/circuits_island.webp',
    mobileImage: '/assets/circuits_island_mobile.webp',
    board: 'circuit',
    course: 'circuits',
    description:
      '从基尔霍夫定律、运算放大器、滤波器到反馈系统，逐步进入模拟电路与系统设计。',
  },
  {
    name: '数字电路',
    image: '/assets/digital_island.webp',
    mobileImage: '/assets/digital_island_mobile.webp',
    board: 'circuit',
    course: 'digital',
    description:
      '用布尔代数、逻辑门、有限状态机与 Verilog 建模，搭建分析和设计数字系统的思维框架。',
  },
];

const elements = {
  previous: document.getElementById('world-prev'),
  next: document.getElementById('world-next'),
  islandButton: document.getElementById('world-island-button'),
  islandImage: document.getElementById('world-island-image'),
  islandMobileSource: document.getElementById('world-island-mobile-source'),
  islandTitle: document.getElementById('world-island-title'),
  modal: document.getElementById('world-modal'),
  modalTitle: document.getElementById('world-modal-title'),
  modalDescription: document.getElementById('world-modal-description'),
  mapLink: document.getElementById('world-map-link'),
  discussionLink: document.getElementById('world-discussion-link'),
  searchForm: document.getElementById('world-search-form'),
  searchInput: document.getElementById('world-search-input'),
};

let activeWorldIndex = 0;
let touchStartX = null;
let isSwitching = false;

function activeWorld() {
  return studyWorlds[activeWorldIndex];
}

function courseHref(course) {
  return `/course?course=${encodeURIComponent(course)}`;
}

function discussionHref(board) {
  return `/discussion?board=${encodeURIComponent(board)}`;
}

function updateWorldContent() {
  const world = activeWorld();

  elements.islandImage.src = world.image;
  elements.islandImage.alt = `${world.name}岛屿`;
  elements.islandMobileSource.srcset = world.mobileImage;
  elements.islandTitle.textContent = world.name;
  elements.islandButton.setAttribute('aria-label', `打开${world.name}简介`);
  document.title = `FREE-BBS - ${world.name}`;
}

function showWorldAt(nextIndex, direction) {
  if (isSwitching) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const view = elements.islandButton.parentElement;

  activeWorldIndex = nextIndex;

  if (reducedMotion || typeof view.animate !== 'function') {
    updateWorldContent();
    return;
  }

  isSwitching = true;
  view
    .animate(
      [
        { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: `translateX(${direction > 0 ? '-28px' : '28px'})` },
      ],
      { duration: 150, easing: 'ease-in', fill: 'forwards' },
    )
    .finished.then(() => {
      updateWorldContent();
      return view.animate(
        [
          { opacity: 0, transform: `translateX(${direction > 0 ? '28px' : '-28px'})` },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
      ).finished;
    })
    .finally(() => {
      isSwitching = false;
    });
}

function switchWorld(direction) {
  const nextIndex =
    (activeWorldIndex + direction + studyWorlds.length) % studyWorlds.length;
  showWorldAt(nextIndex, direction);
}

function openWorldModal() {
  const world = activeWorld();

  elements.modalTitle.textContent = world.name;
  elements.modalDescription.textContent = world.description;
  elements.mapLink.href = courseHref(world.course);
  elements.discussionLink.href = discussionHref(world.board);

  if (typeof elements.modal.showModal === 'function') {
    elements.modal.showModal();
  } else {
    elements.modal.setAttribute('open', '');
  }

  document.body.classList.add('world-modal-open');
}

function closeWorldModal() {
  if (typeof elements.modal.close === 'function') {
    elements.modal.close();
  } else {
    elements.modal.removeAttribute('open');
  }

  document.body.classList.remove('world-modal-open');
  elements.islandButton.focus();
}

elements.previous.addEventListener('click', () => switchWorld(-1));
elements.next.addEventListener('click', () => switchWorld(1));
elements.islandButton.addEventListener('click', openWorldModal);
elements.searchForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = elements.searchInput?.value.trim().toLowerCase();
  if (!query) return;

  const nextIndex = studyWorlds.findIndex((world) =>
    `${world.name} ${world.description}`.toLowerCase().includes(query),
  );

  if (nextIndex >= 0 && nextIndex !== activeWorldIndex) {
    showWorldAt(nextIndex, nextIndex > activeWorldIndex ? 1 : -1);
  }
});

elements.modal.addEventListener('click', (event) => {
  if (event.target === elements.modal || event.target.closest('[data-close-modal]')) {
    closeWorldModal();
  }
});

elements.modal.addEventListener('close', () => {
  document.body.classList.remove('world-modal-open');
});

document.addEventListener('keydown', (event) => {
  if (elements.modal.open) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeWorldModal();
    }
    return;
  }

  if (event.key === 'ArrowLeft') {
    switchWorld(-1);
  } else if (event.key === 'ArrowRight') {
    switchWorld(1);
  }
});

elements.islandButton.addEventListener(
  'touchstart',
  (event) => {
    touchStartX = event.touches[0]?.clientX ?? null;
  },
  { passive: true },
);

elements.islandButton.addEventListener(
  'touchend',
  (event) => {
    if (touchStartX === null) return;

    const touchEndX = event.changedTouches[0]?.clientX ?? touchStartX;
    const distance = touchEndX - touchStartX;
    touchStartX = null;

    if (Math.abs(distance) < 48) return;
    switchWorld(distance < 0 ? 1 : -1);
  },
  { passive: true },
);

updateWorldContent();
