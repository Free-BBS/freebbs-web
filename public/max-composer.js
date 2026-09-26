(() => {
  if (!document.body.classList.contains('aichat-page')) return;
  const panel = document.querySelector('.aichat-main');
  const controls = panel?.querySelector('.aichat-options, [data-max-model-picker]');
  if (!controls) return;
  const form = document.getElementById('aichat-form');
  const icon = (paths) =>
    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const plus = icon('<path d="M12 4v16M4 12h16"/>');
  const brain = icon(
    '<path d="M12 18V5a3 3 0 0 0-5.8-1 4 4 0 0 0-3.1 6.3 4 4 0 0 0 .8 7.3A4 4 0 0 0 12 18Zm0-13a3 3 0 0 1 5.8-1 4 4 0 0 1 3.1 6.3 4 4 0 0 1-.8 7.3A4 4 0 0 1 12 18M8 8c-2 0-3-1-3-2m11 2c2 0 3-1 3-2M7 13c2 0 3 1 3 3m7-3c-2 0-3 1-3 3"/>',
  );
  function menu(name, label, svg) {
    const details = document.createElement('details');
    details.className = `max-composer-menu ${name}`;
    const summary = document.createElement('summary');
    summary.setAttribute('aria-label', label);
    summary.title = label;
    summary.innerHTML = svg;
    const body = document.createElement('div');
    body.className = 'max-composer-popover';
    body.setAttribute('aria-label', label);
    details.append(summary, body);
    form.append(details);
    details.addEventListener('toggle', () => {
      summary.setAttribute('aria-expanded', String(details.open));
      if (details.open)
        form.querySelectorAll('.max-composer-menu').forEach((other) => {
          if (other !== details) other.open = false;
        });
    });
    return { details, summary, body };
  }
  const models = menu('max-composer-tools', '模型与思考设置', brain);
  models.body.append(controls);
  const attachments = menu('max-composer-add', '模式与附件', plus);
  const mode = document.getElementById('max-create-mode');
  if (mode) {
    mode.hidden = true;
    attachments.body.append(mode);
    const group = document.createElement('div');
    group.className = 'max-creation-choices';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '回答方式');
    const syncMode = () => {
      group.querySelectorAll('button').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.mode === mode.value));
        button.disabled = mode.disabled;
      });
      attachments.summary.title = `模式与附件 · ${mode.selectedOptions[0].textContent}`;
      attachments.summary.setAttribute('aria-label', attachments.summary.title);
    };
    Array.from(mode.options).forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.mode = option.value;
      button.textContent = option.textContent;
      button.addEventListener('click', () => {
        mode.value = option.value;
        mode.dispatchEvent(new Event('change', { bubbles: true }));
        attachments.details.open = false;
        document.getElementById('aichat-input')?.focus();
      });
      group.append(button);
    });
    attachments.body.append(group);
    mode.addEventListener('change', syncMode);
    new MutationObserver(syncMode).observe(mode, {
      attributes: true,
      attributeFilter: ['disabled'],
    });
    syncMode();
  }
  const fileButton = document.querySelector('[data-file-add]');
  const imageButton = document.querySelector('[data-image-add]');
  const camera = document.createElement('input');
  camera.type = 'file';
  camera.accept = 'image/*';
  camera.setAttribute('capture', 'environment');
  camera.hidden = true;
  camera.dataset.cameraInput = '';
  form.append(camera);
  camera.addEventListener('change', () => {
    if (!imageButton.disabled) window.FreeBbsMaxImages?.select(Array.from(camera.files || []));
    camera.value = '';
  });
  const choices = [
    ['文件', '<path d="M3 7V5h6l2 2h10v13H3Z"/>', fileButton, () => fileButton.click()],
    [
      '拍照',
      '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>',
      imageButton,
      () => camera.click(),
    ],
    [
      '照片',
      '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
      imageButton,
      () => imageButton.click(),
    ],
  ];
  const attachmentActions = document.createElement('div');
  attachmentActions.className = 'max-attachment-choices';
  attachments.body.append(attachmentActions);
  choices.forEach(([label, paths, original, action]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `${icon(paths)}<span>${label}</span>`;
    const sync = () => {
      button.disabled = !original || original.disabled;
    };
    if (original)
      new MutationObserver(sync).observe(original, {
        attributes: true,
        attributeFilter: ['disabled'],
      });
    sync();
    button.addEventListener('click', () => {
      action();
      attachments.details.open = false;
      attachments.summary.focus();
    });
    attachmentActions.append(button);
  });
  document.addEventListener('pointerdown', (event) => {
    // The modal tour owns its controls while illustrating this open menu.
    if (event.target.closest?.('dialog.max-tour[open]')) return;
    form.querySelectorAll('.max-composer-menu').forEach((details) => {
      if (!details.contains(event.target)) details.open = false;
    });
  });
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const opened = form.querySelector('.max-composer-menu[open]');
    if (opened) {
      opened.open = false;
      opened.querySelector('summary').focus();
      event.preventDefault();
    }
  });
  const update = () => {
    const selected = controls.querySelector('[data-max-model]')?.selectedOptions[0]?.textContent;
    models.summary.title = selected ? `模型与思考设置 · ${selected}` : '模型与思考设置';
  };
  controls.addEventListener('change', update);
  window.addEventListener('freebbs:max-model-change', update);
  new MutationObserver(update).observe(controls, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  update();
})();

// Safari keeps the layout viewport tall while the keyboard shrinks the visible viewport.
(() => {
  if (!document.body.classList.contains('aichat-page')) return;
  const input = document.getElementById('aichat-input');
  const form = document.getElementById('aichat-form');
  const viewport = window.visualViewport;
  const mobile = window.matchMedia('(max-width: 900px)');
  if (!input || !form) return;
  let frame;
  let active = false;
  function update() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const focused = document.activeElement;
      const next = mobile.matches && (focused === input || (active && form.contains(focused)));
      if (next && !active) {
        const options = document.querySelector('.max-composer-tools');
        if (options) options.open = false;
      }
      active = next;
      document.body.classList.toggle('max-input-active', active);
      document.documentElement.style.setProperty(
        '--max-visible-height',
        `${viewport?.height || window.innerHeight}px`,
      );
      document.documentElement.style.setProperty(
        '--max-visible-top',
        `${viewport?.offsetTop || 0}px`,
      );
    });
  }
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', update);
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  mobile.addEventListener('change', update);
  update();
})();
