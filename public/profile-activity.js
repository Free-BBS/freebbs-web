(() => {
  function render(activity) {
    const host = document.getElementById('public-profile-activity');
    if (!host) return;
    if (!activity || !/^\d{4}-\d{2}-\d{2}$/.test(activity.end || '')) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const days = new Map((activity.days || []).map((item) => [item.date, item]));
    const end = new Date(`${activity.end}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 364);
    const offset = (start.getUTCDay() + 6) % 7;
    const total = [...days.values()].reduce((sum, day) => sum + Number(day.count || 0), 0);
    host.innerHTML =
      '<div class="profile-activity-heading"><h3>站内足迹</h3><span></span></div><div class="profile-heat-scroll" tabindex="0" aria-label="近一年活跃度日历，可横向滚动"><div class="profile-heat-months"></div><div class="profile-heatmap" role="group" aria-label="每日活跃度"></div></div><p class="profile-activity-detail" aria-live="polite">点击日期查看详情</p><div class="profile-activity-legend"><small>签到、公开发帖与评论 · 北京时间</small><span>少 <i data-level="0"></i><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i> 多</span></div>';
    host.querySelector('.profile-activity-heading span').textContent = `近一年 ${total} 次活动`;
    const caption = host.querySelector('.profile-activity-legend small');
    caption.textContent =
      activity.visibility === 'members'
        ? '签到、可见发帖与实名评论 · 北京时间'
        : '签到、游客可见发帖与实名评论 · 北京时间';
    caption.title =
      '不含匿名发帖、隐藏或已删除内容；登录后计入登录可见讨论。评论按评论者身份统计，不受原帖匿名与否影响。';
    const grid = host.querySelector('.profile-heatmap');
    const labels = host.querySelector('.profile-heat-months');
    const columns = Math.ceil((365 + offset) / 7);
    host.style.setProperty('--heat-columns', columns);
    for (let index = 0; index < offset; index += 1) grid.append(document.createElement('span'));
    let previousMonth = -1;
    for (let index = 0; index < 365; index += 1) {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      const value = days.get(key) || {};
      const count = Number(value.count || 0);
      const month = date.getUTCMonth();
      if (month !== previousMonth) {
        if (index > 0 || date.getUTCDate() <= 21) {
          const label = document.createElement('span');
          label.textContent = `${month + 1}月`;
          label.style.gridColumn = String(Math.floor((index + offset) / 7) + 1);
          labels.append(label);
        }
        previousMonth = month;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.level =
        count === 0 ? '0' : count < 3 ? '1' : count < 6 ? '2' : count < 10 ? '3' : '4';
      const detail = `${key} · ${count} 次活动（签到 ${Number(value.checkins || 0)}、发帖 ${Number(value.posts || 0)}、评论 ${Number(value.comments || 0)}）`;
      button.title = detail;
      button.setAttribute('aria-label', detail);
      // A single tab stop; arrows navigate days without 365 Tab presses.
      button.tabIndex = index === 364 ? 0 : -1;
      const show = () => {
        host.querySelector('.profile-activity-detail').textContent = detail;
      };
      button.addEventListener('focus', show);
      button.addEventListener('click', () => {
        grid.querySelectorAll('button').forEach((cell) => {
          cell.tabIndex = -1;
        });
        button.tabIndex = 0;
        show();
      });
      grid.append(button);
    }
    grid.addEventListener('keydown', (event) => {
      const shift = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
      if (!shift) return;
      const cells = [...grid.querySelectorAll('button')];
      const next = cells[cells.indexOf(event.target) + shift];
      if (!next) return;
      event.preventDefault();
      event.target.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    });
    requestAnimationFrame(() => {
      const scroll = host.querySelector('.profile-heat-scroll');
      scroll.scrollLeft = scroll.scrollWidth;
    });
  }
  window.FreeBbsProfileActivity = { render };
})();
