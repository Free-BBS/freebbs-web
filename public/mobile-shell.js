(() => {
  const nav = document.querySelector('.mobile-nav');
  if (!nav) return;
  const path = location.pathname.replace(/\/$/, '') || '/';
  const primary = [
    ['/', 'home', '首页'],
    ['/world', 'map', '学习世界'],
    ['/aichat', 'ai', '问问 Max'],
    ['/discussion', 'people', '讨论'],
  ];
  const tools = [
    ['/circuits', 'circuit', '电路实验室'],
    ['/workbench', 'run', '我的工作台'],
    ['/settings', 'gear', '个人设置'],
    ['/development', 'star', '发展端'],
  ];
  const activePath = ['/course', '/knowledge'].includes(path)
    ? '/world'
    : path === '/circuit'
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
  const group = document.createElement('div');
  group.className = 'mobile-tools';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mobile-primary mobile-tools-toggle';
  button.innerHTML =
    '<img src="/assets/icons/gear.svg" alt="" aria-hidden="true"><span>工具</span>';
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
  const close = (restore = false) => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restore) button.focus();
  };
  button.addEventListener('click', () => {
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
    const items = [...menu.querySelectorAll('a')];
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
    if (innerWidth > 900) close();
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
