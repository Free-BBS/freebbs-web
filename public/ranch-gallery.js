(() => {
  const world = window.FreeBbsRanchWorld;
  const byId = (id) => document.getElementById(id);
  const field = byId('community-pasture');
  const flock = byId('community-flock');
  const status = byId('gallery-status');
  const dock = byId('community-interaction');
  const sceneSelect = byId('community-scene');
  const findMine = byId('community-find-mine');
  const gearSelect = byId('community-gear');
  const gearControl = byId('community-gear-control');
  const cloverButton = byId('community-clover');
  const cloverLabel = cloverButton.querySelector('span');
  const windStatus = byId('community-wind-status');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const actors = new Map();
  let state;
  let selected;
  let offset = 0;
  let stream;
  let frame;
  let stopped = false;
  let submitting = false;
  let cloverCount = 0;
  let lastSnapshot = 0;
  const viewerUid = () => window.freeBbsApp?.userState?.uid || '';
  const baseUrl = () => window.freeBbsApp?.apiBaseUrl || window.FREEBBS_API_BASE || '/api';
  function renderClover(time) {
    const clover = state?.events?.find(
      (event) => event.kind === 'clover' && time < event.start + event.duration,
    );
    const windy = clover && time < clover.start + 3000;
    field.classList.toggle('is-clover-windy', Boolean(windy));
    windStatus.hidden = !clover;
    if (clover)
      windStatus.textContent = windy ? '三叶草起风 · 空中的羊正被吹走' : '风停了 · 羊群正飘回来';
    cloverButton.disabled = submitting || Boolean(clover);
    const label = cloverCount ? `三叶草 ×${cloverCount}` : '三叶草 · 2 磁元';
    if (cloverLabel.textContent !== label) cloverLabel.textContent = label;
    cloverButton.title = clover
      ? '等羊群飘回来后可以再用一片'
      : cloverCount
        ? '消耗一片：未来 3 秒内吹飞空中的羊，5 秒后飘回'
        : '到商店购买三叶草，每片 2 磁元';
  }
  async function refreshClovers() {
    await window.freeBbsApp?.sessionReady;
    if (!window.freeBbsApp?.userState?.isLoggedIn) {
      cloverCount = 0;
      cloverButton.hidden = false;
      renderClover(state?.serverNowMs || Date.now());
      return;
    }
    try {
      const result = await window.freeBbsApp.callApi('/ranch-world/clovers');
      cloverCount = Math.max(0, Number(result.quantity) || 0);
      cloverButton.hidden = false;
      renderClover(state?.serverNowMs || Date.now());
    } catch {
      cloverButton.hidden = true;
    }
  }
  function configureScene(scene) {
    const environment = window.FreeBbsRanchEnvironment;
    const valid = environment.validScene(scene);
    const photo = `url("${environment.photo(valid, environment.seasonAt(state?.serverNowMs))}")`;
    field.style.setProperty('--community-scene', photo);
    document.body.style.setProperty('--community-scene', photo);
    field.dataset.scene = valid;
    sceneSelect.value = valid;
  }
  function selectActor(actor) {
    selected?.element.classList.remove('is-selected');
    selected = actor;
    actor.element.classList.add('is-selected');
    byId('community-selected-name').textContent = actor.sheep.username;
    const mine = actor.sheep.uid === viewerUid();
    byId('community-selected-detail').textContent = mine
      ? `这是你的 Max · ${actor.sheep.gear === 'wing' ? '佩戴飞行翅膀' : actor.sheep.gear === 'bicycle' ? '装备自行车' : '步行'} · 所有人同步观看`
      : '公共牧场 · 所有人同步观看';
    const visit = byId('community-visit');
    visit.href = `/ranch?uid=${encodeURIComponent(actor.sheep.uid)}`;
    visit.textContent = mine ? '回我的牧场' : '逛逛 TA 的牧场';
    for (const kind of ['backflip', 'bicycle', 'fly'])
      dock.querySelector(`[data-community-action="${kind}"]`).hidden =
        !mine ||
        (kind === 'backflip'
          ? !actor.sheep.assets?.ranch_backflip
          : actor.sheep.gear !== (kind === 'fly' ? 'wing' : 'bicycle'));
    gearControl.hidden = !mine;
    gearSelect.querySelector('[value="bicycle"]').hidden = !actor.sheep.assets?.ranch_bicycle;
    gearSelect.querySelector('[value="bicycle"]').disabled = !actor.sheep.assets?.ranch_bicycle;
    gearSelect.querySelector('[value="wing"]').hidden = !actor.sheep.assets?.ranch_flying_wings;
    gearSelect.querySelector('[value="wing"]').disabled = !actor.sheep.assets?.ranch_flying_wings;
    gearSelect.value = actor.sheep.gear || 'walk';
    const stroll = dock.querySelector('[data-community-action="stroll"]');
    const own = actors.get(viewerUid());
    stroll.disabled =
      mine ||
      !own ||
      actor.sheep.fedUntilMs <= state.serverNowMs ||
      own.sheep.fedUntilMs <= state.serverNowMs;
    stroll.title = mine ? '点选另一只羊，让你的 Max 过去找它' : '让你的 Max 过来和这只羊一起散步';
    dock.hidden = false;
  }
  function createActor(sheep) {
    const lane = document.createElement('div');
    lane.className = 'community-sheep-lane';
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'community-sheep';
    lane.append(element);
    flock.append(lane);
    const controller = window.FreeBbsMaxRanch.mount(element, {
      shared: true,
      hungry: sheep.fedUntilMs <= state.serverNowMs,
    });
    const name = document.createElement('span');
    name.className = 'community-sheep-name';
    const bubble = document.createElement('span');
    bubble.className = 'community-sheep-bubble';
    bubble.hidden = true;
    element.append(name, bubble);
    element.querySelector('svg').setAttribute('aria-hidden', 'true');
    const actor = { sheep, lane, element, controller, name, bubble, revision: -1 };
    element.addEventListener('click', () => selectActor(actor));
    actors.set(sheep.uid, actor);
    return actor;
  }
  function update(result) {
    if (stopped || !Array.isArray(result.sheep) || (state && result.revision < state.revision))
      return;
    offset = result.serverNowMs - Date.now();
    lastSnapshot = Date.now();
    state = result;
    configureScene(state.scene);
    const seen = new Set(state.sheep.map((sheep) => sheep.uid));
    for (const [uid, actor] of actors)
      if (!seen.has(uid)) {
        actor.controller.destroy();
        actor.lane.remove();
        actors.delete(uid);
        if (selected === actor) {
          selected = null;
          dock.hidden = true;
        }
      }
    state.sheep.forEach((sheep) => {
      const actor = actors.get(sheep.uid) || createActor(sheep);
      actor.sheep = sheep;
      actor.name.textContent = sheep.username;
      actor.element.setAttribute('aria-label', `和 ${sheep.username} 的羊互动`);
      if (actor.revision !== sheep.revision) {
        window.FreeBbsRanchDesign?.apply(actor.element, sheep.design);
        actor.revision = sheep.revision;
      }
    });
    if (selected) selectActor(selected);
    findMine.hidden = !actors.has(viewerUid());
    if (viewerUid())
      document.querySelectorAll('[data-own-ranch]').forEach((link) => {
        link.href = `/ranch?uid=${encodeURIComponent(viewerUid())}`;
      });
    status.textContent = state.sheep.length
      ? `${state.sheep.length} 只羊 · 实时同步`
      : '还没有人领养羊，你可以成为第一位牧场主人。';
    if (!frame) tick();
  }
  function tick() {
    frame = null;
    if (stopped || document.hidden || !state) return;
    const time = Math.min(Date.now(), lastSnapshot + 5000) + offset;
    const visibleEvents = reducedMotion.matches
      ? state.events.filter((event) => event.kind !== 'clover')
      : state.events;
    state.sheep.forEach((sheep, index) => {
      const actor = actors.get(sheep.uid);
      const point = world.positionFor(sheep, index, state.sheep, time, visibleEvents);
      actor.lane.style.setProperty('--lane-top', `${point.top}%`);
      actor.lane.style.setProperty('--sheep-scale', String(point.scale));
      actor.lane.style.zIndex = String(point.zIndex);
      actor.controller.syncFrame(point);
      actor.bubble.textContent =
        {
          greet: '你好呀',
          pet: '咩～',
          stroll: '一起走走',
          backflip: '后空翻！',
          bicycle: '骑车兜风',
          fly: '飞起来啦',
          clover: '被三叶草吹起来啦',
          hungry: '饿了，等一条鱼',
        }[point.kind] || '';
      actor.bubble.hidden = !actor.bubble.textContent;
      actor.element.classList.toggle('is-interacting', point.kind !== 'walk' && !point.hungry);
    });
    renderClover(time);
    frame = window.requestAnimationFrame(tick);
  }
  async function submit(kind, extra = {}) {
    if (submitting) return;
    await window.freeBbsApp?.sessionReady;
    if (!viewerUid()) {
      status.textContent = '登录后才能互动；观看牧场无需登录。';
      configureScene(state?.scene || 'meadow');
      return;
    }
    submitting = true;
    try {
      update(
        await window.freeBbsApp.callApi('/ranch-world/actions', {
          method: 'POST',
          body: JSON.stringify({
            kind,
            actor: kind === 'stroll' ? viewerUid() : selected?.sheep.uid,
            ...(kind === 'stroll' ? { target: selected?.sheep.uid } : {}),
            ...extra,
          }),
        }),
      );
      if (kind === 'clover') {
        cloverCount = Math.max(0, cloverCount - 1);
        refreshClovers();
      }
    } catch (error) {
      status.textContent = error.message || '同步失败，请重试';
      gearSelect.value = selected?.sheep.gear || 'walk';
      configureScene(state?.scene || 'meadow');
      if (kind === 'clover') refreshClovers();
    } finally {
      submitting = false;
    }
  }
  function connect() {
    stream?.close();
    stream = null;
    if (stopped || document.hidden) return;
    stream = new EventSource(`${baseUrl()}/ranch-world/stream`);
    stream.addEventListener('world', (event) => {
      try {
        update(JSON.parse(event.data));
      } catch {
        status.textContent = '同步数据暂不可用';
      }
    });
    stream.addEventListener('error', () => {
      status.textContent = '正在重新连接牧场…';
    });
    stream.addEventListener('unavailable', () => {
      status.textContent = '牧场同步暂不可用，稍后自动重试';
    });
  }
  dock
    .querySelectorAll('[data-community-action]')
    .forEach((button) =>
      button.addEventListener('click', () => submit(button.dataset.communityAction)),
    );
  gearSelect.addEventListener('change', () => submit('equip', { mode: gearSelect.value }));
  cloverButton.addEventListener('click', () => {
    if (!window.freeBbsApp?.userState?.isLoggedIn) {
      status.textContent = '登录后才能在牧场使用三叶草。';
      return;
    }
    if (!cloverCount) {
      window.location.href = '/electromagnetic';
      return;
    }
    submit('clover');
  });
  dock.querySelector('[data-community-close]').addEventListener('click', () => {
    selected?.element.classList.remove('is-selected');
    selected = null;
    dock.hidden = true;
  });
  sceneSelect.addEventListener('change', () => submit('scene', { scene: sceneSelect.value }));
  findMine.addEventListener('click', () => {
    const mine = actors.get(viewerUid());
    if (mine) selectActor(mine);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stream?.close();
      stream = null;
      window.cancelAnimationFrame(frame);
      frame = null;
    } else connect();
  });
  window.addEventListener('pagehide', (event) => {
    stream?.close();
    stream = null;
    window.cancelAnimationFrame(frame);
    frame = null;
    if (!event.persisted) {
      stopped = true;
      actors.forEach((actor) => actor.controller.destroy());
    }
  });
  window.addEventListener('pageshow', () => {
    if (!stream) connect();
    refreshClovers();
  });
  fetch(`${baseUrl()}/ranch-world`)
    .then((response) => {
      if (!response.ok) throw new Error('Unavailable');
      return response.json();
    })
    .then(update)
    .catch(() => {
      status.textContent = '正在连接公共牧场…';
    });
  connect();
  refreshClovers();
})();
