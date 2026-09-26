(() => {
  const challenge = Boolean(document.querySelector('[data-circuit-challenge-page]'));
  if (!challenge && window.location.pathname.replace(/\/$/, '') !== '/circuit') return;
  const root = document.querySelector(challenge ? '.challenge-main' : '.circuit-main');
  if (!root) return;
  const prefix = challenge ? 'challenge' : 'circuit';
  const byId = (id) => document.getElementById(`${prefix}-${id}`);
  const media = window.matchMedia('(max-width: 900px)');
  const placements = new Map();
  let sheetNodes = [];
  let opener;
  let activePanel = '';

  const header = document.createElement('div');
  header.className = 'circuit-mobile-heading';
  const dock = document.createElement('nav');
  dock.className = 'circuit-mobile-dock';
  dock.setAttribute('aria-label', '电路常用操作');
  const dialog = document.createElement('dialog');
  dialog.className = 'circuit-mobile-sheet';
  dialog.setAttribute('aria-labelledby', 'circuit-mobile-sheet-title');
  dialog.innerHTML = `<header><h2 id="circuit-mobile-sheet-title"></h2><button type="button" data-mobile-close aria-label="返回画布">完成</button></header><div class="${challenge ? 'challenge-main' : 'circuit-main'} circuit-mobile-sheet-content"></div>`;
  document.body.append(dialog);
  const content = dialog.querySelector('.circuit-mobile-sheet-content');
  const feedback = document.createElement('div');
  feedback.className = 'circuit-mobile-feedback';
  root.append(header, feedback, dock);
  const zoomShortcut = button('100% · 缩放', () => {
    const zoom = Number.parseInt(byId('zoom-value')?.textContent, 10) || 100;
    if (zoom >= 195) byId('zoom-reset')?.click();
    else {
      byId('zoom-in')?.click();
      byId('zoom-in')?.click();
    }
  });
  zoomShortcut.className = 'circuit-mobile-zoom';
  zoomShortcut.setAttribute('aria-label', '切换画布缩放，也可双指缩放和平移');
  root.append(zoomShortcut);
  if (byId('zoom-value'))
    new MutationObserver(() => {
      zoomShortcut.textContent = `${byId('zoom-value').textContent} · 缩放`;
    }).observe(byId('zoom-value'), { childList: true, subtree: true });

  function move(node, target) {
    if (!node) return;
    if (!placements.has(node)) {
      const anchor = document.createComment('mobile control position');
      node.before(anchor);
      placements.set(node, anchor);
    }
    target.append(node);
  }
  function restore(node) {
    const anchor = placements.get(node);
    if (!anchor) return;
    anchor.replaceWith(node);
    placements.delete(node);
  }
  function close() {
    if (!dialog.open) return;
    dialog.close();
    sheetNodes.forEach(restore);
    sheetNodes = [];
    activePanel = '';
    content.replaceChildren();
    opener?.focus?.({ preventScroll: true });
  }
  function button(text, handler) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    node.addEventListener('click', handler);
    return node;
  }
  const query = (selector) => root.querySelector(selector);
  function show(panel) {
    if (!media.matches) return;
    close();
    opener = document.activeElement;
    activePanel = panel;
    let nodes;
    const titles = {
      levels: '我的闯关进度',
      ranking: '闯关榜单',
      parts: '添加元件',
      parameters: '元件参数',
      waves: '波形',
      more: '工具与设置',
    };
    if (challenge) {
      nodes = {
        levels: [byId('progress'), query('.challenge-levels')],
        ranking: [query('.challenge-ranking')],
        parts: [query('.challenge-palette')],
        parameters: [query('.challenge-inspector')],
        waves: [query('.challenge-brief'), query('.challenge-waveboard')],
        more: [
          query('.challenge-viewport'),
          query('.challenge-canvas-actions'),
          byId('reset'),
          query('.challenge-header-actions'),
          byId('admin-form'),
          byId('admin-save'),
          byId('admin-cancel'),
        ],
      }[panel];
    } else {
      nodes = {
        waves: [byId('results')],
        more: [
          query('.circuit-viewport-controls'),
          query('.circuit-shortcut-actions'),
          query('.circuit-analysis'),
          query('.circuit-palette'),
          query('.circuit-editor-actions'),
          query('.circuit-document-heading'),
          query('.circuit-workbench-actions'),
          query('.circuit-sharing'),
        ],
      }[panel];
      if (panel === 'more') {
        const parameters = button('元件参数', () => {
          close();
          window.FreeBbsCircuitSidebar?.open('parameters');
        });
        content.append(parameters);
      }
    }
    dialog.querySelector('h2').textContent = titles[panel] || '工具';
    sheetNodes = (nodes || []).filter(Boolean);
    const groups = {
      'circuit-analysis': '仿真设置',
      'circuit-palette': '示例电路',
      'circuit-editor-actions': '电路操作与 Max',
      'circuit-document-heading': '名称与说明',
      'circuit-workbench-actions': '版本与报告',
      'circuit-sharing': '分享与导入导出',
    };
    sheetNodes.forEach((node) => {
      const label =
        panel === 'more' && Object.keys(groups).find((key) => node.classList.contains(key));
      if (!label) {
        move(node, content);
        return;
      }
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = groups[label];
      details.append(summary);
      content.append(details);
      move(node, details);
    });
    if (panel === 'waves' && !challenge && byId('results')?.hidden) {
      const message = document.createElement('p');
      message.textContent = '运行仿真后，这里显示波形与读数。';
      content.append(message);
    }
    dialog.showModal();
    // Canvas waveforms measure their visible container before drawing.
    window.dispatchEvent(new Event('resize'));
  }
  dialog.querySelector('[data-mobile-close]').addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (
      event.target.closest('[data-add]') ||
      event.target.closest('[data-challenge-id]:not(:disabled)')
    )
      close();
    if (event.target.closest('#circuit-ai-toggle,#circuit-load-example')) close();
  });

  function arrange() {
    if (!media.matches) {
      close();
      [...placements.keys()].reverse().forEach(restore);
      document.body.classList.remove('has-circuit-mobile-workspace');
      header.replaceChildren();
      dock.replaceChildren();
      return;
    }
    if (document.body.classList.contains('has-circuit-mobile-workspace')) return;
    document.body.classList.add('has-circuit-mobile-workspace');
    if (challenge) {
      const levels = button('关卡', () => show('levels'));
      levels.id = 'circuit-mobile-levels';
      header.append(levels);
      const title = document.createElement('span');
      title.id = 'circuit-mobile-title';
      header.append(
        title,
        button('总榜', () => show('ranking')),
      );
      dock.append(button('元件', () => show('parts')));
      move(byId('undo'), dock);
      move(byId('run'), dock);
      dock.append(
        button('波形', () => show('waves')),
        button('更多', () => show('more')),
      );
      move(query('.challenge-runbar'), feedback);
      move(byId('global-status'), feedback);
      move(byId('cancel-wire'), header);
    } else {
      const back = document.createElement('a');
      back.href = '/circuits';
      back.textContent = '实验室';
      const name = document.createElement('span');
      name.textContent = '电路工作台';
      header.append(back, name);
      move(byId('save'), header);
      move(byId('component-add'), dock);
      move(byId('component-menu'), root);
      move(byId('undo'), dock);
      move(byId('run'), dock);
      dock.append(
        button('波形', () => show('waves')),
        button('更多', () => show('more')),
      );
      move(byId('run-status'), feedback);
      move(byId('status'), feedback);
      move(byId('stop'), feedback);
      move(byId('cancel-wire'), header);
    }
    syncTitle();
  }
  function syncTitle() {
    if (!challenge || !media.matches) return;
    const title = document.getElementById('circuit-mobile-title');
    if (title) title.textContent = byId('title')?.textContent || '电路闯关';
    const levels = document.getElementById('circuit-mobile-levels');
    if (levels) levels.textContent = `关卡 ${byId('level-count')?.textContent || ''}`;
  }
  if (challenge)
    new MutationObserver(syncTitle).observe(byId('level-count'), {
      childList: true,
      subtree: true,
    });
  media.addEventListener('change', arrange);
  window.FreeBbsCircuitMobile = {
    show,
    close,
    get activePanel() {
      return activePanel;
    },
  };
  arrange();
})();
