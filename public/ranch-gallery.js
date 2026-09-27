((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.FreeBbsRanchGallery = api;
    api.boot();
  }
})(typeof window === 'undefined' ? globalThis : window, () => {
  const hashSeed = (value) => {
    let hash = 2166136261;
    for (const character of String(value || '')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  const layoutFor = (uid, index, total) => {
    const seed = hashSeed(uid);
    const lanes = Math.max(4, Math.min(9, Math.ceil(Math.sqrt(Math.max(1, total)) * 1.45)));
    const lane = index % lanes;
    const depth = lanes === 1 ? 0.5 : lane / (lanes - 1);
    const column = Math.floor(index / lanes);
    const columns = Math.max(1, Math.ceil((total - lane) / lanes));
    const offset = 0.15 + ((lane * 0.381966 + (seed % 1000) / 1000) % 1) * 0.7;
    return {
      top: 59 + depth * 21,
      scale: 0.64 + depth * 0.4,
      start: Math.max(3, Math.min(97, ((column + offset) / columns) * 100)),
      direction: seed % 2 ? 1 : -1,
      zIndex: 20 + lane,
    };
  };

  const pickPartner = (actors, selected) => {
    if (!selected || actors.length < 2) return null;
    const selectedBox = selected.element.getBoundingClientRect();
    return actors
      .filter((actor) => actor !== selected)
      .map((actor) => {
        const box = actor.element.getBoundingClientRect();
        return {
          actor,
          distance: Math.hypot(
            box.left + box.width / 2 - (selectedBox.left + selectedBox.width / 2),
            box.top + box.height / 2 - (selectedBox.top + selectedBox.height / 2),
          ),
        };
      })
      .sort((left, right) => left.distance - right.distance)[0]?.actor;
  };

  const ranchHref = (uid) => `/ranch?uid=${encodeURIComponent(uid)}`;

  function boot() {
    const field = document.getElementById('community-pasture');
    const flock = document.getElementById('community-flock');
    const status = document.getElementById('gallery-status');
    const dock = document.getElementById('community-interaction');
    const selectedName = document.getElementById('community-selected-name');
    const selectedDetail = document.getElementById('community-selected-detail');
    const visit = document.getElementById('community-visit');
    const sceneSelect = document.getElementById('community-scene');
    if (!field || !flock || !status || !dock || !window.FreeBbsMaxRanch) return;

    const actors = [];
    const seen = new Set();
    const cursors = new Set();
    let selected = null;
    let interactions = 0;
    let autoTimer = null;
    let stopped = false;

    const viewerUid = () => window.freeBbsApp?.userState?.uid || '';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const baseUrl = () => window.freeBbsApp?.apiBaseUrl || window.FREEBBS_API_BASE || '/api';

    function configureScene(scene) {
      const environment = window.FreeBbsRanchEnvironment;
      if (!environment) return;
      const valid = environment.validScene(scene);
      field.style.setProperty(
        '--community-scene',
        `url("${environment.photo(valid, environment.seasonAt())}")`,
      );
      document.body.style.setProperty(
        '--community-scene',
        `url("${environment.photo(valid, environment.seasonAt())}")`,
      );
      field.dataset.scene = valid;
      if (sceneSelect) sceneSelect.value = valid;
    }

    if (window.FreeBbsRanchEnvironment) {
      const environment = window.FreeBbsRanchEnvironment;
      configureScene(environment.readScene(window.localStorage));
      sceneSelect?.addEventListener('change', () => {
        const scene = environment.validScene(sceneSelect.value);
        try {
          window.localStorage.setItem(environment.storageKey, scene);
        } catch {
          /* The pasture remains usable when storage is unavailable. */
        }
        configureScene(scene);
      });
    }

    function announce(actor, message, duration = 2600) {
      const bubble = actor.element.querySelector('.community-sheep-bubble');
      bubble.textContent = message;
      bubble.hidden = false;
      window.clearTimeout(actor.bubbleTimer);
      actor.bubbleTimer = window.setTimeout(() => {
        bubble.hidden = true;
      }, duration);
    }

    function selectActor(actor, focusDock = true) {
      selected?.element.classList.remove('is-selected');
      if (selected && selected !== actor) selected.controller?.pause(false);
      selected = actor;
      actor.element.classList.add('is-selected');
      actor.controller?.pause(true);
      selectedName.textContent = actor.sheep.username;
      const mine = actor.sheep.uid === viewerUid();
      selectedDetail.textContent = mine ? '这是你的 Max' : '正在牧场里散步';
      visit.href = ranchHref(actor.sheep.uid);
      visit.textContent = mine ? '回我的牧场' : '逛逛 TA 的牧场';
      dock.hidden = false;
      if (focusDock) dock.querySelector('button')?.focus({ preventScroll: true });
    }

    function interact(kind, actor = selected) {
      if (!actor) return;
      const partner = pickPartner(actors, actor);
      actor.controller?.greet();
      actor.element.classList.add('is-interacting');
      if (kind === 'stroll') {
        announce(actor, '一起走走？');
        actor.controller?.celebrate('feed');
      } else if (kind === 'pet') {
        announce(actor, '咩～');
        actor.controller?.celebrate('feed');
      } else {
        announce(actor, '你好呀');
      }
      if (partner) {
        window.setTimeout(
          () => {
            if (kind !== 'stroll') partner.controller?.greet();
            partner.element.classList.add('is-interacting');
            announce(partner, kind === 'stroll' ? '出发！' : '咩～你好');
          },
          reducedMotion.matches ? 0 : 260,
        );
        window.setTimeout(() => partner.element.classList.remove('is-interacting'), 3000);
        interactions += 1;
        if (actor === selected)
          selectedDetail.textContent = `刚刚和 ${partner.sheep.username} 互动了`;
        status.textContent = `${actors.length} 只羊正在散步 · 本次已发生 ${interactions} 次相遇`;
        if (kind === 'stroll') {
          const layout = layoutFor(actor.sheep.uid, actors.indexOf(actor), actors.length);
          partner.lane.style.setProperty('--lane-top', `${layout.top}%`);
          partner.lane.style.setProperty('--sheep-scale', String(layout.scale));
          const middle = (actor.controller.snapshot().x + partner.controller.snapshot().x) / 2;
          const gap = actor.element.clientWidth * 0.8;
          actor.controller.walkTo(Math.max(0, middle - gap / 2));
          partner.controller.walkTo(middle + gap / 2);
        }
      }
      window.setTimeout(() => actor.element.classList.remove('is-interacting'), 3000);
    }

    function createActor(sheep, index, total) {
      const layout = layoutFor(sheep.uid, index, total);
      const lane = document.createElement('div');
      lane.className = 'community-sheep-lane';
      lane.style.setProperty('--lane-top', `${layout.top}%`);
      lane.style.setProperty('--sheep-scale', String(layout.scale));
      lane.style.zIndex = String(layout.zIndex);

      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'community-sheep';
      element.setAttribute('aria-label', `和 ${sheep.username} 的羊互动`);
      lane.append(element);
      flock.append(lane);

      const actor = { sheep, element, lane, controller: null, bubbleTimer: null };
      const available = Math.max(0, lane.clientWidth - element.clientWidth);
      actor.controller = window.FreeBbsMaxRanch.mount(element, {
        x: (available * layout.start) / 100,
        direction: layout.direction,
      });
      window.FreeBbsRanchDesign?.apply(element, sheep.design);
      const name = document.createElement('span');
      name.className = 'community-sheep-name';
      name.textContent = sheep.username;
      const bubble = document.createElement('span');
      bubble.className = 'community-sheep-bubble';
      bubble.hidden = true;
      element.append(name, bubble);
      element.querySelector('svg').setAttribute('aria-hidden', 'true');
      element.addEventListener('click', () => {
        selectActor(actor);
        interact('greet', actor);
      });
      element.addEventListener('pointerenter', () => actor.controller?.pause(true));
      element.addEventListener('pointerleave', () => {
        if (actor !== selected) actor.controller?.pause(false);
      });
      element.addEventListener('focus', () => actor.controller?.pause(true));
      element.addEventListener('blur', () => {
        if (actor !== selected) actor.controller?.pause(false);
      });
      actors.push(actor);
    }

    function relayout() {
      const total = actors.length;
      actors.forEach((actor, index) => {
        const layout = layoutFor(actor.sheep.uid, index, total);
        actor.lane.style.setProperty('--lane-top', `${layout.top}%`);
        actor.lane.style.setProperty('--sheep-scale', String(layout.scale));
        actor.lane.style.zIndex = String(layout.zIndex);
      });
    }

    async function loadFlock() {
      let next = null;
      try {
        do {
          const url = `${baseUrl()}/ranch-designs${next ? `?before=${encodeURIComponent(next)}` : ''}`;
          const response = await fetch(url);
          if (!response.ok) throw new Error('羊群暂时走远了，请稍后再来。');
          const result = await response.json();
          const fresh = (Array.isArray(result.sheep) ? result.sheep : []).filter(
            (sheep) => sheep?.uid && sheep?.username && !seen.has(sheep.uid),
          );
          fresh.forEach((sheep) => seen.add(sheep.uid));
          const offset = actors.length;
          const total = offset + fresh.length;
          fresh.forEach((sheep, index) => createActor(sheep, offset + index, total));
          relayout();
          next = result.next || null;
          status.textContent = actors.length
            ? `${actors.length} 只羊正在赶来${next ? '…' : ' · 点击一只和它互动'}`
            : '还没有人领养羊，你可以成为第一位牧场主人。';
          if (!next || cursors.has(next)) break;
          cursors.add(next);
        } while (!stopped);
      } catch (error) {
        status.textContent = actors.length
          ? `${actors.length} 只羊已经到场 · 还有一些羊暂时迷路了`
          : error.message;
      }
    }

    function scheduleAutoInteraction() {
      window.clearTimeout(autoTimer);
      if (reducedMotion.matches || document.hidden || actors.length < 2) return;
      autoTimer = window.setTimeout(
        () => {
          const actor = actors[Math.floor(Math.random() * actors.length)];
          interact('greet', actor);
          scheduleAutoInteraction();
        },
        9000 + Math.random() * 5000,
      );
    }

    dock
      .querySelector('[data-community-action="greet"]')
      ?.addEventListener('click', () => interact('greet'));
    dock
      .querySelector('[data-community-action="stroll"]')
      ?.addEventListener('click', () => interact('stroll'));
    dock
      .querySelector('[data-community-action="pet"]')
      ?.addEventListener('click', () => interact('pet'));
    dock.querySelector('[data-community-close]')?.addEventListener('click', () => {
      selected?.element.classList.remove('is-selected');
      selected?.controller?.pause(false);
      selected = null;
      dock.hidden = true;
    });
    document.addEventListener('visibilitychange', scheduleAutoInteraction);
    reducedMotion.addEventListener('change', scheduleAutoInteraction);
    window.addEventListener('pagehide', (event) => {
      window.clearTimeout(autoTimer);
      if (event.persisted) return;
      stopped = true;
      actors.forEach((actor) => {
        window.clearTimeout(actor.bubbleTimer);
        actor.controller?.destroy();
      });
    });
    window.addEventListener('pageshow', scheduleAutoInteraction);
    loadFlock().finally(scheduleAutoInteraction);
  }

  return { boot, hashSeed, layoutFor, pickPartner, ranchHref };
});
