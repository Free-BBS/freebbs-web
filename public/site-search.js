(() => {
  if (window.self !== window.top || document.getElementById('site-search-dialog')) return;
  const types = [
    ['all', '全部'],
    ['page', '页面'],
    ['post', '帖子'],
    ['course', '课程'],
    ['knowledge', '知识点'],
    ['circuit', '电路'],
  ];
  const fullPage = document.getElementById('site-search-page');
  const host = fullPage || document.createElement('dialog');
  host.id = fullPage ? 'site-search-page' : 'site-search-dialog';
  host.classList.add('site-search');
  host.setAttribute('aria-label', '全站搜索');
  host.innerHTML =
    '<form class="site-search-form" role="search"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg><input type="search" maxlength="120" placeholder="搜索帖子、知识点、课程…" aria-label="搜索全站" autocomplete="off"><button type="submit">搜索</button><button type="button" data-close aria-label="关闭搜索">×</button></form><nav class="site-search-types" aria-label="搜索分类"></nav><div class="site-search-status" role="status" aria-live="polite"></div><ol class="site-search-results"></ol><button type="button" class="site-search-more" hidden>加载更多</button><div class="site-search-footer"><span>搜索公开内容</span><a href="/search">打开搜索页面 ↗</a></div>';
  if (!fullPage) document.body.append(host);
  const input = host.querySelector('input');
  const form = host.querySelector('form');
  const list = host.querySelector('ol');
  const status = host.querySelector('[role="status"]');
  const more = host.querySelector('.site-search-more');
  const close = host.querySelector('[data-close]');
  const footerLink = host.querySelector('.site-search-footer a');
  const params = new URLSearchParams(window.location.search);
  let type =
    fullPage && types.some(([key]) => key === params.get('type')) ? params.get('type') : 'all';
  let offset = 0;
  let controller;
  let timer;
  let generation = 0;
  let opener;
  let composing = false;
  let resultCount = 0;
  input.value = fullPage ? (params.get('q') || '').slice(0, 120) : '';
  types.forEach(([key, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.type = key;
    button.addEventListener('click', () => {
      type = key;
      search();
    });
    host.querySelector('nav').append(button);
  });
  function updateFilters() {
    host
      .querySelectorAll('[data-type]')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.type === type)),
      );
  }
  function appendResult(result) {
    // Only navigate to same-origin paths, even if a response is malformed.
    if (
      !result.url?.startsWith('/') ||
      new URL(result.url, window.location.origin).origin !== window.location.origin
    )
      return;
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = result.url;
    const meta = document.createElement('small');
    meta.textContent = `${types.find(([key]) => key === result.type)?.[1] || '内容'}${result.section ? ` · ${result.section}` : ''}`;
    const title = document.createElement('strong');
    title.textContent = result.title;
    const description = document.createElement('p');
    description.textContent = result.excerpt;
    link.append(meta, title, description);
    li.append(link);
    list.append(li);
  }
  async function search(append = false) {
    clearTimeout(timer);
    controller?.abort();
    generation += 1;
    const version = generation;
    controller = new AbortController();
    if (!append) {
      offset = 0;
      resultCount = 0;
      list.replaceChildren();
    }
    more.hidden = true;
    updateFilters();
    const query = new URLSearchParams({ q: input.value.trim(), type });
    footerLink.href = `/search?${query}`;
    if (fullPage) window.history.replaceState(null, '', `/search?${query}`);
    query.set('offset', String(offset));
    status.textContent = '正在搜索…';
    list.setAttribute('aria-busy', 'true');
    try {
      const base = window.FREEBBS_API_BASE || '/api';
      const response = await fetch(`${base}/search?${query}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '搜索失败，请重试。');
      if (version !== generation) return;
      data.results.forEach(appendResult);
      resultCount += data.results.length;
      offset = data.nextOffset;
      more.hidden = !data.hasMore;
      status.textContent = resultCount
        ? `${input.value.trim() ? '找到' : '浏览'} ${resultCount}${data.hasMore ? '+' : ''} 项内容${data.limited ? '，可缩小关键词范围继续查找' : ''}`
        : '没有找到匹配内容，试试更短的关键词或其他分类。';
    } catch (error) {
      if (version !== generation || error.name === 'AbortError') return;
      status.textContent = error.message || '搜索暂时不可用，请稍后重试。';
      if (append) more.hidden = false;
    } finally {
      if (version === generation) list.setAttribute('aria-busy', 'false');
    }
  }
  const open = () => {
    if (!fullPage) {
      opener = document.activeElement;
      if (!host.open) host.showModal();
    }
    input.focus();
    input.select();
    search();
  };
  const dismiss = () => {
    if (!fullPage) host.close();
  };
  close.hidden = Boolean(fullPage);
  footerLink.hidden = Boolean(fullPage);
  close.addEventListener('click', dismiss);
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !fullPage) {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
  });
  host.addEventListener('close', () => {
    generation += 1;
    controller?.abort();
    clearTimeout(timer);
    opener?.focus();
  });
  host.addEventListener('click', (event) => {
    if (event.target === host && !fullPage) {
      const rect = host.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dismiss();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!composing) search();
  });
  more.addEventListener('click', () => search(true));
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    clearTimeout(timer);
    timer = setTimeout(search, 220);
  });
  input.addEventListener('input', () => {
    generation += 1;
    controller?.abort();
    clearTimeout(timer);
    if (!composing) timer = setTimeout(search, 220);
  });
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'site-search-trigger';
  trigger.title = '全站搜索（Ctrl / ⌘ K）';
  trigger.setAttribute('aria-label', '全站搜索');
  trigger.innerHTML =
    '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg><span>全站搜索</span>';
  trigger.addEventListener('click', open);
  const actions = document.querySelector('.topbar .nav-actions');
  if (actions) actions.prepend(trigger);
  else {
    trigger.classList.add('site-search-floating');
    document.body.append(trigger);
  }
  document.addEventListener('keydown', (event) => {
    const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (
      (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) ||
      (event.key === '/' && !typing && !event.altKey && !event.metaKey && !event.ctrlKey)
    ) {
      event.preventDefault();
      open();
    }
  });
  document.querySelectorAll('form.searchbar').forEach((searchbar) => {
    searchbar.addEventListener('submit', (event) => {
      event.preventDefault();
      input.value = searchbar.querySelector('input')?.value || '';
      open();
    });
  });
  const resize = () =>
    host.style.setProperty(
      '--site-search-height',
      `${(window.visualViewport?.height || window.innerHeight) - 24}px`,
    );
  window.visualViewport?.addEventListener('resize', resize);
  resize();
  updateFilters();
  if (fullPage) search();
})();
