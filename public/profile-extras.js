(() => {
  const items = {
    frame_orbit: ['frame', '环流轨道'],
    frame_aurora: ['frame', '极光回路'],
    plate_maxwell: ['nameplate', '麦克斯韦亲传'],
    plate_observer: ['nameplate', 'BBS见习观察员'],
    plate_fishbone_master: ['nameplate', '鱼骨达人'],
    card_blueprint: ['card', '未完成的蓝图'],
    card_twilight: ['card', '暮色实验室'],
  };
  const pending = new Map();
  let profileData = null;
  let own = null;
  let busy = false;
  let renderRevision = 0;
  let actor = null;
  let satietyTimer;
  let sessionUid = '';
  const valid = (key, slot) => (items[key]?.[0] === slot ? key : '');
  const crests = {
    plate_maxwell:
      '<path d="M8 19c5-10 9-10 14 0s9 10 14 0M8 25c5-10 9-10 14 0s9 10 14 0"/><path d="M22 7v30" opacity=".35"/><circle cx="22" cy="22" r="3"/>',
    plate_observer:
      '<ellipse cx="22" cy="22" rx="16" ry="6" transform="rotate(-32 22 22)"/><circle cx="22" cy="22" r="10"/><path d="m30 5 1.5 4 4 1.5-4 1.5L30 16l-1.5-4-4-1.5 4-1.5Z"/>',
    plate_fishbone_master:
      '<path d="M10 14c-8 0-8 16 0 16l6-8ZM16 22h18l5-7v14l-5-7M21 22l-3-6m3 6-3 6m9-6-3-6m3 6-3 6"/><circle cx="8" cy="20" r="1"/><path d="m18 7 3 3 3-5 3 5 3-3" stroke-width="1.5"/>',
  };
  function badge(key) {
    if (!valid(key, 'nameplate')) return '';
    const earned = key === 'plate_fishbone_master';
    const title = earned
      ? '累计购买 10 个坚硬鱼骨，拥有至少 3 个黄金鱼骨、10 个普通鱼骨；非卖品，不代表管理权限'
      : '购买装扮，不代表身份认证或管理权限';
    return (
      `<span class="cosmetic-nameplate ${key}" title="${title}">` +
      `<svg class="nameplate-crest" viewBox="0 0 44 44" aria-hidden="true" focusable="false">${
        crests[key]
      }</svg><span class="nameplate-label">${items[key][1]}</span><small>${
        earned ? '成就' : '装扮'
      }</small></span>`
    );
  }
  function inventoryActions(key) {
    if (key === 'fortune_bag')
      return '<button type="button" class="electromagnetic-button" data-extra-action="use_bag">使用福袋 · 含今天连续 7 天</button>';
    if (items[key])
      return `<div class="extra-actions">
      <button type="button" class="electromagnetic-button" data-extra-action="equip" data-slot="${items[key][0]}" data-item="${key}">佩戴这件装扮</button>
      <button type="button" class="electromagnetic-button" data-extra-action="equip" data-slot="${items[key][0]}" data-item="">卸下同类装扮</button></div>`;
    return '';
  }
  function applyPresentation(cosmetics = {}) {
    const header = document.querySelector('.public-profile-shell');
    const avatar = document.getElementById('public-profile-avatar');
    if (header) {
      const card = valid(cosmetics.card, 'card');
      header.dataset.profileCard = card;
      if (card) document.body.dataset.publicProfileTheme = card;
      else delete document.body.dataset.publicProfileTheme;
      if (!header.querySelector('.profile-ambience')) {
        const ambience = document.createElement('div');
        ambience.className = 'profile-ambience';
        ambience.setAttribute('aria-hidden', 'true');
        ambience.innerHTML =
          '<svg class="profile-constellation" viewBox="0 0 560 230" fill="none"><path d="M20 155h85l35-80h125l42 67h104l62-103h57M140 75l68 127h160l43-60"/><g><circle cx="105" cy="155" r="4"/><circle cx="140" cy="75" r="5"/><circle cx="265" cy="75" r="4"/><circle cx="307" cy="142" r="5"/><circle cx="411" cy="142" r="4"/><circle cx="473" cy="39" r="5"/></g></svg><i class="profile-star star-one"></i><i class="profile-star star-two"></i><i class="profile-star star-three"></i><i class="profile-star star-four"></i>';
        header.prepend(ambience);
      }
    }
    if (avatar) {
      avatar.dataset.avatarFrame = valid(cosmetics.frame, 'frame');
      avatar.closest('.public-profile-avatar-wrap').dataset.frame = avatar.dataset.avatarFrame;
    }
    const plate = document.getElementById('public-profile-nameplate');
    if (plate) plate.innerHTML = badge(cosmetics.nameplate);
  }
  function renderCollectibles(profile) {
    const root = document.getElementById('public-profile-collectibles');
    if (!root) return;
    root.replaceChildren();
    const collectibles = Array.isArray(profile.collectibles) ? profile.collectibles : [];
    root.hidden = !collectibles.length;
    if (!collectibles.length) return;
    const heading = document.createElement('h2');
    heading.textContent = '个人收藏';
    root.append(heading);
    collectibles.forEach((item) => {
      const figure = document.createElement('figure');
      const caption = document.createElement('figcaption');
      caption.textContent = item.name || item.title || '';
      const img = document.createElement('img');
      // Use only local, known icon files; public strings never become markup.
      img.src = /^[a-z_]+$/.test(item.key)
        ? `/assets/icons/${item.key}.svg`
        : '/assets/icons/fishbone.svg';
      img.alt = '';
      figure.append(img, caption);
      root.append(figure);
    });
  }
  function renderRanch(state) {
    const root = document.getElementById('public-profile-ranch');
    if (!root) return;
    clearTimeout(satietyTimer);
    const motion = actor?.snapshot();
    actor?.destroy();
    const ranch = state.ranch || {};
    const bones = Math.max(0, Number(ranch.bones) || 0);
    const gold = Math.max(0, Number(ranch.goldenBones) || 0);
    const hard = Math.max(0, Number(ranch.hardBones) || 0);
    const hungry = Boolean(ranch.hungry);
    const remaining = Math.max(0, (ranch.fedUntilMs || 0) - (ranch.serverNowMs || Date.now()));
    const markers = [
      [gold, '黄金鱼骨', 'is-golden'],
      [hard, '坚硬鱼骨', 'is-hard'],
      [bones, '普通鱼骨', 'is-ordinary'],
    ]
      .map(
        ([quantity, label, cls]) =>
          `<span class="ranch-bone-count ${cls}"><svg viewBox="0 0 48 32" aria-hidden="true"><ellipse cx="8" cy="16" rx="7" ry="9" fill="currentColor"/><circle cx="7" cy="13" r="2" fill="#42564b"/><path d="M14 16h27m-20 0-4-8m4 8-4 8m13-8-4-8m4 8-4 8m14-8 6-7m-6 7 6 7" fill="none" stroke="currentColor" stroke-width="3"/></svg><span>${label}</span><strong>× ${quantity}</strong></span>`,
      )
      .join('');
    root.innerHTML = `<div class="ranch-heading"><div><span class="ranch-kicker">MAX'S LITTLE FIELD</span><h2>一小片电子牧场</h2></div>
      <button type="button" data-ranch-pause aria-pressed="${Boolean(motion?.paused)}">${motion?.paused ? '继续漫步' : '暂停漫步'}</button></div>
      <p class="ranch-intro">不用赶路，不必满分。今天也可以先在这里歇一会儿。</p>
      <div class="ranch-scene ${hungry ? 'is-hungry' : ''}" aria-label="${ranch.adopted ? (hungry ? 'Max 饿了，趴在地上等一条鱼' : '电子仿生羊 Max 在草地上漫步') : '等待 Max 入住的牧场'}">
        <span class="ranch-sun" aria-hidden="true"></span><span class="ranch-cloud" aria-hidden="true"></span>
        <span class="ranch-hill ranch-hill-back" aria-hidden="true"></span><span class="ranch-hill" aria-hidden="true"></span>
        <span class="ranch-cabin" aria-hidden="true">MAX</span>
        ${ranch.adopted ? '<div class="ranch-pet-track"><div data-max-actor></div></div>' : '<p class="ranch-empty">草已经长好了，等一位新朋友。</p>'}
        <div class="ranch-ground"></div>
      </div>
      <div class="ranch-owner-controls">
        ${ranch.adopted && !hungry ? '<button type="button" data-ranch-greet>让 Max 站起来打个招呼</button>' : ''}
      </div>
      <div class="ranch-bone-summary" aria-label="鱼骨收藏数量">${markers}</div>
      ${ranch.adopted ? `<p class="ranch-satiety">${hungry ? 'Max 饿了，正在草地上等你带一条鱼。' : `还能饱腹约 ${(remaining / 86400000).toFixed(1)} 天`}</p>` : ''}
      <div class="ranch-owner-controls">
      ${own ? (ranch.adopted ? `<button type="button" data-extra-action="feed" ${own.fish < 1 || remaining > 29 * 86400000 ? 'disabled' : ''}>喂一条鱼 · 饱腹 24 小时 · 剩余 ${own.fish} 条</button><a href="/electromagnetic">去找小鱼 ↗</a>` : '<a href="/electromagnetic">请 Max 搬进来 · 10 电元＋10 磁元 ↗</a>') : '<span>这是主人的小牧场，访客可以在这里看看风景。</span>'}
      </div>
      ${own ? '<details class="ranch-rules"><summary>喂养与纪念规则</summary><p>每条鱼增加 24 小时饱腹时间，最多累计 30 天，容量不足一天不扣鱼。按北京时间，每个祥瑞日首次喂养产生 1 个黄金鱼骨，每日限 1 个；当天后续喂养及其他运势下的喂养均产生 1 个普通鱼骨。累计购买 10 个坚硬鱼骨，拥有至少 3 个黄金鱼骨和 10 个普通鱼骨，自动解锁「鱼骨达人」；不消耗鱼骨。Max 饿时趴下，不死亡、不丢失。</p></details>' : ''}
      <p id="profile-extras-message" role="status" aria-live="polite"></p>`;
    actor = ranch.adopted
      ? window.FreeBbsMaxRanch.mount(root.querySelector('[data-max-actor]'), { ...motion, hungry })
      : null;
    if (ranch.adopted && remaining > 0) {
      const started = Date.now();
      satietyTimer = setTimeout(
        () => {
          if (!root.isConnected) return;
          const serverNowMs = (ranch.serverNowMs || started) + (Date.now() - started);
          const updated = {
            ...state,
            ranch: { ...ranch, serverNowMs, hungry: serverNowMs >= ranch.fedUntilMs },
          };
          if (own === state) own = updated;
          renderRanch(updated);
        },
        Math.min(remaining, 60000),
      );
    }
  }
  function renderWardrobe() {
    const container = document.getElementById('public-profile-wardrobe');
    if (!container) return;
    container.hidden = !own;
    if (!own) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `<h2>我的装扮</h2><p>每类可以佩戴一件，装上或卸下后即可在自己的主页看到效果。</p>
      <div class="wardrobe-slots">${[
        ['frame', '头像框'],
        ['nameplate', '铭牌'],
        ['card', '主页主题'],
      ]
        .map(
          ([slot, label]) =>
            `<section><h3>${label}</h3><p>当前：${items[own.cosmetics?.[slot]]?.[1] || '未佩戴'}</p>
        ${own.owned
          .filter((key) => items[key]?.[0] === slot)
          .map(
            (key) =>
              `<button type="button" data-extra-action="equip" data-slot="${slot}" data-item="${key}" aria-pressed="${own.cosmetics?.[slot] === key}">${items[key][1]}</button>`,
          )
          .join('')}
        <button type="button" data-extra-action="equip" data-slot="${slot}" data-item="">卸下</button></section>`,
        )
        .join('')}</div>
      <p>主页主题会统一个人资料、收藏与牧场的配色，自己查看和他人访问都能看到。</p>
      <a href="/electromagnetic">在商城发现更多装扮 ↗</a>
      `;
  }
  async function renderProfile(profile) {
    renderRevision += 1;
    const revision = renderRevision;
    profileData = profile;
    own = null;
    renderWardrobe();
    renderCollectibles(profile);
    applyPresentation(profile.cosmetics);
    renderRanch(profile);
    const app = window.freeBbsApp;
    await app.sessionReady;
    if (profileData !== profile || revision !== renderRevision) return;
    if (app.userState.isLoggedIn && String(app.userState.uid) === String(profile.uid)) {
      let state;
      try {
        state = await app.callApi('/profile/extras', { method: 'GET' });
      } catch (error) {
        const message = document.getElementById('profile-extras-message');
        if (message) message.textContent = error.message;
        return;
      }
      if (
        profileData !== profile ||
        revision !== renderRevision ||
        !app.userState.isLoggedIn ||
        String(app.userState.uid) !== String(profile.uid)
      )
        return;
      own = state;
      applyPresentation(own.cosmetics);
      renderRanch(own);
    }
    renderWardrobe();
  }
  async function handleAction(button) {
    if (busy) return;
    const app = window.freeBbsApp;
    if (!app?.userState.isLoggedIn) return;
    const { uid } = app.userState;
    const body = {
      action: button.dataset.extraAction,
      slot: button.dataset.slot,
      itemKey: button.dataset.item || '',
    };
    const key = JSON.stringify([uid, body]);
    if (!pending.has(key)) pending.set(key, crypto.randomUUID());
    body.requestKey = pending.get(key);
    const message =
      document.getElementById('shop-inspect-message') ||
      document.getElementById('profile-extras-message');
    busy = true;
    button.disabled = true;
    if (message) message.textContent = '正在处理…';
    try {
      if (
        body.action === 'use_bag' &&
        !window.confirm(
          '使用后含今天连续 7 个北京时间自然日，运势最低大吉；生效期间不能重复使用。确认使用一个福袋？',
        )
      )
        return;
      if (body.action === 'feed') {
        // Draw/read today's authoritative fortune before feeding, without requiring check-in.
        await app.callApi('/fortune', { method: 'GET' });
        if (!app.userState.isLoggedIn || app.userState.uid !== uid) return;
      }
      const result = await app.callApi('/profile/extras', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      pending.delete(key);
      if (!app.userState.isLoggedIn || app.userState.uid !== uid) return;
      let text =
        body.action === 'feed'
          ? result.result.bone === 'golden_fishbone'
            ? 'Max 留下了一小截金色的惊喜。'
            : 'Max 吃饱了，草地里多了一段小纪念。'
          : body.action === 'use_bag'
            ? '福袋已生效，含今天连续 7 天最低大吉；好运签到奖励每天最多一次。'
            : body.action === 'adopt'
              ? 'Max 搬进来了，欢迎新邻居。'
              : body.itemKey
                ? '已佩戴，讨论区和个人主页会展示新装扮。'
                : '已卸下这类装扮。';
      if (result.result.unlocked?.includes('plate_fishbone_master'))
        text += ' 已解锁成就铭牌「鱼骨达人」，可以在我的装扮中佩戴。';
      if (profileData?.uid === uid) {
        profileData = { ...profileData, cosmetics: result.cosmetics, ranch: result.ranch };
        own = result;
        applyPresentation(result.cosmetics);
        renderRanch(result);
        renderWardrobe();
        if (body.action === 'feed') actor?.greet();
        const currentMessage = document.getElementById('profile-extras-message');
        if (currentMessage) currentMessage.textContent = text;
      } else {
        if (body.action === 'use_bag') await app.refreshEconomy?.();
        const currentMessage = document.getElementById('shop-inspect-message') || message;
        if (currentMessage) currentMessage.textContent = text;
      }
    } catch (error) {
      if (message && app.userState.uid === uid)
        message.textContent = `${error.message}（可重试此操作）`;
    } finally {
      busy = false;
      button.disabled = false;
    }
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-extra-action]');
    if (button) {
      event.preventDefault();
      handleAction(button);
    }
    const pause = event.target.closest('[data-ranch-pause]');
    if (pause) {
      const paused = pause.getAttribute('aria-pressed') !== 'true';
      pause.setAttribute('aria-pressed', String(paused));
      pause.textContent = paused ? '继续漫步' : '暂停漫步';
      document.querySelector('.ranch-scene')?.classList.toggle('is-paused', paused);
      actor?.pause(paused);
    }
    if (event.target.closest('[data-ranch-greet]')) actor?.greet();
  });
  window.addEventListener('freebbs:session-change', () => {
    renderRevision += 1;
    own = null;
    const uid = window.freeBbsApp?.userState.uid || '';
    if (uid !== sessionUid) pending.clear();
    sessionUid = uid;
    if (profileData) {
      renderRanch(profileData);
      renderWardrobe();
      renderProfile(profileData).catch(() => {
        const message = document.getElementById('profile-extras-message');
        if (message) message.textContent = '暂时无法刷新装扮，请重新打开主页。';
      });
    }
  });
  window.FreeBbsProfileExtras = {
    badge,
    inventoryActions,
    renderProfile,
    frame: (cosmetics) => valid(cosmetics?.frame, 'frame'),
  };
})();
