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
    '<form class="site-search-form" role="search"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg><input type="search" maxlength="120" placeholder="搜索帖子、知识点、课程…" aria-label="搜索全站" autocomplete="off"><button type="submit">搜索</button><button type="button" data-close aria-label="关闭搜索">×</button></form><nav class="site-search-types" aria-label="搜索分类"></nav><div class="site-search-status" role="status" aria-live="polite"></div><ol class="site-search-results"></ol><button type="button" class="site-search-more" hidden>加载更多</button><div class="site-search-footer"><span>搜索当前可见内容</span><a href="/search">打开搜索页面 ↗</a></div>';
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
      const response = await fetch(`${base}/search?${query}`, {
        signal: controller.signal,
        headers: window.freeBbsApp?.userState?.token
          ? { Authorization: `Bearer ${window.freeBbsApp.userState.token}` }
          : {},
      });
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
  const actions = document.querySelector('.topbar');
  if (actions) actions.prepend(trigger);
  else {
    trigger.classList.add('site-search-floating');
    document.body.append(trigger);
  }
  // Page CSS may replace the shell title (for example, the home breadcrumb).
  // Measure the rendered content with its real typography, not just the dataset.
  const headerMain = document.querySelector('.main-content[data-page-title]');
  const accountPanel = document.querySelector('.user-panel');
  const titleMeasure = document.createElement('span');
  titleMeasure.className = 'site-search-title-measure';
  titleMeasure.setAttribute('aria-hidden', 'true');
  document.body.append(titleMeasure);
  const measureTitle = (heading) => {
    if (
      heading.display === 'none' ||
      heading.content === 'none' ||
      heading.content === 'normal' ||
      parseFloat(heading.fontSize) === 0
    )
      return 0;
    const quoted = heading.content.match(/^(["'])([\s\S]*)\1$/);
    titleMeasure.textContent = quoted
      ? quoted[2].replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_, hex, escaped) =>
          hex ? String.fromCodePoint(parseInt(hex, 16) || 0xfffd) : escaped,
        )
      : headerMain.dataset.pageTitle || '';
    [
      'fontFamily',
      'fontSize',
      'fontStyle',
      'fontWeight',
      'fontStretch',
      'fontVariant',
      'fontKerning',
      'fontFeatureSettings',
      'fontVariationSettings',
      'letterSpacing',
      'wordSpacing',
      'textTransform',
    ].forEach((property) => {
      titleMeasure.style[property] = heading[property];
    });
    titleMeasure.style.width = 'max-content';
    titleMeasure.style.whiteSpace = 'pre';
    return titleMeasure.getBoundingClientRect().width;
  };
  const placeTrigger = () => {
    trigger.classList.remove('is-expanded');
    trigger.style.removeProperty('left');
    trigger.style.removeProperty('right');
    trigger.style.removeProperty('width');
    if (
      !actions ||
      !headerMain ||
      !accountPanel ||
      document.body.classList.contains('auth-page-body')
    )
      return;
    const mobile = window.innerWidth <= 900;
    delete headerMain.dataset.searchWrappedTitle;
    delete document.body.dataset.searchWrappedTitle;
    delete document.body.dataset.searchCompactAccount;
    const heading = getComputedStyle(headerMain, '::before');
    const titleLeft = (parseFloat(heading.left) || 0) + (parseFloat(heading.paddingLeft) || 0);
    const titleWidth = measureTitle(heading);
    let right = accountPanel.getBoundingClientRect().left - (mobile ? 12 : 20);
    // A username is optional header detail; the complete page title is not.
    if (!mobile && right - 40 < titleLeft + titleWidth + 24) {
      document.body.dataset.searchCompactAccount = '';
      right = accountPanel.getBoundingClientRect().left - 20;
    }
    const expandedLeft = titleLeft + titleWidth + 24;
    const available = right - expandedLeft;
    let left = right - 40;
    let width = 40;
    if (!mobile && available >= 180) {
      trigger.classList.add('is-expanded');
      width = Math.min(240, available);
      left = right - width;
    }
    trigger.style.left = `${left}px`;
    trigger.style.right = 'auto';
    trigger.style.width = `${width}px`;
    // Some pages retain a separate mobile theme button to the left of search.
    // Reserve every visible control in the title row, not the balance row below.
    const titleTop =
      (parseFloat(heading.top) || 0) +
      (parseFloat(heading.borderTopWidth) || 0) +
      (parseFloat(heading.paddingTop) || 0);
    const baseHeaderHeight = parseFloat(heading.height) || (mobile ? 64 : 92);
    const titleBottom = titleTop + baseHeaderHeight;
    let controlsLeft = trigger.getBoundingClientRect().left;
    [
      accountPanel,
      ...document.querySelectorAll('.mobile-theme-toggle, .notification-bell'),
    ].forEach((control) => {
      const rect = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > titleLeft &&
        rect.top < titleBottom &&
        rect.bottom > titleTop &&
        style.visibility === 'visible' &&
        style.opacity !== '0'
      )
        controlsLeft = Math.min(controlsLeft, rect.left);
    });
    // Discussion's mobile search keeps its wide layout and hides its title.
    const reserve =
      window.innerWidth - (parseFloat(heading.right) || 0) - controlsLeft + (mobile ? 12 : 24);
    headerMain.style.setProperty('--site-search-title-reserve', `${Math.max(0, reserve)}px`);
    const titleAvailable = Math.max(1, controlsLeft - (mobile ? 12 : 24) - titleLeft);
    if (titleWidth > titleAvailable) {
      // Measure wrapped text with the exact title typography. Never infer fit
      // from an already clipped pseudo-element (which hid the original bug).
      titleMeasure.style.whiteSpace = 'normal';
      titleMeasure.style.overflowWrap = 'anywhere';
      titleMeasure.style.lineHeight = heading.lineHeight;
      titleMeasure.style.width = `${titleAvailable}px`;
      const extra = Math.max(
        0,
        Math.ceil(titleMeasure.getBoundingClientRect().height + 24 - baseHeaderHeight),
      );
      if (extra > 0) {
        headerMain.style.setProperty('--site-search-base-header-height', `${baseHeaderHeight}px`);
        headerMain.style.setProperty(
          '--site-search-base-main-padding',
          getComputedStyle(headerMain).paddingTop,
        );
        headerMain.style.setProperty('--site-search-header-extra', `${extra}px`);
        document.body.style.setProperty('--site-search-header-extra', `${extra}px`);
        headerMain.dataset.searchWrappedTitle = '';
        document.body.dataset.searchWrappedTitle = '';
      }
    }
  };
  let placementFrame;
  const schedulePlacement = () => {
    cancelAnimationFrame(placementFrame);
    placementFrame = requestAnimationFrame(placeTrigger);
  };
  window.addEventListener('resize', schedulePlacement);
  window.addEventListener('load', schedulePlacement);
  window.addEventListener('freebbs:session-change', schedulePlacement);
  if (accountPanel) {
    new ResizeObserver(schedulePlacement).observe(accountPanel);
    new MutationObserver(schedulePlacement).observe(accountPanel, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'style'],
    });
  }
  if (headerMain)
    new MutationObserver(schedulePlacement).observe(headerMain, {
      attributes: true,
      attributeFilter: ['data-page-title', 'class'],
    });
  new MutationObserver(schedulePlacement).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-font-preset', 'data-type-scale'],
  });
  new MutationObserver(schedulePlacement).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
  document.fonts?.ready.then(schedulePlacement);
  document.fonts?.addEventListener('loadingdone', schedulePlacement);
  placeTrigger();
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
  window.addEventListener('freebbs:session-change', () => {
    generation += 1;
    controller?.abort();
    list.replaceChildren();
    if (fullPage || host.open) search();
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
