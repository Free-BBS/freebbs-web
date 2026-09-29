(() => {
  const app = window.freeBbsApp;
  const form = document.getElementById('workbench-preferences-form');
  if (!app || !form) return;
  const byId = (name) => document.getElementById(`workbench-${name}`);
  const fields = byId('preferences-fields');
  const status = byId('preferences-status');
  const restList = byId('rest-windows');
  const gaps = byId('planning-gaps');
  const gapStatus = byId('planning-gaps-status');
  const gapList = byId('planning-gap-list');
  const companion = byId('companion');
  const bubble = byId('companion-bubble');
  function toggleBubble(open) {
    bubble.hidden = !open;
    byId('companion-avatar').setAttribute('aria-expanded', String(open));
  }
  byId('companion-avatar').addEventListener('click', () => toggleBubble(bubble.hidden));
  byId('companion-collapse').addEventListener('click', () => toggleBubble(false));
  byId('companion-plan').addEventListener('click', () => {
    byId('plan-tab')?.click();
    const fold = byId('max-planner').closest('details');
    if (fold) fold.open = true;
    toggleBubble(false);
    window.requestAnimationFrame(() =>
      byId('max-planner').scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
  });
  const defaults = {
    enabled: true,
    dayStart: '09:00',
    dayEnd: '21:00',
    focusMinutes: 60,
    breakMinutes: 15,
    dailyMaxMinutes: 120,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    restWindows: [
      { start: '12:00', end: '13:00' },
      { start: '18:00', end: '19:00' },
    ],
  };
  const ownerKey = () =>
    app.userState?.isLoggedIn ? String(app.userState.uid || app.userState.username || '') : '';
  const session = () => `${ownerKey()}:${app.userState?.token || ''}`;
  let activeSession = null;
  let savedPreferences = null;
  let dirty = false;
  let gapRequest = 0;
  let tipRequest = 0;
  let tipIndex = new Date().getDate();
  let tipEvents = [];
  let tipReady = false;
  let busy = false;
  let tipsHidden = false;
  const hiddenKey = () => `freebbs:workbench:max-tips:${ownerKey() || 'guest'}`;
  function renderTip() {
    companion.hidden = tipsHidden;
    byId('companion-show').hidden = !tipsHidden;
    const tip = window.FreeBbsWorkbenchCompanion.selectTip(
      tipEvents,
      new Date(),
      tipIndex,
      tipReady,
    );
    byId('companion-tip').textContent = tip.text;
    companion.dataset.tip = tip.kind;
  }
  function showTips(hidden) {
    tipsHidden = hidden;
    if (!hidden) toggleBubble(true);
    try {
      localStorage.setItem(hiddenKey(), hidden ? 'hidden' : 'shown');
    } catch {
      /* Optional device preference. */
    }
    renderTip();
    if (!hidden) refreshTip();
  }
  byId('companion-hide').addEventListener('click', () => showTips(true));
  byId('companion-show').addEventListener('click', () => showTips(false));
  byId('companion-next').addEventListener('click', () => {
    tipIndex += 1;
    renderTip();
  });
  async function refreshTip() {
    const owner = session();
    tipRequest += 1;
    const request = tipRequest;
    if (!ownerKey() || tipsHidden) return;
    const now = Date.now();
    const start = Math.floor((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
    try {
      const result = await app.callApi(
        `/workbench/schedule-items?${new URLSearchParams({ from: new Date(start).toISOString(), to: new Date(start + 2 * 86400000).toISOString() })}`,
        { method: 'GET' },
      );
      if (owner !== session() || request !== tipRequest) return;
      tipEvents = result.scheduleItems || [];
      tipReady = true;
    } catch {
      if (owner !== session() || request !== tipRequest) return;
      tipEvents = [];
      tipReady = false;
    }
    renderTip();
  }
  function markDirty() {
    dirty = true;
    status.textContent = '修改尚未保存；保存后，下一次空档规划会使用新偏好。';
    gapRequest += 1;
    gaps.hidden = true;
  }
  function addRest(value = { start: '12:00', end: '13:00' }) {
    if (restList.children.length >= 4) return;
    const row = document.createElement('div');
    row.className = 'workbench-rest-row';
    for (const [key, label] of [
      ['start', '开始'],
      ['end', '结束'],
    ]) {
      const wrapper = document.createElement('label');
      wrapper.textContent = label;
      const input = document.createElement('input');
      input.type = key === 'end' ? 'text' : 'time';
      if (key === 'end') {
        input.placeholder = '13:00（可填 24:00）';
        input.pattern = '([01][0-9]|2[0-3]):[0-5][0-9]|24:00';
      }
      input.required = true;
      input.dataset.restTime = key;
      input.value = value[key];
      wrapper.append(input);
      row.append(wrapper);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'workbench-compact-action';
    remove.textContent = '移除';
    remove.addEventListener('click', () => {
      row.remove();
      byId('rest-add').disabled = false;
      markDirty();
    });
    row.append(remove);
    restList.append(row);
    byId('rest-add').disabled = restList.children.length >= 4;
  }
  function populate(value) {
    form.elements.enabled.checked = value.enabled;
    for (const key of ['dayStart', 'dayEnd', 'focusMinutes', 'breakMinutes', 'dailyMaxMinutes'])
      form.elements[key].value = value[key];
    form.querySelectorAll('[name="weekdays"]').forEach((input) => {
      input.checked = value.weekdays.includes(Number(input.value));
    });
    restList.replaceChildren();
    byId('rest-add').disabled = false;
    value.restWindows.forEach(addRest);
  }
  function readForm() {
    return {
      enabled: form.elements.enabled.checked,
      dayStart: form.elements.dayStart.value,
      dayEnd: form.elements.dayEnd.value,
      focusMinutes: Number(form.elements.focusMinutes.value),
      breakMinutes: Number(form.elements.breakMinutes.value),
      dailyMaxMinutes: Number(form.elements.dailyMaxMinutes.value),
      weekdays: [...form.querySelectorAll('[name="weekdays"]:checked')].map((input) =>
        Number(input.value),
      ),
      restWindows: [...restList.children].map((row) => ({
        start: row.querySelector('[data-rest-time="start"]').value,
        end: row.querySelector('[data-rest-time="end"]').value,
      })),
    };
  }
  function summary(value) {
    byId('preferences-summary').textContent = value.enabled
      ? `${value.dayStart}–${value.dayEnd} · 每次至多 ${value.focusMinutes} 分钟 · 每天至多 ${value.dailyMaxMinutes / 60} 小时`
      : '已停用，可随时开启';
  }
  form.addEventListener('input', markDirty);
  byId('rest-add').addEventListener('click', () => {
    addRest();
    markDirty();
  });
  byId('preferences-reset').addEventListener('click', () => {
    populate(defaults);
    markDirty();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ownerKey() || busy) return;
    const owner = session();
    const value = readForm();
    if (!value.weekdays.length) {
      status.textContent = '至少选择一天；暂时不需要时可以取消勾选“按这些偏好规划空档”。';
      return;
    }
    busy = true;
    fields.disabled = true;
    status.textContent = '正在保存…';
    try {
      const result = await app.callApi('/workbench/schedule-planner/preferences', {
        method: 'PUT',
        body: JSON.stringify(value),
      });
      if (owner !== session()) return;
      savedPreferences = result.preferences;
      populate(savedPreferences);
      summary(savedPreferences);
      dirty = false;
      gapRequest += 1;
      gaps.hidden = true;
      status.textContent = '已保存到你的账号。已有事件和待确认预览都不会自动改变。';
    } catch (error) {
      if (owner === session()) status.textContent = error.message || '保存失败，请重试。';
    } finally {
      if (owner === session()) {
        busy = false;
        fields.disabled = false;
      }
    }
  });
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
  const timeFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  document.querySelectorAll('[data-planning-gaps]').forEach((button) =>
    button.addEventListener('click', async () => {
      const owner = session();
      gapRequest += 1;
      const request = gapRequest;
      gaps.hidden = false;
      gapList.replaceChildren();
      if (!ownerKey()) {
        gapStatus.textContent = '登录后可以查看属于你的空余时间。';
        return;
      }
      if (dirty) {
        gapStatus.textContent = '偏好有未保存的修改，请先保存，再查看空档。';
        return;
      }
      gapStatus.textContent = '正在看看有哪些空档…';
      try {
        const result = await app.callApi(
          `/workbench/schedule-planner/availability?days=${button.dataset.planningGaps}`,
          { method: 'GET' },
        );
        if (owner !== session() || request !== gapRequest) return;
        gapStatus.textContent = result.windows.length
          ? `按当前已记录的安排${savedPreferences?.enabled ? '和规划偏好' : ''}，找到 ${result.windows.length} 段空档，共 ${Math.round(result.minutes)} 分钟。`
          : '暂时没有符合当前偏好的空档，不必勉强塞进更多安排。';
        result.windows.forEach((window) => {
          const item = document.createElement('li');
          item.textContent = `${dateFormat.format(new Date(window.startAt))} · ${timeFormat.format(new Date(window.startAt))}–${timeFormat.format(new Date(window.endAt))}`;
          gapList.append(item);
        });
      } catch (error) {
        if (owner === session() && request === gapRequest)
          gapStatus.textContent = error.message || '查看失败，请重试。';
      }
    }),
  );
  // Do not silently plan with stale saved preferences while the form has edits.
  byId('agent-form').addEventListener(
    'submit',
    (event) => {
      if (!dirty && !busy) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      byId('agent-status').textContent =
        '请先保存规划偏好，再生成预览；也可以恢复页面以放弃未保存的修改。';
      form.closest('details').open = true;
    },
    true,
  );
  async function syncSession() {
    const owner = session();
    if (owner === activeSession) return;
    activeSession = owner;
    gapRequest += 1;
    tipRequest += 1;
    tipEvents = [];
    tipReady = false;
    toggleBubble(true);
    savedPreferences = null;
    dirty = false;
    busy = false;
    fields.disabled = true;
    gaps.hidden = true;
    gapList.replaceChildren();
    populate(defaults);
    byId('preferences-summary').textContent = '选填，随时可改';
    try {
      tipsHidden = localStorage.getItem(hiddenKey()) === 'hidden';
    } catch {
      tipsHidden = false;
    }
    renderTip();
    if (!ownerKey()) {
      status.textContent = '登录后可以保存自己的规划偏好。';
      return;
    }
    status.textContent = '正在读取偏好…';
    refreshTip();
    try {
      const result = await app.callApi('/workbench/schedule-planner/preferences', {
        method: 'GET',
      });
      if (owner !== session()) return;
      savedPreferences = result.preferences;
      populate(savedPreferences);
      summary(savedPreferences);
      fields.disabled = false;
      status.textContent = result.saved
        ? '已载入你的偏好，随时可以调整。'
        : '先使用上面的建议值：含午间 12:00–13:00、晚间 18:00–19:00 休息。可以修改、移除，或停用。';
    } catch (error) {
      if (owner === session())
        status.textContent = error.message || '偏好暂时未能加载，请刷新重试。';
    }
  }
  window.addEventListener('freebbs:session-change', syncSession);
  new MutationObserver(syncSession).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
  Promise.resolve(app.sessionReady)
    .catch(() => {})
    .finally(syncSession);
  for (const name of [
    'freebbs:workbench-loaded',
    'freebbs:workbench-refresh',
    'freebbs:campus-disconnected',
  ])
    window.addEventListener(name, refreshTip);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      syncSession();
      refreshTip();
    }
  });
  // No pop-ups, remote model calls, sound, or frequent animation.
  window.setInterval(() => {
    if (!document.hidden) refreshTip();
  }, 5 * 60000);
})();
