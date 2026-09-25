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
  let sessionEpoch = 0;
  let sessionBlocked = false;
  let refreshRequired = false;
  let activeRequest = null;
  const profileRequests = new Set();
  const identity = () => {
    const user = window.freeBbsApp?.userState;
    return user?.isLoggedIn ? JSON.stringify([user.uid, user.token]) : '';
  };
  let sessionIdentity = identity();
  function showRefreshRequired() {
    const message =
      document.getElementById('profile-extras-message') ||
      document.getElementById('shop-inspect-message');
    if (message)
      message.textContent = sessionBlocked
        ? '登录状态已变化，请刷新页面后继续。'
        : '操作已完成，界面暂时未刷新，请刷新页面查看。';
    for (const button of document.querySelectorAll?.('[data-extra-action]') || [])
      button.disabled = true;
  }
  function invalidateSession(blocked) {
    sessionEpoch += 1;
    renderRevision += 1;
    sessionBlocked = blocked;
    refreshRequired = false;
    activeRequest?.abort();
    activeRequest = null;
    profileRequests.forEach((request) => request.abort());
    profileRequests.clear();
    busy = false;
    own = null;
    pending.clear();
    clearTimeout(satietyTimer);
  }
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
    if (key === 'rubber_rod') {
      const uid = window.freeBbsApp?.userState.uid;
      return uid
        ? `<a class="electromagnetic-button" href="/profile?uid=${encodeURIComponent(uid)}#public-profile-ranch">去牧场摩擦起电 ↗</a>`
        : '';
    }
    if (key === 'fortune_bag')
      return '<button type="button" class="electromagnetic-button" data-extra-action="use_bag">使用福袋 · 含今天连续 7 天</button>';
    if (items[key])
      return `<div class="extra-actions">
      <button type="button" class="electromagnetic-button" data-extra-action="equip" data-slot="${items[key][0]}" data-item="${key}">佩戴这件装扮</button>
      <button type="button" class="electromagnetic-button" data-extra-action="equip" data-slot="${items[key][0]}" data-item="">卸下同类装扮</button></div>`;
    return '';
  }
  function profileAmbience() {
    return '<svg class="profile-constellation" viewBox="0 0 560 230" fill="none"><path d="M20 155h85l35-80h125l42 67h104l62-103h57M140 75l68 127h160l43-60"/><g><circle cx="105" cy="155" r="4"/><circle cx="140" cy="75" r="5"/><circle cx="265" cy="75" r="4"/><circle cx="307" cy="142" r="5"/><circle cx="411" cy="142" r="4"/><circle cx="473" cy="39" r="5"/></g></svg><i class="profile-star star-one"></i><i class="profile-star star-two"></i><i class="profile-star star-three"></i><i class="profile-star star-four"></i>';
  }
  // These are the actual equipped classes and the same nameplate renderer, not an
  // illustration of a different product. Only known local keys become markup.
  function cosmeticPreview(key) {
    const slot = items[key]?.[0];
    if (!slot) return '';
    const avatar =
      '<img class="public-profile-avatar" src="/assets/avatar_placeholder.webp" alt="" loading="lazy" decoding="async" width="116" height="116" />';
    if (slot === 'frame') {
      return `<div class="shop-cosmetic-preview is-frame" data-cosmetic-preview="${key}" role="img" aria-label="${items[key][1]}实际佩戴效果">
        <span class="shop-preview-caption">实际佩戴效果</span>
        <div class="public-profile-avatar-wrap" data-frame="${key}">${avatar.replace('class="public-profile-avatar"', `class="public-profile-avatar" data-avatar-frame="${key}"`)}</div>
        <span class="shop-preview-footnote">与个人主页、讨论区使用同一头像框</span>
      </div>`;
    }
    if (slot === 'nameplate') {
      return `<div class="shop-cosmetic-preview is-nameplate" data-cosmetic-preview="${key}" role="img" aria-label="${items[key][1]}实际铭牌效果">
        <span class="shop-preview-caption">实际佩戴效果</span>
        <div class="shop-preview-identity">${avatar}<strong>Max</strong></div>
        ${badge(key)}
        <span class="shop-preview-footnote">真实铭牌样式 · 不是身份认证</span>
      </div>`;
    }
    return `<div class="shop-cosmetic-preview is-theme" data-cosmetic-preview="${key}" role="img" aria-label="${items[key][1]}实际主页主题效果">
      <section class="public-profile-shell shop-preview-profile" data-profile-card="${key}">
        <div class="profile-ambience" aria-hidden="true">${profileAmbience()}</div>
        <span class="shop-preview-caption">主页主题实景</span>
        <div class="shop-preview-identity">${avatar}<div><strong>Max</strong><span>欢迎来到我的主页</span></div></div>
        <div class="shop-preview-profile-note"><strong>记录灵光，珍藏好奇。</strong><span>把今天的小小发现留在这里。</span></div>
        <div class="shop-preview-profile-stats"><span>学习<span>始于好奇</span></span><span>讨论<span>共同探索</span></span></div>
      </section>
    </div>`;
  }
  function ranchPreview() {
    const sheep = window.FreeBbsMaxRanch?.previewMarkup?.();
    if (!sheep) return '';
    return `<div class="shop-ranch-preview" role="img" aria-label="与个人牧场相同的电子仿生羊 Max">
      <span class="shop-preview-caption">牧场里的 Max</span>
      <div class="shop-ranch-pet" aria-hidden="true">${sheep}</div>
      <span class="shop-preview-footnote">一位戴眼镜、会长羊毛的小伙伴</span>
    </div>`;
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-shop-cosmetic-preview]').forEach((node) => {
      node.innerHTML = cosmeticPreview(node.dataset.shopCosmeticPreview);
    });
    document.querySelectorAll('[data-shop-ranch-preview]').forEach((node) => {
      node.innerHTML = ranchPreview();
    });
  });
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
        ambience.innerHTML = profileAmbience();
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
    const wool = woolPanel(state, Boolean(own));
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
        <span class="ranch-sun" aria-hidden="true"></span>
        <svg class="ranch-landscape" viewBox="0 0 1000 360" preserveAspectRatio="none" aria-hidden="true">
          <g class="ranch-clouds" fill="currentColor">
            <path d="M235 67q12-15 29-7q9-24 31-12q20-11 31 8q20-2 24 13Z"/>
            <path d="M654 44q10-11 22-7q13-19 30-4q17-2 22 11Z" opacity=".65"/>
          </g>
          <path class="ranch-distant" d="M0 193Q91 120 182 158Q260 76 365 149Q477 88 585 158Q696 106 801 164Q889 106 1000 155V360H0Z"/>
          <path class="ranch-hill ranch-hill-back" d="M0 229Q116 152 280 206Q423 245 560 192Q726 126 1000 219V360H0Z"/>
          <path class="ranch-hill" d="M0 268Q205 208 372 245Q532 291 697 243Q871 192 1000 246V360H0Z"/>
          <path class="ranch-meadow-light" d="M0 282Q164 248 326 270T634 285Q815 254 1000 283V360H0Z"/>
          <path class="ranch-meadow-path" d="M805 238Q733 256 747 273Q782 297 643 360H540Q719 299 697 279Q666 253 805 238Z"/>
          <g class="ranch-distant-tree" fill="currentColor" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <path d="M119 229v-57m0 30-17-13m17 2 17-18" fill="none"/>
            <path d="M92 181c-19-12-10-30 8-31c-1-25 32-31 39-11c25-6 37 28 17 38c4 22-21 30-33 19c-16 10-32 2-31-15Z" stroke="none"/>
            <path d="M948 216v-54m0 25-14-12m14 4 15-12" fill="none"/>
            <path d="M923 171c-15-11-8-29 9-29c1-22 26-27 35-9c20-3 29 23 14 34c2 18-18 25-30 18c-13 8-28 0-28-14Z" stroke="none"/>
          </g>
          <g class="ranch-meadow-marks" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="m76 287 3-8 4 8m181 13 4-9 5 8m177-24 2-6 4 5m401 12 3-8 4 7m-302 19 3-7 3 7M179 245h10m347 19h13m-223 52h11m602-12h13"/>
          </g>
        </svg>
        <div class="ranch-home">
          <svg class="ranch-hut" viewBox="0 0 200 164" aria-hidden="true">
            <ellipse cx="101" cy="151" rx="86" ry="8" fill="#435537" opacity=".16"/>
            <path d="M131 23h17v42h-17Z" fill="#b89c7d" stroke="#88704e" stroke-width="1.5"/>
            <path d="M128 22h23v7h-23Z" fill="#d6c0a0"/>
            <path class="ranch-hut-wall" d="M39 68h122v78H39Z" fill="#eee0bd" stroke="#a08a62" stroke-width="1.5"/>
            <path d="M139 69h22v77h-22Z" fill="#caba94" opacity=".5"/>
            <path d="M29 76Q48 45 88 24Q100 19 112 25Q154 46 174 76Q153 72 137 73Q100 66 64 73Z" fill="#b98555" stroke="#8d6543" stroke-width="2" stroke-linejoin="round"/>
            <path d="M35 68Q53 40 94 25Q101 22 108 26Q147 44 167 68Q99 52 35 68Z" fill="#d1a274"/>
            <path d="M57 49q43-14 84 0M45 60q55-14 109 0m-86-21-10 19m28-28-6 24m27-27 3 27m19-17 9 21" fill="none" stroke="#e9c494" stroke-width="2" opacity=".7" stroke-linecap="round"/>
            <path d="M44 77q58-10 112 0" fill="none" stroke="#9a724e" stroke-width="3"/>
            <path d="M88 145v-37q0-21 17-21t17 21v37Z" fill="#916b49" stroke="#806343" stroke-width="1.7"/>
            <path d="M95 105q0-13 10-13t10 13v38H95Z" fill="#ad8760"/>
            <path d="M104 95v46m-11-22h23" fill="none" stroke="#c19c73" stroke-width="1.3"/>
            <circle cx="113" cy="124" r="2" fill="#e9ca88"/>
            <rect class="ranch-window" x="52" y="93" width="22" height="26" rx="7" fill="#e7c889" stroke="#92744e" stroke-width="2"/>
            <path d="M63 93v26m-11-13h22" stroke="#9c7d52" stroke-width="1.5"/>
            <path d="M49 121h29l-3 10H53Z" fill="#af7954"/>
            <path d="M52 121q-4-13 5-8q2-13 7-3q9-9 9 8" fill="#78905b"/>
            <circle cx="56" cy="112" r="2.8" fill="#e4b99b"/><circle cx="69" cy="110" r="2.7" fill="#efd99c"/>
            <path d="M82 146h45l6 7H76Z" fill="#c3b998"/>
            <path d="M42 137h13m74 0h16m-95-7h9m79-47h10" stroke="#c8b694" stroke-width="2" stroke-linecap="round"/>
            <path d="M155 142q-4-24 8-41m-9 30q-13-6-8-13q9-4 11 9m0-10q9 0 12-8q-6-5-11 1" fill="#839763" stroke="#6b8150" stroke-width="1.2"/>
          </svg>
          <span class="ranch-owner-sign"></span>
        </div>
        ${ranch.adopted ? '<div class="ranch-pet-track"><div data-max-actor></div></div>' : '<p class="ranch-empty">草已经长好了，等一位新朋友。</p>'}
        <div class="ranch-ground"></div>
        <svg class="ranch-wildflowers" viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden="true">
          <g fill="none" stroke="var(--ranch-grass, #7e9a67)" stroke-width="2.5" stroke-linecap="round">
            <path d="M25 71q1-23-9-32m11 32q7-20 15-24M180 78q1-18-5-27m4 27q8-19 13-19m640 12q-2-26 7-38m-7 38q-8-19-16-19m125 27q2-18-5-29m4 27q7-23 14-24M491 77q0-13-6-20m5 20q6-15 12-18"/>
            <path d="M78 77V46m-1 20-8-6m9-1 8-7M888 76V37m0 25 10-9"/>
          </g>
          <g fill="#f9ecd0"><ellipse cx="78" cy="43" rx="5" ry="9"/><ellipse cx="78" cy="43" rx="10" ry="4"/><ellipse cx="888" cy="34" rx="5" ry="9"/><ellipse cx="888" cy="34" rx="10" ry="4"/></g>
          <g fill="#d9ae5d"><circle cx="78" cy="43" r="3.2"/><circle cx="888" cy="34" r="3.2"/></g>
          <g fill="#d4bca4"><circle cx="189" cy="58" r="3"/><circle cx="500" cy="58" r="3"/><circle cx="951" cy="51" r="3"/></g>
        </svg>
      </div>
      <div class="ranch-owner-controls">
        ${ranch.adopted && !hungry ? '<button type="button" data-ranch-greet>和 Max 打个招呼</button>' : ''}
      </div>
      <div class="ranch-bone-summary" aria-label="鱼骨收藏数量">${markers}</div>
      ${ranch.adopted ? `<p class="ranch-satiety">${hungry ? 'Max 饿了，正在草地上等你带一条鱼。' : `还能饱腹约 ${(remaining / 86400000).toFixed(1)} 天`}</p>` : ''}
      <div class="ranch-owner-controls">
      ${own ? (ranch.adopted ? `<button type="button" data-extra-action="feed" ${own.fish < 1 || remaining > 29 * 86400000 ? 'disabled' : ''}>喂一条鱼 · 饱腹 24 小时 · 剩余 ${own.fish} 条</button><a href="/electromagnetic">去找小鱼 ↗</a>` : '<a href="/electromagnetic">请 Max 搬进来 · 10 电元＋10 磁元 ↗</a>') : '<span>这是主人的小牧场，访客可以在这里看看风景。</span>'}
      </div>
      ${wool}
      ${own ? '<details class="ranch-rules"><summary>喂养与纪念规则</summary><p>每条鱼增加 24 小时饱腹时间，最多累计 30 天，容量不足一天不扣鱼。按北京时间，每个祥瑞日首次喂养产生 1 个黄金鱼骨，每日限 1 个；当天后续喂养及其他运势下的喂养均产生 1 个普通鱼骨。累计购买 10 个坚硬鱼骨，拥有至少 3 个黄金鱼骨和 10 个普通鱼骨，自动解锁「鱼骨达人」；不消耗鱼骨。Max 饿时趴下，不死亡、不丢失。</p></details>' : ''}
      <p id="profile-extras-message" role="status" aria-live="polite"></p>`;
    const ownerSign = root.querySelector('.ranch-owner-sign');
    ownerSign.textContent = profileData?.username || '牧场主人';
    ownerSign.title = ownerSign.textContent;
    actor = ranch.adopted
      ? window.FreeBbsMaxRanch.mount(root.querySelector('[data-max-actor]'), {
          ...motion,
          hungry,
          woolReady: ranch.woolReady || 0,
          shearedToday: Boolean(ranch.shearedToday),
        })
      : null;
    const untilNextShear = Math.max(
      0,
      (ranch.nextShearAtMs || 0) - (ranch.serverNowMs || Date.now()),
    );
    if (ranch.adopted && (remaining > 0 || untilNextShear > 0)) {
      const started = Date.now();
      satietyTimer = setTimeout(
        () => {
          if (!root.isConnected) return;
          const serverNowMs = (ranch.serverNowMs || started) + (Date.now() - started);
          const updated = {
            ...state,
            ranch: {
              ...ranch,
              serverNowMs,
              hungry: serverNowMs >= ranch.fedUntilMs,
              shearedToday: Boolean(ranch.shearedToday && serverNowMs < ranch.nextShearAtMs),
            },
          };
          if (own === state) own = updated;
          renderRanch(updated);
        },
        Math.min(
          remaining > 0 ? remaining : Infinity,
          untilNextShear > 0 ? untilNextShear : Infinity,
          60000,
        ),
      );
    }
  }
  function woolPanel(state, isOwn) {
    const ranch = state.ranch || {};
    if (!ranch.adopted) return '';
    const count = (value) =>
      Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(value) || 0)));
    const progress = Math.min(4, count(ranch.feedProgress));
    const ready = count(ranch.woolReady);
    const stored = count(ranch.woolStored);
    return `<section class="ranch-wool" aria-labelledby="ranch-wool-title">
      <div class="ranch-wool-heading"><div><span class="ranch-kicker">A LITTLE STATIC MAGIC</span><h3 id="ranch-wool-title">Max 的羊毛静电工坊</h3></div>
        <svg class="ranch-wool-art" viewBox="0 0 150 82" aria-hidden="true"><path d="M18 53Q6 37 22 30Q18 14 35 18Q47 4 58 18Q78 10 81 27Q99 30 90 48Q96 65 76 65H32Q14 69 18 53Z" fill="#fff2d7" stroke="#b38956" stroke-width="2"/><path d="M29 41q0-13 11-9t0 13m15-21q14-4 12 9m-10 21q12 5 18-5" fill="none" stroke="#d1af7d" stroke-width="2" stroke-linecap="round"/><g transform="rotate(28 113 43)"><rect x="105" y="7" width="18" height="69" rx="9" fill="#42404b" stroke="#262530" stroke-width="2"/><path d="M110 18h8m-8 16h8m-8 16h8" stroke="#c4e8f2" stroke-width="2"/></g><path d="m91 19 6 5-6 5m4 15 7 2-5 6" fill="none" stroke="#dba33d" stroke-width="2"/></svg></div>
      <p>每喂食 5 条小鱼，长出一份蓬松羊毛。每天剪一份，和橡胶棒摩擦，让好奇心变成 2 电元。</p>
      <div class="ranch-wool-progress"><span>下一份羊毛</span><progress max="5" value="${progress}" aria-label="下一份羊毛喂养进度">${progress}/5</progress><strong>${progress} / 5 条小鱼</strong></div>
      <div class="ranch-wool-stages"><div><span>长好待剪</span><strong>${ready} <small>份</small></strong>${isOwn ? `<button type="button" data-extra-action="shear" ${ready < 1 || ranch.shearedToday ? 'disabled' : ''}>${ranch.shearedToday ? '今天已剪毛' : '剪下一份羊毛'}</button>` : ''}</div>
        <div><span>已剪待摩擦</span><strong>${stored} <small>份</small></strong>${isOwn ? `<button type="button" data-extra-action="rub_wool" ${stored < 1 || !state.rubberRod ? 'disabled' : ''}>摩擦起电 · ＋2 电元</button>` : ''}</div></div>
      ${isOwn ? `<p class="ranch-wool-tool">${state.rubberRod ? '橡胶棒已就位，可以反复使用。' : '<a href="/electromagnetic">去商城带回橡胶棒 · 7 磁元 ↗</a>'}</p>` : ''}
      ${isOwn && ranch.shearedToday ? '<p class="ranch-wool-rest">Max 被薅秃了，明天再来吧。<small>按北京时间每天剪一次，攒下的羊毛会留到以后。</small></p>' : ''}
      <p class="ranch-wool-note">羊毛留在牧场，按北京时间每天最多剪一份。橡胶棒得到电子带负电，羊毛失去电子带正电。</p>
    </section>`;
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
    const epoch = sessionEpoch;
    profileData = profile;
    own = null;
    renderWardrobe();
    renderCollectibles(profile);
    applyPresentation(profile.cosmetics);
    renderRanch(profile);
    const app = window.freeBbsApp;
    await app.sessionReady;
    if (profileData !== profile || revision !== renderRevision || epoch !== sessionEpoch) return;
    if (sessionBlocked || refreshRequired) {
      showRefreshRequired();
      return;
    }
    if (app.userState.isLoggedIn && String(app.userState.uid) === String(profile.uid)) {
      let state;
      const owner = identity();
      const controller = new AbortController();
      profileRequests.add(controller);
      const current = () =>
        profileData === profile &&
        revision === renderRevision &&
        epoch === sessionEpoch &&
        !sessionBlocked &&
        owner === identity();
      try {
        state = await app.callApi('/profile/extras', { method: 'GET', signal: controller.signal });
      } catch (error) {
        const message = document.getElementById('profile-extras-message');
        if (message && current()) message.textContent = error.message;
        return;
      } finally {
        profileRequests.delete(controller);
      }
      if (
        !current() ||
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
    if (sessionBlocked || refreshRequired) {
      showRefreshRequired();
      return;
    }
    const app = window.freeBbsApp;
    if (!app?.userState.isLoggedIn) return;
    const { uid, token } = app.userState;
    const epoch = sessionEpoch;
    const sameSession = () =>
      !sessionBlocked &&
      epoch === sessionEpoch &&
      app.userState.isLoggedIn &&
      app.userState.uid === uid &&
      app.userState.token === token;
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
    let committed = false;
    const controller = new AbortController();
    activeRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
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
        await app.callApi('/fortune', { method: 'GET', signal: controller.signal });
        if (!sameSession()) return;
      }
      const result = await app.callApi('/profile/extras', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      committed = true;
      if (!sameSession()) return;
      if (pending.get(key) === body.requestKey) pending.delete(key);
      app.syncWallet?.(result.user, token);
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
      if (body.action === 'shear') text = '一份蓬松羊毛剪好了，正等着和橡胶棒打个招呼。';
      if (body.action === 'rub_wool')
        text = '噼啪！羊毛与橡胶棒摩擦，获得 2 电元，已记入账本。橡胶棒可以继续使用。';
      if (body.action === 'feed' && result.result.woolGrown)
        text += ' 五条小鱼的心意攒满了，Max 长出一份可以剪取的羊毛！';
      if (result.result.unlocked?.includes('plate_fishbone_master'))
        text += ' 已解锁成就铭牌「鱼骨达人」，可以在我的装扮中佩戴。';
      if (profileData?.uid === uid) {
        profileData = { ...profileData, cosmetics: result.cosmetics, ranch: result.ranch };
        own = result;
        applyPresentation(result.cosmetics);
        renderRanch(result);
        renderWardrobe();
        if (['feed', 'shear', 'rub_wool'].includes(body.action)) {
          actor?.celebrate?.(body.action === 'rub_wool' ? 'rub' : body.action);
        }
        const currentMessage = document.getElementById('profile-extras-message');
        if (currentMessage) currentMessage.textContent = text;
      } else {
        if (body.action === 'use_bag') await app.refreshEconomy?.();
        const currentMessage = document.getElementById('shop-inspect-message') || message;
        if (currentMessage) currentMessage.textContent = text;
      }
    } catch (error) {
      const currentMessage = document.getElementById('profile-extras-message') || message;
      if (sameSession()) {
        if (committed) {
          refreshRequired = true;
          showRefreshRequired();
        } else if (currentMessage) {
          currentMessage.textContent = `${error.name === 'AbortError' ? '等待超时，结果尚未确认' : error.message}（可重试原操作）`;
        }
      }
    } finally {
      clearTimeout(timeout);
      if (activeRequest === controller) {
        activeRequest = null;
        busy = false;
        button.disabled = sessionBlocked || refreshRequired;
      }
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
    const owner = identity();
    if (!sessionBlocked && owner === sessionIdentity) return;
    sessionIdentity = owner;
    invalidateSession(false);
    if (profileData) {
      renderRanch(profileData);
      renderWardrobe();
      const epoch = sessionEpoch;
      renderProfile(profileData).catch(() => {
        if (epoch !== sessionEpoch || sessionBlocked) return;
        const message = document.getElementById('profile-extras-message');
        if (message) message.textContent = '暂时无法刷新装扮，请重新打开主页。';
      });
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== 'free_bbs_auth_token' && event.key !== null) return;
    invalidateSession(true);
    if (profileData) {
      renderRanch(profileData);
      renderWardrobe();
    }
    showRefreshRequired();
  });
  window.FreeBbsProfileExtras = {
    badge,
    cosmeticPreview,
    ranchPreview,
    inventoryActions,
    woolPanel,
    renderProfile,
    frame: (cosmetics) => valid(cosmetics?.frame, 'frame'),
  };
})();
