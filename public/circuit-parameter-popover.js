(function circuitParameterPopover() {
  const main = document.querySelector('.circuit-main');
  const stage = document.getElementById('circuit-stage');
  if (!main || !stage) return;

  const panel = document.createElement('section');
  panel.id = 'circuit-parameter-popover';
  panel.className = 'circuit-parameter-popover';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'circuit-parameter-popover-title');
  panel.innerHTML = `
    <span class="circuit-parameter-popover-arrow" aria-hidden="true"></span>
    <header class="circuit-parameter-popover-heading">
      <div><p>元件参数</p><h3 id="circuit-parameter-popover-title"></h3></div>
      <button type="button" class="circuit-parameter-popover-close" aria-label="关闭元件参数">×</button>
    </header>
    <form class="circuit-parameter-popover-fields" aria-label="修改选中元件的参数" novalidate></form>
    <p id="circuit-parameter-popover-status" class="circuit-parameter-popover-status" role="status" aria-live="polite" hidden></p>
    <footer class="circuit-parameter-popover-footer">
      <span class="circuit-parameter-popover-access"></span>
      <button type="button" class="circuit-parameter-popover-sidebar">在侧栏查看</button>
    </footer>`;
  main.append(panel);

  const title = panel.querySelector('h3');
  const form = panel.querySelector('form');
  const access = panel.querySelector('.circuit-parameter-popover-access');
  const status = panel.querySelector('.circuit-parameter-popover-status');
  let componentId = '';
  let editable = false;
  let scheduled = 0;
  let observedAnchor = null;

  function anchor() {
    return [...stage.querySelectorAll('[data-component-id]')].find(
      (node) => node.dataset.componentId === componentId,
    );
  }

  function hide({ restoreFocus = false } = {}) {
    const target = anchor();
    panel.hidden = true;
    observedAnchor?.removeAttribute('aria-controls');
    observedAnchor?.removeAttribute('aria-expanded');
    observedAnchor = null;
    if (restoreFocus && target?.isConnected) target.focus({ preventScroll: true });
  }

  function viewportBounds() {
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const width = viewport?.width || document.documentElement.clientWidth;
    const height = viewport?.height || window.innerHeight;
    const bounds = {
      left: left + 10,
      top: top + 10,
      right: left + width - 10,
      bottom: top + height - 10,
    };
    const heading = window.getComputedStyle(main, '::before');
    if (
      heading.position === 'fixed' &&
      !['none', 'normal', '""', "''"].includes(heading.content) &&
      heading.display !== 'none' &&
      heading.visibility !== 'hidden'
    ) {
      let headingHeight = Number.parseFloat(heading.height) || 0;
      if (heading.boxSizing !== 'border-box')
        headingHeight += [
          'paddingTop',
          'paddingBottom',
          'borderTopWidth',
          'borderBottomWidth',
        ].reduce((sum, key) => sum + (Number.parseFloat(heading[key]) || 0), 0);
      bounds.top = Math.max(bounds.top, (Number.parseFloat(heading.top) || 0) + headingHeight + 10);
    }
    document.querySelectorAll('.topbar, .mobile-nav').forEach((navigation) => {
      const style = window.getComputedStyle(navigation);
      const rect = navigation.getBoundingClientRect();
      if (!['fixed', 'sticky'].includes(style.position) || !rect.width || !rect.height) return;
      if (rect.width > width / 2 && rect.top <= top + 20 && rect.bottom < top + height / 2)
        bounds.top = Math.max(bounds.top, rect.bottom + 10);
      else if (
        rect.width > width / 2 &&
        rect.bottom >= top + height - 20 &&
        rect.top > top + height / 2
      )
        bounds.bottom = Math.min(bounds.bottom, rect.top - 10);
      else if (rect.height > height / 2 && rect.left <= left + 20 && rect.right < left + width / 2)
        bounds.left = Math.max(bounds.left, rect.right + 10);
    });
    return bounds;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
  }

  function reposition() {
    if (panel.hidden) return;
    const target = anchor();
    if (!target || target.closest('[inert]')) return hide();
    const canvas = stage.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const bounds = viewportBounds();
    const visible = {
      left: Math.max(targetRect.left, canvas.left, bounds.left),
      top: Math.max(targetRect.top, canvas.top, bounds.top),
      right: Math.min(targetRect.right, canvas.right, bounds.right),
      bottom: Math.min(targetRect.bottom, canvas.bottom, bounds.bottom),
    };
    if (visible.right - visible.left < 4 || visible.bottom - visible.top < 4) return hide();
    if (observedAnchor !== target) {
      observedAnchor?.removeAttribute('aria-controls');
      observedAnchor?.removeAttribute('aria-expanded');
      observedAnchor = target;
      target.setAttribute('aria-controls', panel.id);
      target.setAttribute('aria-expanded', 'true');
    }
    const width = Math.min(288, bounds.right - bounds.left);
    const maxHeight = Math.min(480, bounds.bottom - bounds.top);
    if (width < 160 || maxHeight < 120) return hide();
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${maxHeight}px`;
    const desiredHeight = panel.getBoundingClientRect().height;
    const gap = 13;
    const centerX = (visible.left + visible.right) / 2;
    const centerY = (visible.top + visible.bottom) / 2;
    const below = bounds.bottom - visible.bottom - gap;
    const above = visible.top - bounds.top - gap;
    let side;
    let left;
    let top;
    if (bounds.right - visible.right >= width + gap) {
      side = 'right';
      left = visible.right + gap;
      top = clamp(centerY - desiredHeight / 2, bounds.top, bounds.bottom - desiredHeight);
    } else if (visible.left - bounds.left >= width + gap) {
      side = 'left';
      left = visible.left - gap - width;
      top = clamp(centerY - desiredHeight / 2, bounds.top, bounds.bottom - desiredHeight);
    } else {
      side = below >= Math.min(desiredHeight, 220) || below >= above ? 'bottom' : 'top';
      const available = side === 'bottom' ? below : above;
      const height = Math.min(desiredHeight, Math.max(120, available));
      panel.style.maxHeight = `${height}px`;
      left = clamp(centerX - width / 2, bounds.left, bounds.right - width);
      top = side === 'bottom' ? visible.bottom + gap : visible.top - gap - height;
      top = clamp(top, bounds.top, bounds.bottom - height);
    }
    panel.dataset.side = side;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    const size = panel.getBoundingClientRect();
    panel.style.setProperty('--popover-arrow-x', `${clamp(centerX - left, 20, width - 20)}px`);
    panel.style.setProperty('--popover-arrow-y', `${clamp(centerY - top, 20, size.height - 20)}px`);
  }

  function schedulePosition() {
    if (panel.hidden || scheduled) return;
    scheduled = window.requestAnimationFrame(() => {
      scheduled = 0;
      reposition();
    });
  }

  function fieldsSignature(container) {
    return JSON.stringify(
      [...container.querySelectorAll('[data-parameter]')].map((input) => [
        input.dataset.parameter,
        input.tagName,
        input.type,
        [...(input.options || [])].map((option) => [option.value, option.textContent]),
      ]),
    );
  }

  function renderFields(html, preserveFocus) {
    const template = document.createElement('div');
    template.innerHTML = html || '<p class="circuit-parameter-hint">此元件没有可调整的参数。</p>';
    const active = form.contains(document.activeElement) ? document.activeElement : null;
    const oldInputs = [...form.querySelectorAll('[data-parameter]')];
    if (
      fieldsSignature(form) === fieldsSignature(template) &&
      form.childElementCount === template.childElementCount
    ) {
      const incoming = [...template.querySelectorAll('[data-parameter]')];
      oldInputs.forEach((field, index) => {
        const input = field;
        const replacement = incoming[index];
        if (input !== active && input.validity.valid) input.value = replacement.value;
        input.disabled = replacement.disabled;
        input.readOnly = replacement.readOnly;
        const oldLabel = input.closest('label');
        const newLabel = replacement.closest('label');
        if (oldLabel?.firstChild?.nodeType === Node.TEXT_NODE && newLabel)
          oldLabel.firstChild.textContent = newLabel.firstChild.textContent;
      });
      const hints = [...template.querySelectorAll('.circuit-parameter-hint')];
      form.querySelectorAll('.circuit-parameter-hint').forEach((paragraph, index) => {
        const hint = paragraph;
        hint.textContent = hints[index]?.textContent || '';
      });
    } else {
      let selection = null;
      if (active && ['text', 'search', 'url', 'tel', 'password'].includes(active.type))
        selection = [active.selectionStart, active.selectionEnd];
      const focusKey = preserveFocus && active?.dataset.parameter;
      form.innerHTML = template.innerHTML;
      form.querySelectorAll('[data-parameter]').forEach((field) => {
        const input = field;
        const previous = oldInputs.find(
          (old) => old.dataset.parameter === input.dataset.parameter && old.type === input.type,
        );
        if (previous && (previous === active || !previous.validity.valid)) {
          input.value = previous.value;
          if (previous.validity.customError) input.setCustomValidity(previous.validationMessage);
        }
        if (focusKey === input.dataset.parameter) {
          input.focus({ preventScroll: true });
          if (selection) input.setSelectionRange(...selection);
        }
      });
    }
    form.querySelectorAll('[data-parameter]').forEach((field) => {
      const input = field;
      if (input.tagName === 'SELECT') input.disabled = !editable;
      else input.readOnly = !editable;
    });
  }

  function update(data, { preserveFocus = true } = {}) {
    if (panel.hidden) return;
    if (!data || data.componentId !== componentId) return hide();
    title.textContent = data.title || componentId;
    editable = Boolean(data.editable);
    access.textContent = editable ? '修改即保存到草稿' : '只读';
    renderFields(data.html, preserveFocus);
    updateValidity();
    reposition();
  }

  function updateValidity() {
    let invalid = null;
    form.querySelectorAll('[data-parameter]').forEach((input) => {
      if (!input.validity.valid) {
        invalid ||= input;
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', status.id);
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
    });
    status.textContent = invalid?.validationMessage || '';
    status.hidden = !invalid;
    return !invalid;
  }

  function reportValidity() {
    if (panel.hidden) return true;
    const valid = updateValidity();
    if (!valid) form.reportValidity();
    return valid;
  }

  function show(data, { focus = false } = {}) {
    if (!data?.componentId) return hide();
    if (panel.hidden || componentId !== data.componentId) {
      hide();
      componentId = data.componentId;
      form.replaceChildren();
    }
    panel.hidden = false;
    update(data);
    if (focus && !panel.hidden)
      (
        form.querySelector('[data-parameter]:not(:disabled)') || panel.querySelector('button')
      ).focus({ preventScroll: true });
  }

  function emitParameter(event) {
    const input = event.target;
    if (!editable || !input.matches('[data-parameter]')) return;
    if (input.tagName === 'SELECT' && event.type !== 'change') return;
    if (input.tagName !== 'SELECT' && event.type !== 'input') return;
    window.dispatchEvent(
      new CustomEvent('freebbs:circuit-parameter-input', {
        detail: { componentId, key: input.dataset.parameter, value: input.value, input },
      }),
    );
    updateValidity();
    schedulePosition();
  }

  form.addEventListener('input', emitParameter);
  form.addEventListener('change', emitParameter);
  form.addEventListener('submit', (event) => event.preventDefault());
  panel
    .querySelector('.circuit-parameter-popover-close')
    .addEventListener('click', () => hide({ restoreFocus: true }));
  panel.querySelector('.circuit-parameter-popover-sidebar').addEventListener('click', () => {
    hide();
    window.dispatchEvent(
      new CustomEvent('freebbs:circuit-sidebar-request', { detail: { tab: 'parameters' } }),
    );
  });
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!panel.hidden && !panel.contains(event.target)) hide();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || panel.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      hide({ restoreFocus: true });
    },
    true,
  );
  window.addEventListener('freebbs:circuit-sidebar-change', (event) => {
    if (event.detail?.modal || (event.detail?.open && event.detail?.tab === 'parameters')) hide();
  });
  window.addEventListener('resize', schedulePosition);
  document.addEventListener('scroll', schedulePosition, true);
  window.visualViewport?.addEventListener('resize', schedulePosition);
  window.visualViewport?.addEventListener('scroll', schedulePosition);
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(schedulePosition);
    observer.observe(stage);
    observer.observe(panel);
  }

  window.FreeBbsCircuitParameterPopover = { show, update, hide, reposition, reportValidity };
})();
