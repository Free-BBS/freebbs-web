(() => {
  const settings = location.pathname === '/settings';
  if (!settings && location.pathname !== '/workbench') return;
  document.body.classList.add(settings ? 'personal-settings-page' : 'personal-workbench-page');
  const media = matchMedia('(max-width: 900px)');
  const moved = [];
  function fold(node, title, icon = 'gear') {
    if (!node) return;
    const placeholder = document.createComment('desktop-position');
    node.before(placeholder);
    const details = document.createElement('details');
    details.className = 'personal-fold';
    const summary = document.createElement('summary');
    const glyph = document.createElement('img');
    glyph.src = `/assets/icons/${icon}.svg`;
    glyph.alt = '';
    summary.append(glyph, document.createTextNode(title));
    details.append(summary, node);
    placeholder.after(details);
    moved.push(() => {
      placeholder.replaceWith(node);
      details.remove();
    });
  }
  let overview;
  if (settings && !document.getElementById('settings-profile-link')) {
    overview = document.createElement('section');
    overview.className = 'personal-overview';
    overview.setAttribute('aria-label', '我的资料');
    overview.innerHTML = `<div class="personal-identity"><a class="avatar personal-avatar" aria-label="我的主页"><img alt="我的头像"></a><div><h2></h2><a class="personal-profile-link">我的主页 ›</a></div></div><p class="personal-bio"></p><div class="personal-balances"><span><strong data-balance="electrons"></strong>电元</span><span><strong data-balance="manetrons"></strong>磁元</span><span><strong data-balance="heat"></strong>热力</span><button type="button">编辑资料</button></div>`;
    document.querySelector('.settings-profile').before(overview);
    overview.querySelector('button').addEventListener('click', () => {
      const details = document.getElementById('settings-form').closest('details');
      if (details) {
        details.open = true;
        details.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    function renderOverview() {
      const state = window.freeBbsApp?.userState || {};
      overview.querySelector('h2').textContent = state.username || '未登录';
      overview.querySelector('.personal-bio').textContent = state.bio || '记录学习，分享发现。';
      overview.querySelector('img').src = document.getElementById('settings-avatar-image').src;
      overview.querySelector('.personal-avatar').dataset.avatarFrame = [
        'frame_orbit',
        'frame_aurora',
      ].includes(state.cosmetics?.frame)
        ? state.cosmetics.frame
        : '';
      for (const a of overview.querySelectorAll('a'))
        a.href = state.uid ? `/profile?uid=${encodeURIComponent(state.uid)}` : '/login';
      for (const count of overview.querySelectorAll('[data-balance]'))
        count.textContent = state[count.dataset.balance] ?? 0;
    }
    const panel = document.querySelector('.user-panel');
    if (panel)
      new MutationObserver(renderOverview).observe(panel, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    Promise.resolve(window.freeBbsApp?.sessionReady).then(renderOverview);
    window.addEventListener('freebbs:session-change', renderOverview);
  }
  function arrange() {
    while (moved.length) moved.pop()();
    if (!media.matches) return;
    if (settings) {
      fold(document.getElementById('settings-form'), '编辑资料', 'compose');
      fold(document.getElementById('settings-username-form'), '修改昵称', 'username');
      fold(document.querySelector('.settings-typography-form'), '阅读样式', 'subject');
      fold(document.getElementById('settings-notification-form'), '邮件通知', 'mail');
      fold(document.getElementById('settings-password-form'), '修改密码', 'key');
      fold(document.querySelector('.course-token-settings'), '课程组 Agent 接入', 'ai');
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
    fold(document.querySelector('.workbench-agent-card'), '让 Max 帮我安排日程', 'ai');
    fold(document.querySelector('.workbench-campus-card'), '清华账号连接', 'id');
    fold(document.querySelector('.workbench-campus-courses-card'), '校内课程与公告', 'subject');
    fold(document.querySelector('.workbench-source-card'), '连接状态与诊断');
    fold(document.querySelector('.workbench-quick-section'), '快捷入口', 'map');
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
