(() => {
  const commonJs = typeof module !== 'undefined' && module.exports;
  const releases = commonJs ? require('./max-guide-releases') : window.FreeBbsGuideReleases;
  const stations = commonJs ? require('./max-guide-stations') : window.FreeBbsGuideStations;
  const geometry = commonJs ? require('./max-guide-geometry') : window.FreeBbsGuideGeometry;
  const VERSION = releases.GUIDE_VERSION;
  const { STATIONS, STEPS } = stations;
  const { tourGeometry } = geometry;
  function stepsFor(version = VERSION) {
    if (!knownVersion(version)) throw new Error('导览版本无效');
    const release = releases.RELEASES.find((item) => item.id === version);
    if (!release) return STEPS;
    const ids = release.stepIds || stations.RELEASE_STEP_IDS || [];
    return ids.map((id) => STEPS.find((step) => step.id === id)).filter(Boolean);
  }
  function knownVersion(value) {
    return value === VERSION || releases.RELEASES.some((release) => release.id === value);
  }
  const FLOATING_PATHS = new Set([
    '/',
    '/world',
    '/discussion',
    '/workbench',
    '/inventory',
    '/electromagnetic',
  ]);
  const AUTO_WELCOME_PATHS = new Set([
    ...FLOATING_PATHS,
    '/guide',
    '/aichat',
    '/course',
    '/knowledge',
  ]);
  function hasBlockingModal(doc, win, ownDialog = null) {
    const candidates = doc.querySelectorAll(
      'dialog[open], .modal:not(.hidden), .fortune-modal:not(.hidden), [aria-modal="true"], [role="dialog"]',
    );
    return [...candidates].some((node) => {
      if (node === ownDialog || ownDialog?.contains(node)) return false;
      if (node.matches('dialog[open]')) return true;
      if (node.closest('[hidden], .hidden, [aria-hidden="true"]')) return false;
      const rect = node.getBoundingClientRect();
      const style = win.getComputedStyle(node);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    });
  }
  function initialGuideDecision(progress, { member, pathname, visible, blocked, requested }) {
    const firstWelcome = member && !progress.seenAt && AUTO_WELCOME_PATHS.has(pathname);
    const continuedTour =
      requested && progress.status === 'in_progress' && STEPS[progress.step]?.route === pathname;
    if ((firstWelcome || requested) && (!visible || blocked))
      return { presentation: 'defer', saveVisit: false };
    let presentation = 'none';
    if (firstWelcome || requested) presentation = 'welcome';
    if (continuedTour) presentation = 'tour';
    return { presentation, saveVisit: true };
  }
  const TASKS = Object.freeze([
    {
      id: 'explore_world',
      route: '/world',
      title: '登上一座知识岛',
      description: '打开学习世界，认识课程入口。',
    },
    {
      id: 'visit_discussion',
      route: '/discussion',
      title: '听听大家的想法',
      description: '看看讨论区里的真实问题。',
    },
    {
      id: 'meet_max',
      route: '/aichat',
      title: '和 Max 打个照面',
      description: '认识答疑入口，不必立即提问。',
    },
    {
      id: 'open_workbench',
      route: '/workbench',
      title: '找到自己的节奏',
      description: '打开工作台，认识计划与通知。',
    },
    {
      id: 'visit_inventory',
      route: '/inventory',
      title: '打开小小行囊',
      description: '认识仓库、鱼骨与钱包账本。',
    },
  ]);
  const clamp = (number, min, max) => Math.min(Math.max(number, min), Math.max(min, max));
  function emptyProgress(version = VERSION) {
    return {
      version,
      status: 'not_started',
      step: 0,
      completedTasks: [],
      seenAt: null,
      completedAt: null,
      dismissedAt: null,
      updatedAt: null,
    };
  }
  function normalizeProgress(value, version = VERSION, stepCount = stepsFor(version).length) {
    if (
      !value ||
      value.version !== version ||
      !['not_started', 'in_progress', 'skipped', 'completed'].includes(value.status)
    )
      throw new Error('导览版本或进度发生变化，请刷新后重试。');
    return {
      ...emptyProgress(version),
      status: value.status,
      step: Number.isInteger(value.step) ? clamp(value.step, 0, stepCount - 1) : 0,
      completedTasks: TASKS.filter(
        (task) => Array.isArray(value.completedTasks) && value.completedTasks.includes(task.id),
      ).map((task) => task.id),
      ...Object.fromEntries(
        ['seenAt', 'completedAt', 'dismissedAt', 'updatedAt'].map((key) => [
          key,
          typeof value[key] === 'string' ? value[key] : null,
        ]),
      ),
    };
  }
  function mergeGuest(previous, patch, now = Date.now()) {
    const stamp = new Date(now).toISOString();
    const result = { ...previous, seenAt: previous.seenAt || stamp, updatedAt: stamp };
    result.completedTasks = TASKS.filter(
      (task) =>
        previous.completedTasks.includes(task.id) || patch.completedTasks?.includes(task.id),
    ).map((task) => task.id);
    if (patch.restart) {
      result.status = 'in_progress';
      result.step = patch.step ?? 0;
      result.dismissedAt = null;
    } else if (previous.status !== 'completed') {
      result.status = patch.status ?? previous.status;
      result.step = patch.step ?? previous.step;
    }
    if (result.status === 'completed') result.completedAt ||= stamp;
    if (patch.status === 'skipped') result.dismissedAt = stamp;
    return normalizeProgress(result, previous.version);
  }
  function taskForPath(pathname) {
    return TASKS.find((task) => task.route === pathname)?.id || null;
  }
  function tourUrl(index, version = VERSION, context = {}) {
    const steps = stepsFor(version);
    if (!knownVersion(version) || !Number.isInteger(index) || !steps[index])
      throw new Error('导览步骤无效');
    const step = steps[index];
    const base = 'https://guide.invalid';
    const remembered = context[step.route];
    let url = new URL(step.route, base);
    if (remembered) {
      const candidate = new URL(remembered, base);
      if (candidate.origin === base && candidate.pathname === step.route) url = candidate;
    }
    if (step.route === '/profile' && context.uid) url.searchParams.set('uid', context.uid);
    url.searchParams.delete('guideVersion');
    url.searchParams.set('guideTour', '1');
    if (version !== VERSION) url.searchParams.set('guideVersion', version);
    return url.pathname + url.search + url.hash;
  }
  function safeGuideHref(href, origin, expectedRoute) {
    const url = new URL(href, origin);
    if (url.origin !== origin || url.pathname !== expectedRoute)
      throw new Error('这个入口已变化，请跳过此站或稍后再试。');
    url.searchParams.delete('guideTour');
    url.searchParams.delete('guideVersion');
    return url.pathname + url.search + url.hash;
  }
  function abortError() {
    return Object.assign(new Error('登录状态或导览页面已变化'), { name: 'AbortError' });
  }

  // Capture the owner when enqueuing, not when sending. A delayed request can never
  // take the next account's token or apply the previous account's response.
  function createProgressClient({
    identity,
    request,
    version = VERSION,
    guestRead = () => emptyProgress(version),
    guestWrite = () => {},
    now = Date.now,
  }) {
    if (!knownVersion(version)) throw new Error('导览版本无效');
    let generation = 0;
    let queue = Promise.resolve();
    let progress = emptyProgress(version);
    let loaded = false;
    const active = new Set();
    function enqueue(method, patch) {
      const owner = { ...identity() };
      const epoch = generation;
      const valid = () =>
        epoch === generation && owner.key === identity().key && owner.token === identity().token;
      const promise = queue
        .catch(() => {})
        .then(async () => {
          if (!valid()) throw abortError();
          let next;
          if (!owner.token) {
            if (method === 'GET') {
              try {
                next = normalizeProgress(guestRead(), version);
              } catch {
                next = emptyProgress(version);
              }
            } else {
              next = mergeGuest(progress, patch, now());
              guestWrite(next);
            }
          } else {
            const controller = new AbortController();
            active.add(controller);
            let timer;
            try {
              next = await Promise.race([
                request(method, patch, owner, controller.signal),
                new Promise((resolve, reject) => {
                  timer = setTimeout(() => {
                    reject(new Error('同步超时了。可以重试，也可以随时退出。'));
                    controller.abort();
                  }, 10000);
                }),
              ]);
            } finally {
              clearTimeout(timer);
              active.delete(controller);
            }
          }
          if (!valid()) throw abortError();
          progress = normalizeProgress(next, version);
          loaded = true;
          return structuredClone(progress);
        });
      queue = promise.catch(() => {});
      return promise;
    }
    return {
      load: () => enqueue('GET'),
      save: (patch) => enqueue('PATCH', { ...patch, version }),
      snapshot: () => structuredClone(progress),
      isLoaded: () => loaded,
      reset() {
        generation += 1;
        active.forEach((controller) => controller.abort());
        active.clear();
        queue = Promise.resolve();
        progress = emptyProgress(version);
        loaded = false;
      },
    };
  }

  function createController(win, doc, app) {
    const pageBody = doc.body;
    let blockedSession = false;
    const identity = () => {
      const user = app.userState || {};
      return user.isLoggedIn && user.token && user.uid && !blockedSession
        ? { key: user.uid, token: user.token }
        : { key: 'guest', token: '' };
    };
    const storage = {
      read(key) {
        try {
          return win.sessionStorage.getItem(key);
        } catch {
          return null;
        }
      },
      write(key, value) {
        try {
          win.sessionStorage.setItem(key, value);
        } catch {
          /* Optional tab cache. */
        }
      },
    };
    const clients = new Map();
    function progressClient(version) {
      if (!clients.has(version))
        clients.set(
          version,
          createProgressClient({
            version,
            identity,
            request(method, patch, owner, signal) {
              return app.callApi(`/onboarding?version=${encodeURIComponent(version)}`, {
                method,
                signal,
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${owner.token}`,
                },
                ...(patch ? { body: JSON.stringify(patch) } : {}),
              });
            },
            guestRead: () =>
              JSON.parse(storage.read(`freebbs_guide_guest_${version}`) || 'null') ||
              emptyProgress(version),
            guestWrite: (value) =>
              storage.write(`freebbs_guide_guest_${version}`, JSON.stringify(value)),
          }),
        );
      return clients.get(version);
    }
    const baseClient = progressClient(VERSION);
    let version = VERSION;
    let client = baseClient;
    let steps = stepsFor(version);
    let owner = '';
    let initEpoch = 0;
    let viewEpoch = 0;
    let activeIndex = null;
    let mode = 'welcome';
    let dialog;
    let card;
    let curtains;
    let spotlight;
    let controls;
    let target;
    let previousFocus;
    let oldOverflow;
    let busy = false;
    let syncError = '';
    let retryAction = null;
    let welcomeChoice = 0;
    let lastFrame = 0;
    let observer;
    let domObserver;
    let pendingTask = null;
    let deferredObserver = null;
    let deferredFrame = 0;
    let deferredPresentation = false;
    let expanded = false;
    let targetMissing = false;
    let restoreTarget = null;
    const openedDialogs = new Set();
    const path = () => win.location.pathname.replace(/\/$/, '') || '/';
    const isMember = () => Boolean(identity().token);
    const notice = () =>
      isMember() ? '进度随账号保存；随时可以暂停或重看。' : '游客体验：进度只保存在当前标签页。';
    function chooseVersion(value) {
      version = knownVersion(value) ? value : VERSION;
      client = progressClient(version);
      steps = stepsFor(version);
    }
    function element(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function stripTourFlag() {
      const url = new URL(win.location.href);
      url.searchParams.delete('guideTour');
      url.searchParams.delete('guideVersion');
      win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash);
    }
    function routeContext() {
      let value;
      try {
        value = JSON.parse(storage.read(`freebbs_guide_routes_${identity().key}`) || '{}');
      } catch {
        value = {};
      }
      return { ...value, uid: app.userState?.uid };
    }
    function rememberRoute(href) {
      const url = new URL(href, win.location.origin);
      const safe = safeGuideHref(url.href, win.location.origin, url.pathname);
      storage.write(
        `freebbs_guide_routes_${identity().key}`,
        JSON.stringify({ ...routeContext(), [url.pathname]: safe }),
      );
    }
    function renderTasks() {
      const progress = baseClient.snapshot();
      const count = progress.completedTasks.length;
      const list = doc.getElementById('guide-task-list');
      if (list)
        list.replaceChildren(
          ...TASKS.map((task, index) => {
            const done = progress.completedTasks.includes(task.id);
            const link = element('a', `guide-task${done ? ' is-complete' : ''}`);
            link.href = task.route;
            link.setAttribute('aria-label', `${task.title}，${done ? '已探索' : '尚未探索'}`);
            link.append(
              element('span', '', done ? '✓' : String(index + 1).padStart(2, '0')),
              element('strong', '', task.title),
              element('small', '', done ? '已留下探索足迹 · 可以再看看' : task.description),
            );
            return link;
          }),
        );
      const label = doc.getElementById('guide-task-progress');
      if (label) label.textContent = `${count} / ${TASKS.length} 已探索`;
      const bar = doc.getElementById('guide-task-bar');
      if (bar) bar.style.width = `${(count / TASKS.length) * 100}%`;
      const status = doc.getElementById('guide-sync-status');
      if (status) status.textContent = syncError || notice();
      const retry = doc.querySelector('[data-guide-sync-retry]');
      if (retry) retry.hidden = !syncError;
      const release = releases.LATEST_RELEASE;
      const releaseStatus = doc.getElementById('guide-release-status');
      if (releaseStatus && release) {
        const p = progressClient(release.id).snapshot();
        releaseStatus.textContent =
          p.status === 'completed'
            ? '本次更新已看完 · 随时可以重看'
            : p.seenAt
              ? '本次更新可以继续查看'
              : '新功能专门导览 · 与完整导览分别保存';
      }
    }
    function installEntries() {
      if (!doc.querySelector('link[href="/max-guide.css"]')) {
        const css = element('link');
        css.rel = 'stylesheet';
        css.href = '/max-guide.css';
        doc.head.append(css);
      }
      const actions = doc.querySelector('.home-actions');
      if (actions && !doc.querySelector('.home-guide-entry')) {
        const entry = element('a', 'home-guide-entry');
        entry.href = '/guide';
        const max = element('img');
        max.src = '/assets/max-guide-v1.webp';
        max.alt = '';
        const copy = element('span');
        copy.append(
          element('strong', '', '跟着 Max，认识 FREE BBS 的每一个角落'),
          element('small', '', '分站讲解 · 新功能指引 · 随时继续探索'),
        );
        entry.append(max, copy, element('b', '', '↗'));
        actions.before(entry);
      }
      const stationList = doc.getElementById('guide-station-list');
      if (stationList)
        stationList.replaceChildren(
          ...STATIONS.map((station) => {
            const button = element('button', 'guide-station-link');
            button.type = 'button';
            button.dataset.guideStation = station.id;
            button.append(
              element('strong', '', station.title || station.label),
              element('small', '', station.description || '进入这一站，跟 Max 一步步看看。'),
            );
            return button;
          }),
        );
      const status = doc.getElementById('guide-sync-status');
      if (status && !doc.querySelector('[data-guide-sync-retry]')) {
        const retry = element('button', 'max-tour-later', '重试同步');
        retry.type = 'button';
        retry.dataset.guideSyncRetry = '';
        retry.hidden = true;
        retry.addEventListener('click', refresh);
        status.after(retry);
      }
      if (FLOATING_PATHS.has(path()) && !doc.querySelector('[data-max-guide-reopen]')) {
        const reopen = element('button', 'max-guide-reopen');
        reopen.type = 'button';
        reopen.dataset.maxGuideReopen = '';
        const max = element('img');
        max.src = '/assets/max-guide-v1.webp';
        max.alt = '';
        reopen.append(max, element('small', '', 'Max 探索手册'));
        reopen.addEventListener('click', () => openManual());
        doc.body.append(reopen);
      }
    }
    function visible(selector) {
      if (!selector) return null;
      return (
        [...doc.querySelectorAll(selector)].find((node) => {
          const rect = node.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            !node.closest('[hidden],.hidden,[aria-hidden="true"]') &&
            win.getComputedStyle(node).visibility !== 'hidden'
          );
        }) || null
      );
    }
    function visibleTarget(step) {
      return (
        (!isMember() && visible(step.guestTarget)) ||
        visible(step.target) ||
        visible(step.emptyTarget)
      );
    }
    function frameTarget(step) {
      restoreTarget?.();
      restoreTarget = null;
      if (!target) return;
      const main = doc.querySelector('.main-content');
      const heading = main && win.getComputedStyle(main, '::before');
      const safeTop =
        heading?.position === 'fixed' && heading.display !== 'none'
          ? (parseFloat(heading.height) || 0) + (parseFloat(heading.borderBottomWidth) || 0)
          : 0;
      const mobileNav = visible('.mobile-nav');
      const footerHeight = mobileNav ? mobileNav.getBoundingClientRect().height : 0;
      if (step.focus?.fit === 'overview') {
        const original = {
          transform: target.style.transform,
          transformOrigin: target.style.transformOrigin,
        };
        const measured = target.getBoundingClientRect();
        const scale = Math.min(
          1,
          Math.max(150, win.innerHeight - safeTop - footerHeight - 284) / measured.height,
        );
        if (scale < 1) {
          const feature = target;
          target.style.transformOrigin = 'top center';
          target.style.transform = `${original.transform || ''} scale(${scale})`;
          restoreTarget = () => {
            Object.assign(feature.style, original);
          };
        }
      }
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      if (!target.closest('dialog[open]')) {
        const rect = target.getBoundingClientRect();
        const desired =
          step.focus?.fit === 'overview' ||
          rect.width > win.innerWidth * 0.55 ||
          rect.height > (win.innerHeight - safeTop) * 0.6
            ? safeTop + 18
            : Math.max(safeTop + 18, (win.innerHeight - footerHeight - rect.height) / 2);
        win.scrollBy({ top: rect.top - desired, behavior: 'instant' });
      }
    }
    function setBox(node, box) {
      Object.assign(node.style, {
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      });
    }
    function layout() {
      if (!dialog?.open) return;
      const viewport = { width: win.innerWidth, height: win.innerHeight };
      const rect = target?.isConnected ? target.getBoundingClientRect() : null;
      const step = steps[activeIndex];
      card.classList.toggle('is-centered', mode === 'welcome');
      card.classList.remove('is-compact');
      let size = card.getBoundingClientRect();
      let box = tourGeometry(mode === 'welcome' ? null : rect, viewport, size, step?.focus || {});
      if (mode === 'tour' && box.needsCompact && !expanded) {
        card.classList.add('is-compact');
        size = card.getBoundingClientRect();
        box = tourGeometry(rect, viewport, size, { ...step?.focus, compact: true });
      }
      controls.expand.hidden =
        mode === 'welcome' ||
        (!box.needsCompact && !expanded && !card.classList.contains('is-compact'));
      controls.expand.textContent = expanded ? '收起说明' : '展开说明';
      card.classList.toggle('is-overview', box.layout === 'overview');
      if (mode !== 'welcome')
        Object.assign(card.style, { left: `${box.card.x}px`, top: `${box.card.y}px` });
      curtains.forEach((curtain, index) => {
        const region = box.curtains[index];
        curtain.hidden = !region;
        if (region) setBox(curtain, region);
      });
      spotlight.hidden = !box.hole;
      if (box.hole) {
        setBox(spotlight, box.hole);
        spotlight.style.borderRadius = `${step?.focus?.radius ?? 18}px`;
      }
      const action = step?.action && visible(step.action.selector);
      controls.targetAction.hidden =
        mode !== 'tour' || !box.hole || !action || targetMissing || busy;
      if (!controls.targetAction.hidden) {
        const r = action.getBoundingClientRect();
        setBox(controls.targetAction, {
          x: Math.max(0, r.left),
          y: Math.max(0, r.top),
          width: Math.min(r.right, viewport.width) - Math.max(0, r.left),
          height: Math.min(r.bottom, viewport.height) - Math.max(0, r.top),
        });
        controls.targetAction.setAttribute('aria-label', step.action.label || '进入这个功能');
        controls.targetAction.title = step.action.label || '点击进入';
      }
    }
    function scheduleLayout() {
      if (!dialog?.open) return;
      win.cancelAnimationFrame(lastFrame);
      lastFrame = win.requestAnimationFrame(layout);
    }
    function setBusy(value) {
      busy = value;
      if (!controls) return;
      [
        controls.back,
        controls.next,
        controls.restart,
        controls.retry,
        controls.skip,
        controls.stations,
        controls.targetAction,
      ].forEach((button) => {
        button.disabled = value;
      });
      card.setAttribute('aria-busy', String(value));
    }
    function showError(error, retry) {
      syncError = error?.message || '暂时无法同步，请稍后重试。';
      retryAction = retry;
      renderTasks();
      if (dialog?.open) {
        controls.status.textContent = syncError;
        controls.retry.hidden = !retry;
        scheduleLayout();
      }
    }
    function clearError() {
      syncError = '';
      retryAction = null;
      if (controls) {
        controls.status.textContent = '';
        controls.retry.hidden = true;
      }
      renderTasks();
    }
    function stopDeferredPresentation() {
      deferredPresentation = false;
      deferredObserver?.disconnect();
      deferredObserver = null;
      win.cancelAnimationFrame(deferredFrame);
    }
    function closeUi() {
      restoreTarget?.();
      restoreTarget = null;
      stopDeferredPresentation();
      viewEpoch += 1;
      if (dialog?.open) dialog.close();
      observer?.disconnect();
      domObserver?.disconnect();
      target = null;
      activeIndex = null;
      if (oldOverflow !== undefined) {
        pageBody.style.overflow = oldOverflow;
        oldOverflow = undefined;
      }
      setBusy(false);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    }
    async function pause() {
      const acknowledged = client.isLoaded() && !blockedSession;
      const chosen = client;
      closeUi();
      stripTourFlag();
      if (acknowledged)
        try {
          await chosen.save({ status: 'skipped' });
          renderTasks();
        } catch (error) {
          if (error.name !== 'AbortError') showError(error, refresh);
        }
    }
    function ensureDialog() {
      if (dialog) return;
      dialog = element('dialog', 'max-tour');
      dialog.setAttribute('aria-labelledby', 'max-tour-title');
      dialog.setAttribute('aria-describedby', 'max-tour-body');
      curtains = Array.from({ length: 4 }, () => element('div', 'max-tour-curtain'));
      curtains.forEach((node) => node.setAttribute('aria-hidden', 'true'));
      spotlight = element('div', 'max-tour-spotlight');
      spotlight.setAttribute('aria-hidden', 'true');
      const targetAction = element('button', 'max-tour-target-action');
      targetAction.type = 'button';
      targetAction.addEventListener('click', advance);
      card = element('section', 'max-tour-card');
      const mascot = element('img', 'max-tour-mascot');
      mascot.src = '/assets/max-guide-v1.webp';
      mascot.alt = '';
      const title = element('h2');
      title.id = 'max-tour-title';
      title.tabIndex = -1;
      const body = element('p', 'max-tour-body');
      body.id = 'max-tour-body';
      const kicker = element('p', 'max-tour-kicker');
      const caption = element('p', 'max-tour-caption');
      const row = element('div', 'max-tour-controls');
      const exit = element('button', 'max-tour-later', '稍后继续');
      const back = element('button', 'guide-secondary', '上一步');
      const restart = element('button', 'guide-secondary', '重新开始');
      const next = element('button', 'guide-primary', '下一步 →');
      const retry = element('button', 'max-tour-later', '重试');
      const skip = element('button', 'max-tour-later', '跳过此站');
      const expand = element('button', 'max-tour-later max-tour-expand', '展开说明');
      const stationSelect = element('select', 'max-tour-stations');
      stationSelect.setAttribute('aria-label', '选择导览站点');
      const secondary = element('div', 'max-tour-secondary');
      for (const button of [exit, back, restart, next, retry, skip, expand]) button.type = 'button';
      exit.addEventListener('click', pause);
      back.addEventListener('click', () => goTo(activeIndex - 1));
      restart.addEventListener('click', () => begin(0, true));
      next.addEventListener('click', advance);
      skip.addEventListener('click', skipStation);
      expand.addEventListener('click', () => {
        expanded = !expanded;
        scheduleLayout();
      });
      retry.addEventListener('click', () => {
        if (retryAction && !busy) retryAction();
      });
      stationSelect.addEventListener('change', () => goTo(Number(stationSelect.value)));
      const progress = element('div', 'max-tour-progress');
      progress.setAttribute('role', 'progressbar');
      progress.setAttribute('aria-label', '导览进度');
      progress.setAttribute('aria-valuemin', '0');
      const status = element('p', 'max-tour-status');
      status.setAttribute('role', 'status');
      row.append(exit, back, restart, next);
      secondary.append(stationSelect, skip, expand);
      card.append(mascot, kicker, title, body, caption, row, secondary, progress, status, retry);
      dialog.append(...curtains, spotlight, targetAction, card);
      doc.body.append(dialog);
      controls = {
        title,
        body,
        kicker,
        caption,
        exit,
        back,
        restart,
        next,
        retry,
        skip,
        expand,
        stations: stationSelect,
        secondary,
        progress,
        status,
        targetAction,
      };
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        pause();
      });
      dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          pause();
        }
      });
      if (typeof win.ResizeObserver === 'function')
        observer = new win.ResizeObserver(scheduleLayout);
    }
    function showDialog() {
      ensureDialog();
      if (!dialog.open) {
        previousFocus ||= doc.activeElement;
        if (oldOverflow === undefined) oldOverflow = pageBody.style.overflow;
        pageBody.style.overflow = 'hidden';
        dialog.showModal();
      }
      observer?.observe(card);
      controls.title.focus({ preventScroll: true });
      scheduleLayout();
    }
    function welcome() {
      ensureDialog();
      viewEpoch += 1;
      mode = 'welcome';
      activeIndex = null;
      target = null;
      expanded = false;
      const p = client.snapshot();
      const resumable = ['in_progress', 'skipped'].includes(p.status) && p.step > 0;
      const release = releases.RELEASES.find((item) => item.id === version);
      welcomeChoice = resumable ? p.step : 0;
      card.classList.add('is-welcome');
      controls.kicker.textContent = release ? 'MAX · 本次更新专门指引' : 'MAX · 分站探索手册';
      controls.title.textContent = resumable
        ? '地图替你留着，接着逛吧。'
        : release
          ? release.title
          : '你好呀，我是 Max！';
      controls.body.textContent = resumable
        ? `我们上次走到「${steps[p.step].label}」。可以继续这一站，也可以重新开始。`
        : release
          ? `${release.description}这次只介绍新增与调整的功能，完成后不会自动重复。`
          : '从学习世界的一颗星球，到课程里的一个知识点，再看看讨论、计划与自己的小行囊。你可以逐站探索，也可以在手册里只选择感兴趣的一站。';
      controls.caption.textContent = notice();
      controls.back.hidden = true;
      controls.restart.hidden = !resumable;
      controls.next.textContent = resumable
        ? '接着出发 →'
        : release
          ? '看看新功能 →'
          : '好呀，带我去！';
      controls.exit.textContent = '稍后再看';
      controls.secondary.hidden = true;
      controls.progress.hidden = true;
      controls.retry.hidden = !syncError;
      controls.status.textContent = syncError;
      setBusy(false);
      showDialog();
    }
    function rememberOpenDialogs(before) {
      for (const node of doc.querySelectorAll('dialog[open]'))
        if (node !== dialog && !before.has(node)) openedDialogs.add(node);
    }
    async function waitVisible(selector, epoch, duration = 2400) {
      const start = Date.now();
      while (Date.now() - start < duration) {
        if (epoch !== viewEpoch || blockedSession) return null;
        const node = visible(selector);
        if (node) return node;
        await new Promise((resolve) => {
          win.setTimeout(resolve, 80);
        });
      }
      return visible(selector);
    }
    async function prepareStep(step, epoch) {
      // Only reversible view controls declared by this release may be opened.
      for (const action of step.prepare || []) {
        if (visible(action.whenMissing)) continue;
        const button = await waitVisible(action.selector, epoch);
        if (!button || epoch !== viewEpoch) return;
        const before = new Set(doc.querySelectorAll('dialog[open]'));
        button.click();
        rememberOpenDialogs(before);
        await waitVisible(action.whenMissing, epoch);
      }
    }
    function closeIrrelevantDialogs(step) {
      const expected = doc.querySelector(step.target);
      for (const node of openedDialogs) {
        if (
          node.open &&
          !node.contains(expected) &&
          // The target can arrive after its containing dialog has already opened.
          !(step.prepare || []).some(
            (p) =>
              node.contains(doc.querySelector(p.selector)) ||
              node.contains(doc.querySelector(p.whenMissing)),
          )
        )
          node.close();
      }
    }
    async function showStep(index) {
      ensureDialog();
      restoreTarget?.();
      restoreTarget = null;
      viewEpoch += 1;
      const epoch = viewEpoch;
      activeIndex = index;
      mode = 'tour';
      expanded = false;
      targetMissing = false;
      const step = steps[index];
      if (dialog.open) dialog.close();
      closeIrrelevantDialogs(step);
      await prepareStep(step, epoch);
      if (epoch !== viewEpoch) return;
      await waitVisible(step.target, epoch);
      if (epoch !== viewEpoch) return;
      target = visibleTarget(step);
      targetMissing = !target || Boolean(step.emptyTarget && target === visible(step.emptyTarget));
      observer?.disconnect();
      domObserver?.disconnect();
      if (target) {
        frameTarget(step);
        observer?.observe(target);
      }
      card.classList.remove('is-welcome');
      const stationSteps = steps.filter((entry) => entry.station === step.station);
      const local = stationSteps.findIndex((entry) => entry.id === step.id) + 1;
      controls.kicker.textContent = `${step.label} · ${local}/${stationSteps.length}`;
      controls.title.textContent = step.title;
      controls.body.textContent = targetMissing
        ? step.emptyBody ||
          '这里目前还没有可展示的内容，或页面尚未加载完成。你可以重试打开，也可以先跳过这一站。'
        : step.body;
      controls.caption.textContent = targetMissing
        ? '不会用无关区域代替高亮，也不会替你创建内容。'
        : step.caption || '跟着亮起的区域，一步步看看。';
      controls.back.hidden = index === 0;
      controls.restart.hidden = true;
      controls.next.textContent =
        index === steps.length - 1 ? '探索完成 ✓' : step.action?.label || '下一步 →';
      controls.exit.textContent = '稍后继续';
      controls.secondary.hidden = false;
      controls.progress.hidden = false;
      controls.progress.setAttribute('aria-valuemax', String(steps.length));
      controls.progress.setAttribute('aria-valuenow', String(index + 1));
      controls.progress.replaceChildren(
        ...steps.map((unused, i) => element('span', i <= index ? 'is-past' : '')),
      );
      const groups = steps.filter((entry, i) => i === 0 || entry.station !== steps[i - 1].station);
      controls.stations.replaceChildren(
        ...groups.map((entry) => {
          const option = element('option', '', entry.label);
          option.value = String(steps.indexOf(entry));
          option.selected = entry.station === step.station;
          return option;
        }),
      );
      setBusy(false);
      clearError();
      showDialog();
      if (targetMissing) showError(new Error('该区域暂不可用。'), () => showStep(index));
      if (typeof win.MutationObserver === 'function') {
        domObserver = new win.MutationObserver(() => {
          scheduleLayout();
        });
        domObserver.observe(doc.body, { subtree: true, childList: true });
      }
    }
    async function runUi(operation, retry) {
      if (busy) return;
      const epoch = viewEpoch;
      setBusy(true);
      clearError();
      try {
        await operation(() => epoch === viewEpoch && !blockedSession);
      } catch (error) {
        if (epoch === viewEpoch && error.name !== 'AbortError') showError(error, retry);
      } finally {
        if (epoch === viewEpoch) setBusy(false);
      }
    }
    async function save(patch) {
      const next = await client.save(
        version === VERSION && pendingTask ? { ...patch, completedTasks: [pendingTask] } : patch,
      );
      if (version === VERSION) pendingTask = null;
      renderTasks();
      return next;
    }
    async function navigateOrShow(index) {
      const step = steps[index];
      if (path() === step.route) {
        await showStep(index);
        return;
      }
      const context = routeContext();
      if ((step.route === '/course' || step.route === '/knowledge') && !context[step.route]) {
        const fallback =
          STATIONS.find((station) => station.id === step.station)?.fallbackRoute || '/world';
        const start = Math.max(
          0,
          steps.findIndex((entry) => entry.route === fallback),
        );
        await client.save({ status: 'in_progress', step: start });
        win.location.assign(tourUrl(start, version, context));
        return;
      }
      win.location.assign(tourUrl(index, version, context));
    }
    async function begin(index, restart = false) {
      await runUi(
        async (valid) => {
          if (blockedSession) throw new Error('登录状态已变化，请刷新页面后再开始。');
          if (!client.isLoaded()) await client.load();
          if (!valid()) return;
          await save({
            status: 'in_progress',
            step: index,
            ...(restart || client.snapshot().status === 'completed' ? { restart: true } : {}),
          });
          if (valid()) await navigateOrShow(index);
        },
        () => begin(index, restart),
      );
    }
    async function goTo(index) {
      if (!Number.isInteger(index) || !steps[index]) return;
      await runUi(
        async (valid) => {
          await save({ status: 'in_progress', step: index });
          if (valid()) await navigateOrShow(index);
        },
        () => goTo(index),
      );
    }
    async function advance() {
      if (mode === 'welcome') {
        await begin(welcomeChoice, client.snapshot().status === 'completed');
        return;
      }
      if (activeIndex === steps.length - 1) {
        await complete();
        return;
      }
      const step = steps[activeIndex];
      if (!step.action) {
        await goTo(activeIndex + 1);
        return;
      }
      const index = activeIndex + 1;
      await runUi(async (valid) => {
        const button = visible(step.action.selector);
        if (!button) throw new Error('这个入口暂不可用，请重试或跳过此站。');
        let href;
        if (step.action.kind === 'link')
          href = safeGuideHref(
            button.getAttribute('href'),
            win.location.origin,
            steps[index].route,
          );
        await save({ status: 'in_progress', step: index });
        if (!valid()) return;
        if (href) {
          rememberRoute(href);
          win.location.assign(tourUrl(index, version, routeContext()));
          return;
        }
        if (dialog.open) dialog.close();
        const before = new Set(doc.querySelectorAll('dialog[open]'));
        button.click();
        rememberOpenDialogs(before);
        await navigateOrShow(index);
      }, advance);
    }
    async function skipStation() {
      const next = steps.findIndex(
        (entry, index) => index > activeIndex && entry.station !== steps[activeIndex].station,
      );
      if (next < 0) await complete();
      else await goTo(next);
    }
    async function complete() {
      await runUi(async (valid) => {
        await save({ status: 'completed', step: steps.length - 1 });
        if (version === VERSION && releases.LATEST_RELEASE) {
          const latest = progressClient(releases.LATEST_RELEASE.id);
          if (!latest.isLoaded()) await latest.load();
          if (!valid()) return;
          await latest.save({
            status: 'completed',
            step: Math.max(0, stepsFor(releases.LATEST_RELEASE.id).length - 1),
          });
        }
        if (!valid()) return;
        closeUi();
        stripTourFlag();
        renderTasks();
      }, complete);
    }
    async function openManual(requestedVersion = VERSION, stationId = null) {
      if (dialog?.open || hasBlockingModal(doc, win, dialog)) return;
      stopDeferredPresentation();
      chooseVersion(requestedVersion);
      welcome();
      await runUi(
        async (valid) => {
          if (!client.isLoaded()) await client.load();
          if (!valid()) return;
          if (stationId) {
            const index = steps.findIndex((step) => step.station === stationId);
            if (index >= 0) {
              await save({ status: 'in_progress', step: index, restart: true });
              if (valid()) await navigateOrShow(index);
              return;
            }
          }
          welcome();
        },
        () => {
          closeUi();
          return openManual(requestedVersion, stationId);
        },
      );
    }
    async function refresh() {
      owner = '';
      await initialize();
    }
    async function present(progress, { automatic = false } = {}) {
      if (doc.visibilityState === 'hidden' || hasBlockingModal(doc, win, dialog)) {
        deferredPresentation = true;
        if (!deferredObserver && typeof win.MutationObserver === 'function') {
          deferredObserver = new win.MutationObserver(resumeWhenSafe);
          deferredObserver.observe(pageBody, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'hidden', 'open', 'aria-hidden', 'style'],
          });
        }
        return;
      }
      stopDeferredPresentation();
      const requested = new URL(win.location.href).searchParams.get('guideTour') === '1';
      if (
        requested &&
        progress.status === 'in_progress' &&
        steps[progress.step]?.route === path()
      ) {
        await showStep(progress.step);
      } else if (requested || automatic) {
        stripTourFlag();
        welcome();
        if (!progress.seenAt) await save({});
        // The full tour includes this release, so new users receive one invitation, not two.
        if (version === VERSION && automatic && releases.LATEST_RELEASE) {
          const latest = progressClient(releases.LATEST_RELEASE.id);
          if (!latest.isLoaded()) await latest.load();
          if (!latest.snapshot().seenAt) await latest.save({});
        }
      }
      if (
        pendingTask &&
        baseClient.isLoaded() &&
        !baseClient.snapshot().completedTasks.includes(pendingTask)
      ) {
        await baseClient.save({ completedTasks: [pendingTask] });
        pendingTask = null;
      }
      renderTasks();
    }
    function resumeWhenSafe() {
      if (!deferredPresentation || blockedSession) return;
      win.cancelAnimationFrame(deferredFrame);
      deferredFrame = win.requestAnimationFrame(() => {
        if (!hasBlockingModal(doc, win, dialog) && doc.visibilityState !== 'hidden') refresh();
      });
    }
    async function initialize() {
      initEpoch += 1;
      const epoch = initEpoch;
      await Promise.resolve(app.sessionReady).catch(() => {});
      if (epoch !== initEpoch || blockedSession) return;
      const current = `${identity().key}:${identity().token}`;
      if (current === owner && baseClient.isLoaded()) return;
      if (owner && current !== owner) {
        closeUi();
        stripTourFlag();
        clients.forEach((entry) => entry.reset());
      }
      owner = current;
      pendingTask = taskForPath(path());
      clearError();
      try {
        const base = await baseClient.load();
        if (epoch !== initEpoch) return;
        const params = new URL(win.location.href).searchParams;
        const requested = params.get('guideTour') === '1';
        const requestedVersion = params.get('guideVersion');
        let automatic = false;
        let chosen = VERSION;
        if (requested && knownVersion(requestedVersion)) chosen = requestedVersion;
        else if (!requested && isMember() && AUTO_WELCOME_PATHS.has(path())) {
          let legacySeen = false;
          if (!base.seenAt) {
            for (const legacy of releases.LEGACY_GUIDE_VERSIONS) {
              const previous = await app.callApi(
                `/onboarding?version=${encodeURIComponent(legacy)}`,
                {
                  method: 'GET',
                  headers: { Authorization: `Bearer ${identity().token}` },
                },
              );
              if (epoch !== initEpoch) return;
              legacySeen ||= Boolean(previous.seenAt);
            }
          }
          if (!base.seenAt && !legacySeen) automatic = true;
          else if (releases.LATEST_RELEASE) {
            const latest = progressClient(releases.LATEST_RELEASE.id);
            const state = await latest.load();
            if (epoch !== initEpoch) return;
            if (!state.seenAt) {
              chosen = releases.LATEST_RELEASE.id;
              automatic = true;
            }
          }
        }
        chooseVersion(chosen);
        const progress = client.isLoaded() ? client.snapshot() : await client.load();
        if (epoch !== initEpoch) return;
        await present(progress, { automatic });
        clearError();
        renderTasks();
      } catch (error) {
        if (epoch === initEpoch && error.name !== 'AbortError') showError(error, refresh);
      }
    }
    installEntries();
    renderTasks();
    doc.addEventListener('click', (event) => {
      const release = event.target.closest('[data-guide-release]');
      const station = event.target.closest('[data-guide-station]');
      if (release) {
        event.preventDefault();
        openManual(releases.LATEST_RELEASE?.id);
      } else if (station) {
        event.preventDefault();
        openManual(VERSION, station.dataset.guideStation);
      } else if (event.target.closest('[data-guide-start]')) {
        event.preventDefault();
        openManual();
      }
    });
    doc.addEventListener('visibilitychange', resumeWhenSafe);
    win.addEventListener('resize', () => {
      if (target && steps[activeIndex]) frameTarget(steps[activeIndex]);
      scheduleLayout();
    });
    win.addEventListener('scroll', scheduleLayout, { passive: true });
    win.visualViewport?.addEventListener('resize', scheduleLayout);
    win.addEventListener('freebbs:session-change', () => {
      blockedSession = false;
      initEpoch += 1;
      closeUi();
      clients.forEach((entry) => entry.reset());
      owner = '';
      initialize();
    });
    win.addEventListener('storage', (event) => {
      if (event.key !== 'free_bbs_auth_token' && event.key !== null) return;
      blockedSession = true;
      initEpoch += 1;
      closeUi();
      stripTourFlag();
      clients.forEach((entry) => entry.reset());
      owner = '';
      pendingTask = null;
      showError(new Error('账号已变化，请刷新后继续。'), () => win.location.reload());
    });
    win.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      closeUi();
      clients.forEach((entry) => entry.reset());
      owner = '';
      initialize();
    });
    initialize();
    return {
      start: openManual,
      pause,
      refresh,
      snapshot: () => client.snapshot(),
      get activeStep() {
        return activeIndex;
      },
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      VERSION,
      FLOATING_PATHS,
      hasBlockingModal,
      initialGuideDecision,
      TASKS,
      STEPS,
      STATIONS,
      emptyProgress,
      normalizeProgress,
      mergeGuest,
      taskForPath,
      tourUrl,
      safeGuideHref,
      tourGeometry,
      stepsFor,
      createProgressClient,
      createController,
    };
  }
  if (typeof window !== 'undefined' && window.freeBbsApp && !window.freeBbsMaxGuide) {
    window.freeBbsMaxGuide = createController(window, document, window.freeBbsApp);
  }
})();
