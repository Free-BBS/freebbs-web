(() => {
  const settings = location.pathname === '/settings';
  if (!settings && location.pathname !== '/workbench') return;
  document.body.classList.add(settings ? 'personal-settings-page' : 'personal-workbench-page');
  const media = matchMedia('(max-width: 900px)');
  const moved = [];
  function fold(node, title) {
    if (!node) return;
    const placeholder = document.createComment('desktop-position');
    node.before(placeholder);
    const details = document.createElement('details');
    details.className = 'personal-fold';
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.append(summary, node);
    placeholder.after(details);
    moved.push(() => {
      placeholder.replaceWith(node);
      details.remove();
    });
  }
  function arrange() {
    while (moved.length) moved.pop()();
    if (!media.matches) return;
    if (settings) {
      fold(document.getElementById('settings-username-form'), '修改昵称');
      fold(document.getElementById('settings-typography-form'), '阅读样式');
      fold(document.getElementById('settings-password-form'), '修改密码');
      return;
    }
    const priority = document.querySelector('.workbench-priority-card');
    const schedule = document.querySelector('.workbench-schedule-card');
    if (priority && schedule) {
      const placeholder = document.createComment('priority-position');
      priority.before(placeholder);
      schedule.after(priority);
      moved.push(() => placeholder.replaceWith(priority));
    }
    fold(document.querySelector('.workbench-agent-card'), '让 Max 帮我安排日程');
    fold(document.querySelector('.workbench-campus-card'), '清华账号连接');
    fold(document.querySelector('.workbench-campus-courses-card'), '校内课程与公告');
    fold(document.querySelector('.workbench-source-card'), '连接状态与诊断');
    fold(document.querySelector('.workbench-quick-section'), '快捷入口');
  }
  media.addEventListener('change', arrange);
  arrange();
  if (!settings && media.matches) {
    const toggle = document.getElementById('workbench-view-toggle');
    if (toggle?.getAttribute('aria-pressed') === 'false') toggle.click();
  }
  document.addEventListener(
    'invalid',
    (event) => {
      const details = event.target.closest('.personal-fold');
      if (details) details.open = true;
    },
    true,
  );
})();
