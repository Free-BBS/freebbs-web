(() => {
  if (!document.body.classList.contains('aichat-page')) return;
  const panel = document.querySelector('.aichat-main');
  const controls = panel?.querySelector('.aichat-options, [data-max-model-picker]');
  if (!controls) return;
  const details = document.createElement('details');
  details.className = 'max-composer-tools';
  const summary = document.createElement('summary');
  const heading = document.createElement('span');
  heading.textContent = '对话选项';
  const state = document.createElement('span');
  state.className = 'max-composer-tools-state';
  const hint = document.createElement('span');
  hint.className = 'max-composer-tools-hint';
  hint.textContent = '展开';
  summary.append(heading, state, hint);
  controls.before(details);
  details.append(summary, controls);
  const update = () => {
    const model = controls.querySelector('[data-max-model]');
    const effort = controls.querySelector('[data-max-effort]');
    state.textContent = [
      model?.selectedOptions[0]?.textContent || '模型与图片',
      effort?.selectedOptions[0]?.textContent,
    ]
      .filter(Boolean)
      .join(' · ');
    state.title = state.textContent;
  };
  details.addEventListener('toggle', () => {
    hint.textContent = details.open ? '收起' : '展开';
  });
  controls.addEventListener('change', update);
  window.addEventListener('freebbs:max-model-change', update);
  // Observe controls only: summary updates must not trigger the observer itself.
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
