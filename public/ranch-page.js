(() => {
  const environment = window.FreeBbsRanchEnvironment;
  let currentScene = 'meadow';
  try {
    currentScene = environment.readScene(localStorage);
  } catch {
    /* Storage is optional. */
  }
  let midnightTimer;
  let openPanel = null;
  // Keep filtered scenery outside the scrolling navigation: Safari may otherwise
  // clip its fixed-position search and account controls to the sidebar bounds.
  if (document.body.classList.contains('ranch-page')) {
    const sidebarBackdrop = document.createElement('div');
    sidebarBackdrop.className = 'ranch-sidebar-backdrop';
    sidebarBackdrop.setAttribute('aria-hidden', 'true');
    document.body.append(sidebarBackdrop);
  }
  function syncEnvironment(root) {
    const season = environment.seasonAt();
    const period = document.body.classList.contains('theme-light') ? 'day' : 'night';
    const update = (element) => {
      element.dataset.ranchSeason = season;
      element.dataset.ranchScene = currentScene;
      element.dataset.ranchPeriod = period;
      element.style.setProperty(
        '--ranch-photo',
        `url("${environment.photo(currentScene, season)}")`,
      );
    };
    update(root);
    if (document.body.classList.contains('ranch-page')) {
      update(document.body);
    }
    const caption = root.querySelector('[data-season-caption]');
    if (caption)
      caption.textContent = `北京 · ${environment.seasons[season]} · ${period === 'day' ? '白天' : '夜晚'}`;
    root.querySelectorAll('[data-ranch-scene-choice]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.ranchSceneChoice === currentScene));
    });
  }
  function refreshEnvironment() {
    if (document.body.classList.contains('ranch-page')) syncEnvironment(document.body);
    document.querySelectorAll('.ranch-photographic').forEach(syncEnvironment);
    clearTimeout(midnightTimer);
    if (!document.hidden)
      midnightTimer = setTimeout(refreshEnvironment, environment.nextMidnight() + 50);
  }
  function panel(id, title) {
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = 'ranch-drawer';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.innerHTML = `<header><h2 id="${id}-title">${title}</h2><button type="button" data-ranch-close aria-label="关闭">×</button></header>`;
    dialog.addEventListener('close', () => {
      if (dialog.isConnected && openPanel === id) openPanel = null;
    });
    return dialog;
  }
  function present(root, state, profile, isOwner) {
    const full = document.body.classList.contains('ranch-page');
    const ranch = state.ranch || {};
    const scene = root.querySelector('.ranch-scene');
    const message = root.querySelector('#profile-extras-message');
    const uid = encodeURIComponent(profile?.uid || '');
    root.classList.add('ranch-photographic');
    root.classList.toggle('ranch-preview', !full);
    const scenery = document.createElement('div');
    scenery.className = 'ranch-scenery';
    scenery.setAttribute('aria-hidden', 'true');
    const nightSky = document.createElement('div');
    nightSky.className = 'ranch-night-sky';
    nightSky.setAttribute('aria-hidden', 'true');
    scene.prepend(scenery, nightSky);
    const status = !ranch.adopted
      ? '一片草地，等待 Max 搬进来'
      : ranch.hungry
        ? 'Max 在等一条小鱼'
        : 'Max 正在草地上散步';
    if (!full) {
      const link = document.createElement('a');
      link.className = 'ranch-preview-link';
      link.href = `/ranch?uid=${uid}`;
      link.setAttribute('aria-label', '进入电子牧场');
      const caption = document.createElement('div');
      caption.className = 'ranch-preview-caption';
      caption.innerHTML =
        '<span><strong>Max 的电子牧场</strong><small></small></span><span aria-hidden="true">走进牧场 ↗</span>';
      caption.querySelector('small').textContent = status;
      link.append(scene, caption);
      root.replaceChildren(link, message);
    } else {
      // Separate photo/atmosphere layers keep animation off the controls and actor.
      const atmosphere = document.createElement('div');
      atmosphere.className = 'ranch-atmosphere';
      atmosphere.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < 7; index += 1) {
        const mote = document.createElement('i');
        mote.style.setProperty('--mote-index', index);
        atmosphere.append(mote);
      }
      scene.append(atmosphere);
      scene.classList.toggle('is-background-hidden', document.hidden);
      const heading = document.createElement('div');
      heading.className = 'ranch-scene-heading';
      heading.innerHTML = `<a class="ranch-back" href="/profile?uid=${uid}">‹ 个人主页</a><div><h2>Max 的电子牧场</h2><p data-season-caption title="季节按北京月份自动变化；亮色为白天，暗色为夜晚"></p></div><div class="ranch-scene-picker" role="group" aria-label="切换牧场场景">${Object.entries(
        environment.scenes,
      )
        .map(
          ([key, value]) =>
            `<button type="button" data-ranch-scene-choice="${key}" aria-label="${value[1]}">${value[0]}</button>`,
        )
        .join('')}</div>`;
      const controls = document.createElement('div');
      const gallery = document.createElement('a');
      gallery.className = 'ranch-back ranch-gallery-link';
      gallery.href = '/ranch-gallery';
      gallery.textContent = '羊群广场 ↗';
      heading.querySelector('.ranch-back').after(gallery);
      controls.className = 'ranch-scene-actions';
      const feed = root.querySelector('[data-extra-action="feed"]');
      if (feed) controls.append(feed);
      const greet = root.querySelector('[data-ranch-greet]');
      if (greet) controls.append(greet);
      const wool = root.querySelector('.ranch-wool');
      const rodLink = wool?.querySelector('.ranch-wool-tool a');
      if (rodLink && isOwner) {
        const buyRod = document.createElement('button');
        buyRod.type = 'button';
        buyRod.dataset.action = 'inspect-item';
        buyRod.dataset.itemKey = 'rubber_rod';
        buyRod.className = 'ranch-buy-rod';
        buyRod.textContent = '购买橡胶棒 · 查看价格';
        rodLink.replaceWith(buyRod);
      }
      const drawer = panel('ranch-wool-dialog', '羊毛与收藏');
      if (wool) drawer.append(wool);
      drawer.append(root.querySelector('.ranch-bone-summary'));
      const rules = root.querySelector('.ranch-rules');
      if (rules) drawer.append(rules);
      controls.insertAdjacentHTML(
        'beforeend',
        '<button type="button" data-ranch-open="ranch-wool-dialog">羊毛与收藏</button>',
      );
      const shop = panel('ranch-shop-dialog', '牧场补给');
      if (isOwner) {
        shop.insertAdjacentHTML(
          'beforeend',
          '<p>在这里补充用品，无需离开牧场。点击物品查看当前价格并确认购买。</p><div class="ranch-supplies"><button type="button" data-action="inspect-item" data-item-key="fish"><img src="/assets/icons/fish.svg" alt=""/><span>小鱼<small>喂养 Max</small></span><span aria-hidden="true">›</span></button><button type="button" data-action="inspect-item" data-item-key="rubber_rod"><img src="/assets/shop/max-cartoon-v1/rubber_rod.webp" alt=""/><span>橡胶棒<small>羊毛摩擦起电</small></span><span aria-hidden="true">›</span></button><button type="button" data-action="inspect-item" data-item-key="max_pet"><img src="/assets/shop/max-cartoon-v1/max_pet.webp" alt=""/><span>电子羊 Max<small>请伙伴搬进牧场</small></span><span aria-hidden="true">›</span></button></div>',
        );
        controls.insertAdjacentHTML(
          'beforeend',
          '<button type="button" data-ranch-open="ranch-shop-dialog">牧场补给</button>',
        );
        for (const [key, name, hint] of [
          ['ranch_gold_horn', '金角', '20 磁元／只'],
          ['ranch_silver_horn', '银角', '10 磁元／只'],
          ['ranch_backflip', '后空翻', '12 磁元 · 永久解锁'],
          ['ranch_bicycle', '牧场自行车', '20 磁元 · 永久解锁'],
          ['ranch_flying_wings', '中国羊能飞', '25 磁元 · 永久解锁'],
          ['ranch_clover', '三叶草', '1 磁元／个 · 羊群广场使用'],
        ])
          shop
            .querySelector('.ranch-supplies')
            .insertAdjacentHTML(
              'beforeend',
              `<button type="button" data-action="inspect-item" data-item-key="${key}"><img src="/assets/shop/max-cartoon-v1/${key}.webp" alt=""/><span>${name}<small>${hint}</small></span><span aria-hidden="true">›</span></button>`,
            );
      }
      const compactLabels = [
        ['[data-extra-action="feed"]', `喂养 ${Math.max(0, Number(state.fish) || 0)}`],
        ['[data-ranch-greet]', '招呼'],
        ['[data-ranch-open="ranch-wool-dialog"]', '羊毛'],
        ['[data-ranch-open="ranch-shop-dialog"]', '补给'],
      ];
      if (isOwner && ranch.adopted) {
        const dye = document.createElement('button');
        dye.type = 'button';
        dye.textContent = '羊的染坊';
        dye.dataset.compactLabel = '染坊';
        dye.addEventListener('click', () => {
          window.location.href = '/ranch-dye';
        });
        controls.append(dye);
      }
      for (const [selector, label] of compactLabels) {
        const button = controls.querySelector(selector);
        if (!button) continue;
        button.dataset.compactLabel = label;
        button.setAttribute('aria-label', button.textContent);
        button.title = button.textContent;
      }
      const pause = root.querySelector('[data-ranch-pause]');
      pause.classList.add('ranch-scene-pause');
      pause.title = '暂停或继续羊的漫步与场景动态';
      scene.classList.toggle('is-paused', pause.getAttribute('aria-pressed') === 'true');
      const description = document.createElement('p');
      description.className = 'ranch-scene-status';
      description.textContent = root.querySelector('.ranch-satiety')?.textContent || status;
      scene.append(heading, pause, description, controls, message);
      root.replaceChildren(scene, drawer, shop);
      if (!isOwner && openPanel === 'ranch-shop-dialog') openPanel = null;
    }
    syncEnvironment(root);
    refreshEnvironment();
  }
  function restorePanel(root) {
    const dialog = openPanel && root.querySelector(`#${openPanel}`);
    if (dialog && !dialog.open) dialog.showModal();
  }
  document.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-ranch-scene-choice]');
    if (choice) {
      currentScene = environment.validScene(choice.dataset.ranchSceneChoice);
      refreshEnvironment();
      try {
        localStorage.setItem(environment.storageKey, currentScene);
      } catch {
        /* Optional preference. */
      }
    }
    const trigger = event.target.closest('[data-ranch-open]');
    if (trigger) {
      openPanel = trigger.dataset.ranchOpen;
      restorePanel(trigger.closest('.profile-ranch'));
    }
    if (event.target.closest('[data-ranch-close], .ranch-drawer [data-action="inspect-item"]')) {
      event.target.closest('dialog')?.close();
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) openPanel = null;
    if (event.key === environment.storageKey || event.key === null) {
      currentScene = environment.validScene(event.newValue);
      refreshEnvironment();
    }
  });
  document.addEventListener('visibilitychange', () => {
    refreshEnvironment();
    document.querySelectorAll('.ranch-page .ranch-scene').forEach((scene) => {
      scene.classList.toggle('is-background-hidden', document.hidden);
    });
  });
  window.addEventListener('pageshow', refreshEnvironment);
  window.addEventListener('focus', refreshEnvironment);
  new MutationObserver(refreshEnvironment).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
  window.FreeBbsRanchPage = { present, restorePanel };
  refreshEnvironment();
})();
