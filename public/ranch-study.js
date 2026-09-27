(function ranchStudyModule() {
  function createTimer(minutes = 25) {
    let duration = minutes * 60000;
    let remaining = duration;
    let deadline = null;
    let complete = false;
    function snapshot(now = Date.now()) {
      if (deadline !== null) {
        remaining = Math.max(0, deadline - now);
        if (remaining === 0) {
          deadline = null;
          complete = true;
        }
      }
      return { duration, remaining, running: deadline !== null, complete };
    }
    return {
      snapshot,
      start(now = Date.now()) {
        snapshot(now);
        if (deadline !== null) return;
        if (remaining === 0) remaining = duration;
        complete = false;
        deadline = now + remaining;
      },
      pause(now = Date.now()) {
        snapshot(now);
        deadline = null;
      },
      reset(nextMinutes = duration / 60000) {
        if (![15, 25, 45, 60].includes(Number(nextMinutes))) return;
        duration = Number(nextMinutes) * 60000;
        remaining = duration;
        deadline = null;
        complete = false;
      },
    };
  }
  function countdown(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createTimer, countdown };
    return;
  }
  if (!document.body.classList.contains('ranch-page')) return;
  const preferenceKey = 'freebbs_ranch_study';
  let preferences = { clock: true, focus: false, minutes: 25 };
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey));
    if (saved && typeof saved === 'object')
      preferences = {
        clock: typeof saved.clock === 'boolean' ? saved.clock : true,
        focus: typeof saved.focus === 'boolean' ? saved.focus : false,
        minutes: [15, 25, 45, 60].includes(saved.minutes) ? saved.minutes : 25,
      };
  } catch {
    /* Optional preferences. */
  }
  const timer = createTimer(preferences.minutes);
  const desktop = matchMedia('(min-width: 901px)');
  let scene;
  let active = false;
  let nativeRoot = null;
  let tickId;
  let completedAnnounced = false;
  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  function save() {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    } catch {
      /* Optional. */
    }
  }
  function text(selector, value) {
    const node = scene?.querySelector(selector);
    if (node && node.textContent !== value) node.textContent = value;
  }
  function render() {
    clearTimeout(tickId);
    if (!scene?.isConnected) return;
    const state = timer.snapshot();
    text(
      '[data-study-enter]',
      state.running
        ? `专注中 ${countdown(state.remaining)} ↗`
        : state.complete
          ? '本轮专注完成 ↗'
          : '学习背景 ↗',
    );
    text('[data-study-motion]', scene.classList.contains('is-paused') ? '继续动态' : '暂停动态');
    scene.classList.toggle('is-study-mode', active);
    document.body.classList.toggle('ranch-study-open', active);
    scene.querySelector('[data-study-clock]').hidden = !preferences.clock;
    scene.querySelector('[data-study-focus]').hidden = !preferences.focus;
    scene
      .querySelector('[data-study-toggle-clock]')
      .setAttribute('aria-pressed', String(preferences.clock));
    scene
      .querySelector('[data-study-toggle-focus]')
      .setAttribute('aria-pressed', String(preferences.focus));
    scene.querySelector('[data-study-duration]').disabled = state.running;
    scene.querySelector('[data-study-duration]').value = String(preferences.minutes);
    text(
      '[data-study-time]',
      new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    );
    text(
      '[data-study-date]',
      new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(
        new Date(),
      ),
    );
    text('[data-study-countdown]', countdown(state.remaining));
    text(
      '[data-study-start]',
      state.running
        ? '暂停'
        : state.complete
          ? '再专注一轮'
          : state.remaining < state.duration
            ? '继续'
            : '开始专注',
    );
    text(
      '[data-study-focus-caption]',
      state.complete
        ? '本轮完成，休息一下吧'
        : state.running
          ? '专注中'
          : state.remaining < state.duration
            ? '已暂停'
            : '留一段时间给自己',
    );
    if (state.complete && !completedAnnounced) {
      text('[data-study-notice]', '本轮专注已完成，休息一下吧。');
      completedAnnounced = true;
    }
    if (!document.hidden && (active || state.running))
      tickId = setTimeout(render, 1000 - (Date.now() % 1000));
  }
  function leaveUI() {
    active = false;
    nativeRoot = null;
    document.body.classList.remove('ranch-study-open');
    scene?.classList.remove('is-study-mode');
    render();
    scene?.querySelector('[data-study-enter]')?.focus({ preventScroll: true });
  }
  async function leave() {
    try {
      if (fullscreenElement() === root)
        await (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    } catch {
      /* The browser may already have handled Escape. */
    }
    leaveUI();
  }
  async function enter() {
    if (!desktop.matches || active) return;
    active = true;
    render();
    text('[data-study-notice]', '');
    try {
      // The scene is rebuilt every minute for satiety; its parent stays mounted.
      const request = root.requestFullscreen || root.webkitRequestFullscreen;
      if (!request) throw new Error('Fullscreen unavailable');
      await request.call(root);
      if (!active) return;
      nativeRoot = fullscreenElement() === root ? root : null;
      if (!nativeRoot) throw new Error('Fullscreen unavailable');
    } catch {
      if (!active) return;
      text('[data-study-notice]', '已进入网页沉浸模式；浏览器暂未允许系统全屏。按 Esc 可退出。');
    }
    scene.querySelector('[data-study-exit]').focus({ preventScroll: true });
  }
  function mount() {
    const next = document.querySelector('.ranch-photographic .ranch-scene');
    if (!next) {
      if (active) leave();
      scene = null;
      clearTimeout(tickId);
      return;
    }
    if (next === scene) return;
    scene = next;
    scene.insertAdjacentHTML(
      'beforeend',
      `<button type="button" class="ranch-study-enter" data-study-enter>学习背景 ↗</button>
      <div class="ranch-study-overlay">
        <div class="ranch-study-readout">
          <div class="ranch-study-clock" data-study-clock><time data-study-time aria-label="当地时间"></time><p data-study-date></p></div>
          <section class="ranch-study-focus" data-study-focus aria-label="专注计时">
            <p data-study-focus-caption></p><output data-study-countdown role="timer" aria-live="off"></output>
            <div class="ranch-study-timer-controls"><select data-study-duration aria-label="专注时长"><option value="15">15 分钟</option><option value="25">25 分钟</option><option value="45">45 分钟</option><option value="60">60 分钟</option></select><button type="button" data-study-start>开始专注</button><button type="button" data-study-reset>重置</button></div>
          </section>
        </div>
        <p class="ranch-study-notice" data-study-notice role="status"></p>
        <div class="ranch-study-toolbar" role="group" aria-label="学习背景设置"><button type="button" data-study-toggle-clock aria-pressed="true">时钟</button><button type="button" data-study-toggle-focus aria-pressed="false">专注计时</button><button type="button" data-study-motion>暂停动态</button><button type="button" data-study-exit>退出全屏</button></div>
      </div>`,
    );
    scene.querySelector('[data-study-enter]').addEventListener('click', enter);
    scene.querySelector('[data-study-exit]').addEventListener('click', leave);
    for (const name of ['clock', 'focus'])
      scene.querySelector(`[data-study-toggle-${name}]`).addEventListener('click', () => {
        preferences[name] = !preferences[name];
        save();
        render();
        if (name === 'focus' && !preferences.focus && timer.snapshot().running)
          text('[data-study-notice]', '专注计时仍在继续，可再次打开查看或暂停。');
      });
    scene.querySelector('[data-study-start]').addEventListener('click', () => {
      if (timer.snapshot().running) timer.pause();
      else timer.start();
      completedAnnounced = false;
      text('[data-study-notice]', '');
      render();
    });
    scene.querySelector('[data-study-reset]').addEventListener('click', () => {
      timer.reset();
      completedAnnounced = false;
      text('[data-study-notice]', '');
      render();
    });
    scene.querySelector('[data-study-duration]').addEventListener('change', (event) => {
      preferences.minutes = Number(event.target.value);
      timer.reset(preferences.minutes);
      completedAnnounced = false;
      save();
      render();
    });
    scene.querySelector('[data-study-motion]').addEventListener('click', () => {
      scene.querySelector('[data-ranch-pause]')?.click();
      text('[data-study-motion]', scene.classList.contains('is-paused') ? '继续动态' : '暂停动态');
    });
    text('[data-study-motion]', scene.classList.contains('is-paused') ? '继续动态' : '暂停动态');
    render();
  }
  const root = document.querySelector('#public-profile-ranch');
  if (root) new MutationObserver(mount).observe(root, { childList: true });
  mount();
  function onFullscreenChange() {
    if (!active) return;
    if (fullscreenElement() === root) nativeRoot = root;
    else leaveUI();
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && active && !fullscreenElement()) leaveUI();
  });
  document.addEventListener('visibilitychange', render);
  desktop.addEventListener('change', () => {
    if (!desktop.matches && active) leave();
  });
})();
