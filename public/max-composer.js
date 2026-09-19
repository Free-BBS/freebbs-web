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
    const count = panel.querySelector('[data-image-previews]')?.children.length || 0;
    const fileCount = panel.querySelectorAll('.max-file-chip').length;
    state.textContent = [
      model?.selectedOptions[0]?.textContent || '模型与图片',
      effort?.selectedOptions[0]?.textContent,
      count ? `已附加 ${count} 张图片` : '',
      fileCount ? `已附加 ${fileCount} 个文件` : '',
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
  const attachments = panel.querySelector('#aichat-attachments');
  if (attachments)
    new MutationObserver(update).observe(attachments, { childList: true, subtree: true });
  update();
})();
