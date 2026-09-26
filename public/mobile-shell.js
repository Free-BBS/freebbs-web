(() => {
  if (
    !document.body.classList.contains('auth-page-body') &&
    !document.documentElement.classList.contains('development-embedded') &&
    document.querySelector('.topbar .user-panel')
  ) {
    document.body.classList.add('has-mobile-header');
    const backdrop = document.createElement('div');
    backdrop.className = 'mobile-header-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.append(backdrop);
  }
  const nav = document.querySelector('.mobile-nav');
  if (!nav) return;
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const primary = [
    ['/', 'home', '首页'],
    ['/discussion', 'people', '讨论'],
    ['/publish', 'plus', ''],
    ['/world', 'map', '学习'],
  ];
  const tools = [
    ['/development', 'star', '发展端'],
    ['/workbench', 'run', '我的工作台'],
    ['/settings', 'gear', '个人设置'],
  ];
  const activePath = ['/course', '/knowledge'].includes(path)
    ? '/world'
    : path === '/circuit' || path === '/circuit-challenge'
      ? '/circuits'
      : path;
  function link([href, icon, label], className) {
    const node = document.createElement('a');
    node.href = href;
    node.className = className;
    node.innerHTML = `<img src="/assets/icons/${icon}.svg" alt="" aria-hidden="true"><span>${label}</span>`;
    if (href === activePath) {
      node.classList.add('is-active');
      node.setAttribute('aria-current', 'page');
    }
    return node;
  }
  nav.classList.add('mobile-nav-compact');
  nav.replaceChildren(...primary.map((item) => link(item, 'nav-link mobile-primary')));
  const createGroup = document.createElement('div');
  createGroup.className = 'mobile-create';
  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'mobile-primary mobile-publish';
  createButton.innerHTML = '<img src="/assets/icons/plus.svg" alt="" aria-hidden="true">';
  createButton.setAttribute('aria-label', '发帖或问问 Max');
  createButton.setAttribute('aria-haspopup', 'menu');
  createButton.setAttribute('aria-expanded', 'false');
  createButton.setAttribute('aria-controls', 'mobile-create-menu');
  const createMenu = document.createElement('div');
  createMenu.id = 'mobile-create-menu';
  createMenu.className = 'mobile-tools-menu mobile-create-menu';
  createMenu.setAttribute('role', 'menu');
  createMenu.hidden = true;
  for (const item of [
    ['/publish', 'compose', '发帖'],
    ['/aichat', 'ai', '问问 Max'],
  ]) {
    const node = link(item, 'mobile-tool-link');
    node.setAttribute('role', 'menuitem');
    createMenu.append(node);
  }
  const closeCreate = (focus = false) => {
    createMenu.hidden = true;
    createButton.setAttribute('aria-expanded', 'false');
    if (focus) createButton.focus();
  };
  createButton.addEventListener('click', () => {
    close();
    createMenu.hidden = !createMenu.hidden;
    createButton.setAttribute('aria-expanded', String(!createMenu.hidden));
  });
  createGroup.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCreate(true);
      event.preventDefault();
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      close();
      createMenu.hidden = false;
      createButton.setAttribute('aria-expanded', 'true');
      const items = [...createMenu.querySelectorAll('a')];
      const index = items.indexOf(document.activeElement);
      items[
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
      ].focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!createGroup.contains(event.target)) closeCreate();
  });
  createGroup.addEventListener('focusout', (event) => {
    if (!createGroup.contains(event.relatedTarget)) closeCreate();
  });
  createMenu.addEventListener('click', () => closeCreate());
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeCreate();
  });
  createGroup.append(createButton, createMenu);
  nav.children[2].replaceWith(createGroup);

  const learningGroup = document.createElement('div');
  learningGroup.className = 'mobile-tools mobile-learning';
  const learningButton = document.createElement('button');
  learningButton.type = 'button';
  learningButton.className = 'mobile-primary mobile-learning-toggle';
  learningButton.innerHTML =
    '<img src="/assets/icons/map.svg" alt="" aria-hidden="true"><span>学习</span>';
  learningButton.setAttribute('aria-expanded', 'false');
  learningButton.setAttribute('aria-haspopup', 'menu');
  learningButton.setAttribute('aria-controls', 'mobile-learning-menu');
  if (['/world', '/circuits', '/tool-workshop'].includes(activePath))
    learningButton.classList.add('is-active');
  const learningMenu = document.createElement('div');
  learningMenu.id = 'mobile-learning-menu';
  learningMenu.className = 'mobile-tools-menu mobile-learning-menu';
  learningMenu.setAttribute('role', 'menu');
  learningMenu.setAttribute('aria-label', '学习');
  learningMenu.hidden = true;
  const knowledge = link(['/world', 'map', '知识小宇宙'], 'mobile-tool-link');
  knowledge.setAttribute('role', 'menuitem');
  learningMenu.append(knowledge);
  const creativeLabel = document.createElement('p');
  creativeLabel.className = 'mobile-menu-label';
  creativeLabel.textContent = '创意实验室';
  learningMenu.append(creativeLabel);
  for (const item of [
    ['/circuits', 'circuit', '电路实验室'],
    ['/tool-workshop', 'wrench', '小工具工坊'],
  ]) {
    const node = link(item, 'mobile-tool-link');
    node.setAttribute('role', 'menuitem');
    learningMenu.append(node);
  }
  const closeLearning = (restore = false) => {
    learningMenu.hidden = true;
    learningButton.setAttribute('aria-expanded', 'false');
    if (restore) learningButton.focus();
  };
  learningButton.addEventListener('click', () => {
    closeCreate();
    close();
    learningMenu.hidden = !learningMenu.hidden;
    learningButton.setAttribute('aria-expanded', String(!learningMenu.hidden));
  });
  learningGroup.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeLearning(true);
      event.preventDefault();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    learningMenu.hidden = false;
    learningButton.setAttribute('aria-expanded', 'true');
    const items = [...learningMenu.querySelectorAll('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!learningGroup.contains(event.target)) closeLearning();
  });
  learningGroup.addEventListener('focusout', (event) => {
    if (!learningGroup.contains(event.relatedTarget)) closeLearning();
  });
  learningMenu.addEventListener('click', () => closeLearning());
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeLearning();
  });
  learningGroup.append(learningButton, learningMenu);
  nav.children[3].replaceWith(learningGroup);

  const group = document.createElement('div');
  group.className = 'mobile-tools';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mobile-primary mobile-tools-toggle';
  button.innerHTML =
    '<img src="/assets/icons/wrench.svg" alt="" aria-hidden="true"><span>工具</span>';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-controls', 'mobile-tools-menu');
  if (tools.some(([href]) => href === activePath)) button.classList.add('is-active');
  const menu = document.createElement('div');
  menu.id = 'mobile-tools-menu';
  menu.className = 'mobile-tools-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '工具');
  menu.hidden = true;
  for (const item of tools) {
    const node = link(item, 'mobile-tool-link');
    node.setAttribute('role', 'menuitem');
    menu.append(node);
  }
  const syncAdmin = () => {
    const loggedIn = Boolean(window.freeBbsApp?.userState?.isLoggedIn);
    document.body.classList.toggle('mobile-guest', !loggedIn);
    menu.querySelector('[data-login-tool]')?.remove();
    if (!loggedIn) {
      const entry = link(['/login', 'people', '登录 / 注册'], 'mobile-tool-link');
      entry.dataset.loginTool = 'true';
      entry.setAttribute('role', 'menuitem');
      menu.prepend(entry);
    }

    menu.querySelector('[data-admin-tool]')?.remove();
    if (window.freeBbsApp?.userState?.isAdmin) {
      const node = link(['/system-settings', 'gear', '系统设置'], 'mobile-tool-link');
      node.dataset.adminTool = 'true';
      node.setAttribute('role', 'menuitem');
      menu.append(node);
    }
  };
  window.addEventListener('freebbs:session-change', syncAdmin);
  const close = (restore = false) => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restore) button.focus();
  };
  const action = (label, icon, handler) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'mobile-tool-link mobile-tool-action';
    node.setAttribute('role', 'menuitem');
    node.innerHTML = `<img src="/assets/icons/${icon}.svg" alt=""><span>${label}</span>`;
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      close();
      handler(event);
    });
    menu.append(node);
    return node;
  };
  const inbox = action('通知中心', 'chats', () => {
    if (!window.freeBbsApp?.userState?.isLoggedIn) {
      window.location.href = '/login';
      return;
    }
    window.dispatchEvent(new CustomEvent('freebbs:open-notifications'));
  });
  window.addEventListener('freebbs:notification-count', (event) => {
    const count = Number(event.detail?.count) || 0;
    inbox.querySelector('span').textContent = count ? `通知中心 · ${count} 未读` : '通知中心';
    button.classList.toggle('has-unread', count > 0);
  });
  window.freeBbsApp?.sessionReady?.then(syncAdmin);
  syncAdmin();
  button.addEventListener('click', () => {
    closeCreate();
    closeLearning();
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
  });
  group.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close(true);
      event.preventDefault();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!group.contains(event.target)) close();
  });
  group.addEventListener('focusout', (event) => {
    if (!group.contains(event.relatedTarget)) close();
  });
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) close();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) close();
  });
  group.append(button, menu);
  nav.append(group);

  // Keep the existing filter controls and event handlers, but group them more compactly.
  if (!document.body.classList.contains('discussion-page')) return;
  const scope = document.querySelector('.discussion-scope');
  const toolbar = document.querySelector('.discussion-feed-toolbar');
  const create = document.getElementById('discussion-create-toggle');
  const filters = toolbar?.querySelector('.discussion-filter-group');
  const deleted = document.getElementById('discussion-deleted-filter');
  if (!scope || !toolbar || !create || !filters) return;
  const responsive = matchMedia('(max-width: 900px)');
  const original = {
    parent: create.parentNode,
    next: create.nextSibling,
    filtersParent: filters.parentNode,
    filtersNext: filters.nextSibling,
    deletedParent: deleted?.parentNode,
    deletedNext: deleted?.nextSibling,
  };
  const options = document.createElement('details');
  options.className = 'discussion-filter-menu';
  const summary = document.createElement('summary');
  summary.textContent = '最新 ▾';
  summary.setAttribute('aria-label', '排序与筛选');
  const panel = document.createElement('div');
  panel.className = 'discussion-filter-popover';
  options.append(summary, panel);
  const sync = () => {
    const selected = filters.querySelector('[aria-pressed="true"]');
    summary.textContent = `${selected?.textContent.trim() || '最新'} ▾`;
  };
  new MutationObserver(sync).observe(filters, {
    attributes: true,
    subtree: true,
    attributeFilter: ['aria-pressed'],
  });
  filters.addEventListener('click', () => {
    options.open = false;
  });
  document.addEventListener('pointerdown', (event) => {
    if (!options.contains(event.target)) options.open = false;
  });
  options.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      options.open = false;
      summary.focus();
    }
  });
  const arrange = () => {
    if (responsive.matches) {
      scope.append(options, create);
      panel.append(filters);
      if (deleted) panel.append(deleted);
    } else {
      options.open = false;
      original.parent.insertBefore(create, original.next);
      original.filtersParent.insertBefore(filters, original.filtersNext);
      if (deleted) original.deletedParent.insertBefore(deleted, original.deletedNext);
      options.remove();
    }
  };
  responsive.addEventListener('change', arrange);
  arrange();
  sync();
})();
