/* scripts/core/runtime.js */
/* 公共注册、状态与生命周期。模块不访问其他模块的内部 DOM。 */
(() => {
  const registry = new Map();
  function readContent(root) {
    const text = (node, selector) =>
      node.querySelector(selector)?.textContent.trim() || "";
    const screens = [...root.querySelectorAll("[data-section]")].map(
      (node) => ({
        id: node.id,
        label: node.dataset.label,
        english: node.dataset.english,
        color: node.dataset.color,
        scopeFrame: node.dataset.scopeFrame,
      }),
    );
    const phases = [...root.querySelectorAll("[data-phase-panel]")].map(
      (node) => ({
        title: text(node, "h3"),
        english: text(node, ".mono"),
        description: text(node, "[data-phase-description]"),
      }),
    );
    const works = [...root.querySelectorAll("article[data-work-id]")].map(
      (node) => ({
        id: node.dataset.workId,
        code: node.dataset.workCode,
        title: text(node, "h3"),
        edition: text(node, "[data-work-edition]"),
        category: node.dataset.category,
        image: node.querySelector("img")?.getAttribute("src") || null,
        caption: node.dataset.caption || "",
        introduction: node.querySelector("template[data-work-description]")?.content.cloneNode(true) || null,
        details: node.querySelector("template[data-work-details]")?.content.cloneNode(true) || null,
        video: node.dataset.playback
          ? {
              type: node.dataset.playback,
              bvid: node.dataset.bvid,
              aid: node.dataset.aid,
              cid: node.dataset.cid,
              p: node.dataset.p,
              src: node.dataset.mediaSrc,
              url: node.dataset.mediaUrl,
              label: node.dataset.mediaLabel,
            }
          : null,
        links: [...(node.querySelector("template[data-work-links]")?.content.querySelectorAll("a") || [])].map(link => ({ url: link.getAttribute("href"), label: link.textContent })),
        link: node.querySelector(".project-link")?.getAttribute("href") || "",
      }),
    );
    const workCategories = [
      ...root.querySelectorAll("[data-category-filter]"),
    ].map((node) => ({
      id: node.dataset.categoryFilter,
      name: node.textContent.trim(),
    }));
    const archiveNode = root.querySelector("[data-archive-config]");
    return {
      screens,
      phases,
      works,
      workCategories,
      archive: {
        image: archiveNode.dataset.image,
        caption: archiveNode.dataset.caption,
      },
    };
  }
  function createContext(root) {
    const data = readContent(root);
    const controller = new AbortController(),
      events = new EventTarget(),
      cleanups = [];
    const state = {
      screen: 0,
      phase: 0,
      motion: true,
      tint: data.screens[0].color,
      progress: 0,
    };
    let toastTimer;
    const ctx = {
      root,
      data,
      state,
      signal: controller.signal,
      find: (selector) => root.querySelector(selector),
      all: (selector) => [...root.querySelectorAll(selector)],
      set(patch) {
        const changes = Object.keys(patch).filter(
          (key) => state[key] !== patch[key],
        );
        if (!changes.length) return;
        Object.assign(state, patch);
        events.dispatchEvent(
          new CustomEvent("change", { detail: { state, changes } }),
        );
      },
      subscribe(callback) {
        events.addEventListener("change", (e) => callback(e.detail), {
          signal: controller.signal,
        });
      },
      listen(target, type, callback, options = {}) {
        target.addEventListener(type, callback, {
          ...options,
          signal: controller.signal,
        });
      },
      cleanup(callback) {
        cleanups.push(callback);
      },
      navigate(id) {
        const target = ctx.find(`#${id}`);
        if (!target) return;
        ctx.find("[data-sequence]").scrollTo({
          top: target.offsetTop,
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        });
        try {
          history.replaceState(null, "", `#${id}`);
        } catch {
          /* 嵌入环境仍可导航 */
        }
      },
      toast(message) {
        const node = ctx.find("[data-toast]");
        node.textContent = message;
        node.classList.add("visible");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => node.classList.remove("visible"), 2400);
      },
      destroy() {
        cleanups.reverse().forEach((fn) => fn());
        controller.abort();
        clearTimeout(toastTimer);
      },
    };
    return ctx;
  }
  window.MM = {
    registry,
    register: (name, init) => registry.set(name, init),
    createContext,
    readContent,
  };
})();

;

/* scripts/core/motion.js */
MM.register("motion", (ctx) => {
  // 内容自动切换、纵向展示与轨道共用完整循环时长，单位为秒。
  ctx.cycleDuration = 12;
  ctx.minimumCycleInterval = 2;
  ctx.cyclePeriod = (count) => Math.max(ctx.cycleDuration, ctx.minimumCycleInterval * count);
  ctx.cycleInterval = (count) => ctx.cyclePeriod(Math.max(1, count)) * 1000 / Math.max(1, count);
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  let override = null;
  function update() {
    ctx.set({ motion: override ?? !media.matches });
    ctx.root.dataset.motion = ctx.state.motion ? "on" : "off";
    ctx.all("[data-toggle-motion]").forEach((button) => {
      button.setAttribute("aria-pressed", String(ctx.state.motion));
      button.setAttribute(
        "aria-label",
        ctx.state.motion ? "暂停播放与动效" : "继续播放与动效",
      );
      const icon = button.querySelector(".ui-icon");
      icon.classList.toggle("icon-pause", ctx.state.motion);
      icon.classList.toggle("icon-play", !ctx.state.motion);
    });
  }
  ctx.setMotion = (enabled) => {
    override = Boolean(enabled);
    update();
  };
  ctx.toggleMotion = () => ctx.setMotion(!ctx.state.motion);
  ctx.syncMotion = update;
  ctx.listen(media, "change", update);
  ctx.listen(ctx.root, "click", (e) => {
    if (e.target.closest("[data-toggle-motion]")) ctx.toggleMotion();
  });
  update();
  ctx.animate = (callback) => {
    let frame = 0,
      last = 0,
      elapsed = 0;
    function tick(now) {
      elapsed += last ? Math.min(now - last, 80) : 0;
      last = now;
      callback(elapsed / 1000);
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame);
      last = 0;
      if (ctx.state.motion && !document.hidden)
        frame = requestAnimationFrame(tick);
      else callback(elapsed / 1000);
    }
    ctx.subscribe(({ changes }) => {
      if (changes.includes("motion") || changes.includes("screen")) sync();
    });
    ctx.listen(document, "visibilitychange", sync);
    ctx.cleanup(() => cancelAnimationFrame(frame));
    sync();
  };
});

;

/* scripts/components/cycle-interaction.js */
/* 鼠标／触摸焦点不锁定循环；键盘阅读保留焦点暂停。 */
MM.register("cycle-interaction", (ctx) => {
  let keyboard = document.activeElement?.matches?.(":focus-visible") || false;
  const guards = new Set();
  function setKeyboard(value) {
    if (keyboard === value) return;
    keyboard = value;
    guards.forEach((guard) => guard.refresh());
  }
  ctx.listen(document, "pointerdown", () => setKeyboard(false), { capture: true });
  ctx.listen(document, "keydown", (event) => {
    if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) setKeyboard(true);
  }, { capture: true });
  ctx.subscribe(({ changes }) => {
    if (changes.includes("screen")) guards.forEach((guard) => guard.refresh());
  });

  // enabled 可排除离章后仍保留在 DOM 中的阅读窗口。
  ctx.cyclePause = (elements, onChange, enabled = () => elements) => {
    const hovered = new Set();
    const paused = () => enabled().some((element) =>
      hovered.has(element) || keyboard && element.contains(document.activeElement));
    let previous = paused();
    const guard = {
      paused,
      refresh() {
        const next = paused();
        if (next === previous) return;
        previous = next;
        onChange();
      },
    };
    elements.forEach((element) => {
      ctx.listen(element, "pointerenter", (event) => {
        if (event.pointerType === "touch") return;
        hovered.add(element);
        guard.refresh();
      });
      ctx.listen(element, "pointerleave", () => {
        hovered.delete(element);
        guard.refresh();
      });
      ctx.listen(element, "focusin", guard.refresh);
      ctx.listen(element, "focusout", () => {
        // 等待 activeElement 完成转移，不增加轮播定时器。
        queueMicrotask(() => { if (!ctx.signal.aborted) guard.refresh(); });
      });
    });
    guards.add(guard);
    ctx.cleanup(() => guards.delete(guard));
    return guard;
  };
});

;

/* scripts/components/window-stack.js */
/* 仅在明确声明的交叠组内置顶；固定层级和跨页浮层不参与。 */
MM.register("window-stack", (ctx) => {
  const mobile = matchMedia("(max-width: 960px)");
  const groups = ctx.all("[data-window-stack]").map((element) => ({
    element,
    layers: [...element.querySelectorAll("[data-window-layer]")],
    front: null,
  }));
  const enabled = (group) => group.element.dataset.windowStack === "always" || !mobile.matches;

  function activate(event) {
    if (event.type === "pointerdown" && event.button !== 0) return;
    const layer = event.target.closest?.("[data-window-layer]");
    const group = groups.find((group) => group.layers.includes(layer));
    if (!group || !enabled(group) || group.front === layer) return;
    group.front?.classList.remove("is-window-front");
    layer.classList.add("is-window-front");
    group.front = layer;
  }

  function reset(group) {
    group.front?.classList.remove("is-window-front");
    group.front = null;
  }

  ctx.listen(ctx.root, "pointerdown", activate);
  ctx.listen(ctx.root, "focusin", activate);
  ctx.listen(mobile, "change", () => {
    groups.filter((group) => !enabled(group)).forEach(reset);
  });
  ctx.cleanup(() => groups.forEach(reset));
});

;

/* scripts/components/window-transfer.js */
/* 移动同一个窗口；临时浮层避开章节滚动与侧栏裁切。 */
MM.register("window-transfer", (ctx) => {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  ctx.windowTransfer = (panel, className, onSettled = () => {}) => {
    const flight = document.createElement("div");
    flight.className = "window-flight " + className;
    flight.hidden = true;
    ctx.root.append(flight);
    let frame = 0;
    let destination = null;

    function finish() {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!destination) return;
      const focused = panel.contains(document.activeElement) ? document.activeElement : null;
      destination.append(panel);
      destination = null;
      flight.hidden = true;
      if (focused) focused.focus({ preventScroll: true });
      onSettled();
    }

    function move(target, place, host = ctx.root) {
      if (panel.parentElement === target && !destination) {
        place();
        onSettled();
        return;
      }
      const from = panel.getBoundingClientRect();
      const focused = panel.contains(document.activeElement) ? document.activeElement : null;
      finish();
      target.append(panel);
      place();
      if (ctx.root.hasAttribute("data-enhanced") && innerWidth > 1360 && ctx.state.screen > 0 && !reducedMotion.matches && !document.hidden && from.width && from.height) {
        destination = target;
        host.append(flight);
        flight.hidden = false;
        flight.append(panel);
        const keys = ["left", "top", "width", "height"];
        function paint(bounds) {
          // 章节内的浮层随正文滚动，换算坐标后仍沿视口中的原路径移动。
          const origin = host === ctx.root ? { left: 0, top: 0 } : host.getBoundingClientRect();
          keys.forEach((key) => {
            const offset = key === "left" ? origin.left : key === "top" ? origin.top : 0;
            flight.style[key] = bounds[key] - offset + "px";
          });
        }
        paint(from);
        let start = null;
        function tick(now) {
          if (start === null) start = now;
          const progress = Math.min(1, (now - start) / 700);
          const eased = 1 - Math.pow(1 - progress, 3);
          const to = target.getBoundingClientRect();
          const bounds = {};
          keys.forEach((key) => { bounds[key] = from[key] + (to[key] - from[key]) * eased; });
          paint(bounds);
          if (progress < 1) frame = requestAnimationFrame(tick);
          else finish();
        }
        frame = requestAnimationFrame(tick);
      } else onSettled();
      if (focused) focused.focus({ preventScroll: true });
    }
    ctx.listen(window, "resize", finish);
    ctx.listen(document, "visibilitychange", () => { if (document.hidden) finish(); });
    ctx.listen(reducedMotion, "change", () => {
      if (reducedMotion.matches) finish();
    });
    ctx.cleanup(() => { finish(); flight.remove(); });
    return { move, finish };
  };
});

;

/* scripts/components/modal.js */
MM.register("modal", (ctx) => {
  const dialog = ctx.find("[data-modal-root] dialog");
  const body = dialog.querySelector(".media-body"),
    caption = dialog.querySelector("[data-media-summary]"),
    description = dialog.querySelector(".media-description"),
    introduction = dialog.querySelector("[data-media-description]"),
    title = dialog.querySelector("#media-title"),
    workTitle = dialog.querySelector("#media-work-title"),
    details = dialog.querySelector("[data-media-details]"),
    links = dialog.querySelector("[data-media-links]");
  let origin;
  let resumeMotion = false, destroyed = false;
  function clearMedia() {
    // 主动停止本地视频并清除资源，关闭和重复挂载时均生效。
    body.querySelectorAll("video").forEach((video) => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    });
    body.replaceChildren();
  }
  function sourceLink(source) {
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.append(document.createTextNode(source.label + " "));
    const icon = document.createElement("span");
    icon.className = "ui-icon icon-external";
    icon.setAttribute("aria-hidden", "true");
    link.append(icon);
    return link;
  }
  function prepare(heading, text, embedded = false) {
    const wasVideo = resumeMotion;
    resumeMotion = embedded;
    if (embedded) ctx.setMotion(false);
    else if (wasVideo) ctx.setMotion(true);
    origin = document.activeElement;
    title.textContent = heading;
    title.classList.remove("mono");
    dialog.setAttribute("aria-labelledby", "media-title");
    caption.textContent = text;
    caption.hidden = !text;
    description.hidden = !text;
    workTitle.textContent = "";
    workTitle.hidden = true;
    introduction.replaceChildren();
    details.replaceChildren();
    details.hidden = true;
    dialog.classList.remove("is-work");
    clearMedia();
    links.replaceChildren();
    links.hidden = true;
  }
  ctx.openImage = (src, title, description) => {
    prepare(title, description);
    const image = new Image();
    image.src = src;
    image.alt = description;
    body.append(image);
    dialog.showModal();
  };
  ctx.openWork = (work) => {
    const video = work.video;
    const embedded = video && ["bilibili", "file"].includes(video.type);
    prepare(work.code || work.id, work.caption, embedded);
    dialog.classList.add("is-work");
    title.classList.add("mono");
    dialog.setAttribute("aria-labelledby", "media-work-title");
    workTitle.textContent = work.title;
    if (work.edition) {
      const edition = document.createElement("span");
      edition.className = "media-edition";
      edition.textContent = `电子系${work.edition}`;
      workTitle.append(edition);
    }
    workTitle.hidden = false;
    description.hidden = false;
    if (work.introduction) introduction.append(work.introduction.cloneNode(true));
    if (work.details) {
      details.append(work.details.cloneNode(true));
      details.hidden = false;
    }
    const sources = [...(work.links || [])];
    if (video?.url) sources.unshift({ url: video.url, label: video.label });
    const uniqueSources = sources.filter((source, index) => sources.findIndex(item => item.url === source.url) === index);
    links.append(...uniqueSources.map(sourceLink));
    links.hidden = !uniqueSources.length;
    if (!embedded) {
      const pending = document.createElement("p");
      pending.className = "media-pending";
      if (video?.url) {
        pending.append(sourceLink({ url: video.url, label: video.label }));
      } else pending.textContent = "视频链接待补充";
      body.append(pending);
      dialog.showModal();
      return;
    }
    if (video.type === "file") {
      const player = document.createElement("video");
      player.controls = true;
      player.playsInline = true;
      player.autoplay = false;
      player.setAttribute("controlslist", "nodownload");
      ctx.listen(player, "contextmenu", (event) => event.preventDefault());
      player.preload = "none";
      player.src = video.src;
      player.setAttribute("aria-label", `《${work.title}》播放器`);
      body.append(player);
      dialog.showModal();
      // 在打开作品的真实点击中启动；策略或解码失败时仍可使用原生控件。
      /* Native playback controls wait for the visitor. */
      return;
    }
    const params = new URLSearchParams({
      isOutside: "true",
      p: video.p || "1",
      autoplay: "0",
      poster: "0",
    });
    if (video.bvid) params.set("bvid", video.bvid);
    ["aid", "cid"].forEach((key) => {
      if (/^\d+$/.test(video[key] || "")) params.set(key, video[key]);
    });
    const iframe = document.createElement("iframe");
    iframe.title = work.title;
    iframe.src = `https://player.bilibili.com/player.html?${params}`;
    iframe.allow = "fullscreen; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    body.append(iframe);
    dialog.showModal();
  };
  ctx.openVideo = ctx.openWork;
  ctx.openArchive = () =>
    ctx.openImage(
      ctx.data.archive.image,
      "扫描二维码前往 EEInfinity 视频号",
      ctx.data.archive.caption,
    );
  ctx.listen(dialog.querySelector("[data-close]"), "click", () =>
    dialog.close(),
  );
  ctx.listen(dialog, "close", () => {
    // close 事件异步派发；快速重新打开时不要清掉新作品。
    if (dialog.open || destroyed) return;
    clearMedia();
    details.replaceChildren();
    links.replaceChildren();
    introduction.replaceChildren();
    origin?.focus({ preventScroll: true });
    if (resumeMotion) {
      resumeMotion = false;
      ctx.setMotion(true);
    }
  });
  ctx.listen(dialog, "click", (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dialog.close();
  });
  ctx.cleanup(() => {
    destroyed = true;
    resumeMotion = false;
    if (dialog.open) dialog.close();
    clearMedia();
    details.replaceChildren();
    links.replaceChildren();
    introduction.replaceChildren();
  });
});

;

/* modules/workspace/navigation/navigation.js */
/* 固定结构由 navigation.html 提供，此模块只维护导航状态与手机菜单。 */
MM.register("navigation", (ctx) => {
  const toolbar = ctx.find("[data-navigation]");
  const menu = toolbar.querySelector(".mobile-menu-button");
  menu.setAttribute("aria-expanded", "false");
  toolbar.classList.remove("menu-open");
  ctx.listen(menu, "click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    toolbar.classList.toggle("menu-open", open);
  });
  ctx.listen(toolbar, "click", (event) => {
    if (event.target.closest("[data-go]")) {
      menu.setAttribute("aria-expanded", "false");
      toolbar.classList.remove("menu-open");
    }
  });
  function update() {
    const visible = ctx.state.screen > 0;
    toolbar.inert = !visible;
    toolbar.setAttribute("aria-hidden", String(!visible));
    if (!visible) {
      menu.setAttribute("aria-expanded", "false");
      toolbar.classList.remove("menu-open");
    }
    const current = ctx.data.screens[ctx.state.screen];
    toolbar.querySelectorAll("nav a").forEach((a) => {
      if (a.dataset.go === current.id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    ctx.find("[data-context-label]").textContent = current.english;
  }
  ctx.subscribe(({ changes }) => {
    if (changes.includes("screen")) update();
  });
  update();
});

;

/* modules/workspace/scopes/scopes.js */
/* 波形统计离线生成；浏览器只切换小图。 */
MM.register("scopes", (ctx) => {
  const panel = ctx.find("[data-scopes]"),
    traces = [...panel.querySelectorAll("[data-scope-trace]")],
    mode = panel.querySelector("[data-scope-mode]"),
    scene = panel.querySelector("[data-scope-scene]");
  let active = traces.findIndex((trace) => trace.classList.contains("is-active")),
    selected = traces[active]?.getAttribute("src") || "",
    revision = 0;

  async function switchTrace(path, alt) {
    const request = ++revision, preload = new Image();
    try {
      preload.src = path;
      await preload.decode();
      if (request !== revision || ctx.signal.aborted) return;
      // 快速连续切换先结束上一轮淡化，复用已经不可见的图层。
      traces.forEach((trace) => trace.getAnimations().forEach((animation) => animation.finish()));
      const next = active === 0 ? 1 : 0, incoming = traces[next];
      incoming.src = path;
      await incoming.decode();
      if (request !== revision || ctx.signal.aborted) return;
      // 确保新图有 opacity: 0 的起始状态，再同时改变两个图层。
      getComputedStyle(incoming).opacity;
      incoming.alt = alt;
      traces.forEach((trace, index) => {
        trace.classList.toggle("is-active", index === next);
        trace.setAttribute("aria-hidden", String(index !== next));
      });
      active = next;
    } catch {
      // 失败保留已显示的波形；下一次相关事件可以重试。
      if (request === revision && !ctx.signal.aborted) selected = "";
    }
  }

  function update() {
    const screen = ctx.data.screens[ctx.state.screen];
    scene.textContent = screen.english;
    const alt = mode.value === "parade"
      ? "RGB 分列波形"
      : "RGB 叠加波形";
    if (ctx.state.screen === 0 || !panel.getClientRects().length) return;
    const originalPath = `${screen.scopeFrame}-${mode.value}.png`;
    const path = ({"assets/scopes/about-parade.png":"assets/scopes/about-parade.png.webp","assets/scopes/about-waveform.png":"assets/scopes/about-waveform.png.webp","assets/scopes/contact-parade.png":"assets/scopes/contact-parade.png","assets/scopes/contact-waveform.png":"assets/scopes/contact-waveform.png","assets/scopes/intro-parade.png":"assets/scopes/intro-parade.png.webp","assets/scopes/intro-waveform.png":"assets/scopes/intro-waveform.png.webp","assets/scopes/stories-parade.png":"assets/scopes/stories-parade.png","assets/scopes/stories-waveform.png":"assets/scopes/stories-waveform.png","assets/scopes/studio-parade.png":"assets/scopes/studio-parade.png.webp","assets/scopes/studio-waveform.png":"assets/scopes/studio-waveform.png.webp","assets/scopes/works-parade.png":"assets/scopes/works-parade.png.webp","assets/scopes/works-waveform.png":"assets/scopes/works-waveform.png.webp"})[originalPath] ?? originalPath;
    if (selected === path) return;
    selected = path;
    switchTrace(path, alt);
  }
  ctx.cleanup(() => {
    revision++;
    traces.forEach((trace) => trace.getAnimations().forEach((animation) => animation.cancel()));
  });
  ctx.listen(mode, "change", update);
  ctx.listen(window, "resize", update);
  ctx.subscribe(({ changes }) => {
    if (changes.includes("screen")) update();
  });
  update();
});

;

/* modules/workspace/player/player.js */
/* 唯一音频与唱片；所有播放键复用 motion，悬停暂停仍由各展示自行管理。 */
MM.register("player", (ctx) => {
  const panel = ctx.find("[data-player]");
  const disc = ctx.find("[data-player-disc]");
  const introDisc = ctx.find("[data-player-intro-disc]");
  const dockDisc = panel.querySelector("[data-player-dock-disc]");
  const rotation = disc.querySelector("[data-player-rotation]");
  const audio = ctx.find("[data-player-audio]");
  const video = ctx.find("[data-opening-video]");
  const volumes = ctx.all("[data-player-volume]");
  const muteButtons = ctx.all("[data-player-mute]");
  const status = panel.querySelector("[data-player-status]");
  const hasSource = (media) => Boolean(media.getAttribute("src") || media.querySelector("source[src]")?.getAttribute("src"));
  const configured = hasSource(audio), videoConfigured = hasSource(video);
  let failed = false, videoFailed = false, waiting = false, destroyed = false;
  let audioAuthorized = false, openingAuthorized = false;
  const musicButton = document.createElement('button');
  musicButton.type = 'button';
  musicButton.textContent = '♫ 播放音乐';
  musicButton.setAttribute('aria-pressed', 'false');
  musicButton.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:2147483000;padding:9px 13px;border:1px solid #acd1c6;border-radius:999px;background:#f3fff9ed;color:#174a42;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer';
  ctx.root.append(musicButton);
  ctx.listen(musicButton, 'click', () => {
    audioAuthorized = !audioAuthorized;
    musicButton.textContent = audioAuthorized ? '♫ 暂停音乐' : '♫ 播放音乐';
    musicButton.setAttribute('aria-pressed', String(audioAuthorized));
    if (audioAuthorized) { blocked = false; ctx.setMotion(true); }
    syncPlayback(); update();
  });
  ctx.cleanup(() => musicButton.remove());
  const openingButton = document.createElement('button');
  openingButton.type = 'button';
  openingButton.textContent = '▶ 播放开场';
  openingButton.setAttribute('aria-pressed', 'false');
  openingButton.style.cssText = 'display:inline-flex;align-items:center;margin-top:18px;padding:10px 17px;border:1px solid #b3d5ce;border-radius:999px;background:#f3fff9ed;color:#174a42;font:600 13px/1.5 system-ui,sans-serif;cursor:pointer';
  ctx.find('.opening-copy').append(openingButton);
  ctx.listen(openingButton, 'click', () => {
    openingAuthorized = !openingAuthorized;
    openingButton.textContent = openingAuthorized ? 'Ⅱ 暂停开场' : '▶ 播放开场';
    openingButton.setAttribute('aria-pressed', String(openingAuthorized));
    if (openingAuthorized) { videoBlocked = false; ctx.setMotion(true); }
    syncVideo();
  });
  ctx.cleanup(() => openingButton.remove());
  let blocked = false, videoBlocked = false, audioPending = false, videoPending = false;
  let failureText = "", playRequest = 0;
  audio.volume = Number(volumes[0].value);
  video.muted = true;
  panel.querySelector("[data-player-track-title]").textContent = audio.dataset.title;

  function syncVideo() {
    if (!videoConfigured || videoFailed) return;
    // 视频使用自己的时间轴，保留素材开头和循环结尾的淡入淡出。
    const shouldPlay = openingAuthorized && ctx.state.screen === 0 && ctx.state.motion && !document.hidden;
    if (shouldPlay && video.paused && !videoPending && !videoBlocked) {
      videoPending = true;
      video.play().then(() => {
        if (destroyed || ctx.state.screen !== 0 || !ctx.state.motion || document.hidden) video.pause();
      }).catch((error) => {
        if (!destroyed && error.name !== "AbortError") videoBlocked = true;
      }).finally(() => {
        videoPending = false;
        if (!destroyed && shouldPlay && video.paused && !videoBlocked) syncVideo();
      });
    } else if (!shouldPlay) video.pause();
  }
  function update() {
    volumes.forEach((volume) => {
      volume.disabled = !configured || failed;
      volume.value = audio.volume;
      volume.setAttribute("aria-valuetext", `${Math.round(audio.volume * 100)}%`);
    });
    muteButtons.forEach((button) => {
      button.disabled = !configured || failed;
      button.setAttribute("aria-pressed", String(audio.muted));
      button.setAttribute("aria-label", audio.muted ? "取消静音" : "静音");
      const icon = button.querySelector(".ui-icon");
      icon.classList.toggle("icon-muted", audio.muted);
      icon.classList.toggle("icon-volume", !audio.muted);
    });
    const text = !audioAuthorized ? "点击播放音乐开启" : !configured ? "尚未配置音频" : failed ? failureText : blocked && ctx.state.motion ? "点击页面开启音乐" : waiting ? "正在缓冲" : !audio.paused ? "正在播放" : "已暂停";
    if (status.textContent !== text) status.textContent = text;
    syncVideo();
  }
  function syncPlayback() {
    // 后台暂停不改变用户的播放选择，返回页面时恢复。
    if (!audioAuthorized || !configured || failed || blocked || !ctx.state.motion || document.hidden) {
      audio.pause();
      syncVideo();
      return;
    }
    if (audio.paused && !audioPending) {
      const request = ++playRequest;
      audioPending = true;
      audio.play().then(() => {
        if (destroyed || !ctx.state.motion || document.hidden) audio.pause();
      }).catch((error) => {
        if (destroyed || request !== playRequest || !ctx.state.motion || document.hidden || error.name === "AbortError") return;
        if (error.name === "NotAllowedError") blocked = true;
        else if (!failed) {
          failed = true;
          failureText = "播放失败";
          console.warn("Background audio playback error", { name: error.name, message: error.message, src: audio.currentSrc || audio.src });
        }
        update();
      }).finally(() => {
        audioPending = false;
        if (!destroyed && ctx.state.motion && !document.hidden && !failed && !blocked && audio.paused) syncPlayback();
      });
    }
    syncVideo();
  }
  function layout() {
    const target = ctx.state.screen === 0 ? introDisc : dockDisc;
    if (disc.parentElement !== target) target.append(disc);
    syncVideo();
  }
  volumes.forEach((volume) => ctx.listen(volume, "input", () => {
    audio.volume = Number(volume.value);
    update();
  }));
  muteButtons.forEach((button) => ctx.listen(button, "click", () => {
    audio.muted = !audio.muted;
    update();
  }));
  // pause 也可能来自后台切换或尚未完成的 play；不反向覆盖用户的 motion 选择。
  ["loadedmetadata", "volumechange", "play", "pause", "ended"].forEach((event) => ctx.listen(audio, event, update));
  ctx.listen(audio, "waiting", () => { waiting = true; update(); });
  ctx.listen(audio, "playing", () => { waiting = false; update(); });
  ctx.listen(audio, "error", () => {
    failed = true;
    const reasons = { 1: "加载中断", 2: "网络错误", 3: "解码失败", 4: "音频不可用" };
    failureText = reasons[audio.error?.code] || "加载失败";
    console.warn("Background audio error", { code: audio.error?.code, message: audio.error?.message, src: audio.currentSrc || audio.src });
    audio.pause();
    update();
  });
  ctx.listen(video, "playing", () => { video.hidden = false; });
  ctx.listen(video, "error", () => { videoFailed = true; video.hidden = true; });
  function retryAutoplay(event) {
    if (!event.isTrusted || !ctx.state.motion || document.hidden) return;
    if (event.type === "keydown" && (event.repeat || !["Enter", " "].includes(event.key) || event.target.closest("[data-toggle-motion]"))) return;
    if (blocked) { blocked = false; syncPlayback(); }
    if (videoBlocked) { videoBlocked = false; syncVideo(); }
  }
  /* Background audio authorization is controlled by the visible music button. */
  /* Background audio starts only from an explicit player button. */
  ctx.listen(window, "resize", layout);
  ctx.listen(document, "visibilitychange", syncPlayback);
  ctx.subscribe(({ changes }) => {
    if (changes.includes("screen")) layout();
    if (changes.includes("motion")) syncPlayback();
  });
  // 默认尝试有声播放；受策略限制时等待交互，静音视频继续自动播放。
  syncPlayback();
  ctx.animate((elapsed) => {
    if (ctx.state.screen !== 0 && innerWidth <= 1360) return;
    const seconds = configured && !audio.paused ? audio.currentTime : elapsed;
    rotation.style.transform = `rotate(${seconds * 22.5}deg)`;
  });
  ctx.player = { pause: () => ctx.setMotion(false) };
  ctx.cleanup(() => {
    destroyed = true;
    playRequest++;
    audio.pause();
    video.pause();
    video.hidden = true;
    introDisc.append(disc);
    delete ctx.player;
  });
  update();
  layout();
});

;

/* modules/workspace/nodes/nodes.js */
/* 节点模块拥有唯一窗口及公开挂载槽；只在布局变化时读取端口位置。 */
MM.register("nodes", (ctx) => {
  const panel = ctx.find("[data-nodes]");
  const dock = ctx.find("[data-node-dock]");
  const stage = ctx.find("[data-node-stage]");
  const reading = ctx.find("[data-node-reading]");
  const graph = panel.querySelector(".chrome-node-graph");
  const buttons = [...panel.querySelectorAll("[data-node]")];
  const wires = [...graph.querySelectorAll("[data-from]")];
  const ports = new Map([...graph.querySelectorAll("[data-port]")].map((port) => [port.dataset.port, port]));
  let pending = 0;
  let timer = 0;
  const interaction = ctx.cyclePause([panel, reading], scheduleCycle, () =>
    ctx.data.screens[ctx.state.screen].id === "studio" ? [panel, reading] : [panel]);
  const transfer = ctx.windowTransfer(panel, "node-flight", scheduleWires);

  function drawWires() {
    pending = 0;
    const bounds = graph.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    graph.querySelector("svg").setAttribute("viewBox", "0 0 " + bounds.width + " " + bounds.height);
    const points = new Map([...ports].map(([name, port]) => {
      const rect = port.getBoundingClientRect();
      return [name, { x: rect.left + rect.width / 2 - bounds.left, y: rect.top + rect.height / 2 - bounds.top }];
    }));
    wires.forEach((wire) => {
      const from = points.get(wire.dataset.from);
      const to = points.get(wire.dataset.to);
      // 直接连接真实端口，允许窄布局中向左回折，不按视觉顺序重排流程。
      wire.setAttribute("d", "M" + from.x + " " + from.y + " L" + to.x + " " + to.y);
    });
  }

  function scheduleWires() {
    if (!pending) pending = requestAnimationFrame(drawWires);
  }

  function scheduleCycle() {
    clearTimeout(timer);
    timer = 0;
    const studio = ctx.data.screens[ctx.state.screen].id === "studio";
    if (buttons.length < 2 || !ctx.state.motion || document.hidden || ctx.state.screen === 0 || (!studio && innerWidth <= 1360) || interaction.paused()) return;
    timer = setTimeout(() => {
      ctx.set({ phase: (ctx.state.phase + 1) % buttons.length });
    }, ctx.cycleInterval(buttons.length));
  }

  function placeWindow() {
    const wide = ctx.data.screens[ctx.state.screen].id === "studio";
    transfer.move(wide ? stage : dock, () => {
      panel.dataset.layout = wide ? "wide" : "compact";
      dock.hidden = wide;
    }, wide ? stage.closest(".studio-workflow") : ctx.root);
    scheduleWires();
    scheduleCycle();
  }

  function update() {
    buttons.forEach((button) => {
      const selected = Number(button.dataset.node) === ctx.state.phase;
      button.setAttribute("aria-pressed", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    panel.querySelector("[data-node-title]").textContent = ctx.data.phases[ctx.state.phase].title;
    panel.querySelector("[data-node-number]").textContent = String(ctx.state.phase + 1).padStart(2, "0") + " / " + String(buttons.length).padStart(2, "0");
  }

  ctx.listen(graph, "click", (event) => {
    const button = event.target.closest("[data-node]");
    if (button) ctx.set({ phase: Number(button.dataset.node) });
  });
  ctx.listen(graph, "keydown", (event) => {
    if (!event.target.closest("[data-node]")) return;
    let index = ctx.state.phase;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) index = (index + 1) % buttons.length;
    else if (["ArrowLeft", "ArrowUp"].includes(event.key)) index = (index + buttons.length - 1) % buttons.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = buttons.length - 1;
    else return;
    event.preventDefault();
    ctx.set({ phase: index });
    buttons[index].focus({ preventScroll: true });
    buttons[index].scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  });
  const observer = new ResizeObserver(scheduleWires);
  observer.observe(graph);
  ctx.listen(window, "resize", () => { scheduleWires(); scheduleCycle(); });
  ctx.listen(document, "visibilitychange", scheduleCycle);
  ctx.subscribe(({ changes }) => {
    if (changes.includes("screen")) placeWindow();
    if (changes.includes("phase")) update();
    if (changes.includes("phase") || changes.includes("motion")) scheduleCycle();
  });
  ctx.cleanup(() => {
    clearTimeout(timer);
    transfer.finish();
    observer.disconnect();
    cancelAnimationFrame(pending);
    dock.append(panel);
    dock.hidden = false;
    panel.dataset.layout = "compact";
  });
  placeWindow();
  update();
});

;

/* modules/workspace/project-bin/project-bin.js */
/* 唯一媒体库在公开槽间移动；侧栏封面来自作品内容快照。 */
MM.register("project-bin", (ctx) => {
  const panel = ctx.find("[data-media-library]");
  const dock = ctx.find("[data-media-dock]");
  const stage = ctx.find("[data-media-stage]");
  const transfer = ctx.windowTransfer(panel, "media-flight");
  const works = ctx.data.works.filter((item) => item.image);
  const preview = panel.querySelector("[data-bin-preview]");
  const empty = panel.querySelector("[data-bin-empty]");
  const compact = panel.querySelector("[data-bin-view]");
  const library = panel.querySelector("[data-library-view]");
  const footer = panel.querySelector("[data-library-footer]");
  const previous = panel.querySelector("[data-bin-previous]");
  const next = panel.querySelector("[data-bin-next]");
  let index = 0;
  let timer = 0;
  const interaction = ctx.cyclePause([panel], scheduleCarousel);
  preview.hidden = !works.length;
  empty.hidden = Boolean(works.length);
  previous.disabled = next.disabled = works.length < 2;

  function updateCover() {
    const work = works[index];
    if (!work) {
      panel.querySelector("[data-bin-filename]").textContent = "未导入素材";
      panel.querySelector("[data-bin-status]").textContent = "00 / 00";
      return;
    }
    const cover = panel.querySelector("[data-bin-cover]");
    cover.src = work.image;
    cover.alt = `《${work.title}》封面`;
    panel.querySelector("[data-bin-filename]").textContent = `${work.title}.mp4`;
    panel.querySelector("[data-bin-status]").textContent = String(index + 1).padStart(2, "0") + " / " + String(works.length).padStart(2, "0");
  }
  function scheduleCarousel() {
    clearTimeout(timer);
    timer = 0;
    if (works.length < 2 || !ctx.state.motion || document.hidden || innerWidth <= 1360 || ctx.state.screen === 0 || panel.dataset.mediaLayout !== "compact" || interaction.paused()) return;
    timer = setTimeout(() => {
      index = (index + 1) % works.length;
      updateCover();
      scheduleCarousel();
    }, ctx.cycleInterval(works.length));
  }
  function placeWindow() {
    // 移动侧栏始终隐藏，媒体库留在正文中，避免跨章时可见作品被移走。
    const expanded = innerWidth <= 960 || ctx.data.screens[ctx.state.screen].id === "works";
    const reel = !expanded && ctx.data.screens[ctx.state.screen].id === "studio";
    stage.style.removeProperty("height");
    transfer.move(expanded ? stage : dock, () => {
      panel.dataset.mediaLayout = expanded ? "library" : reel ? "reel" : "compact";
      compact.hidden = expanded || reel;
      library.hidden = !expanded && !reel;
      footer.hidden = !expanded;
      panel.querySelector("[data-media-subtitle]").textContent = expanded ? "02 / MEDIA POOL" : reel ? "WORKS / REEL" : "MEDIA BIN";
    });
    scheduleCarousel();
  }
  function step(direction) {
    if (!works.length) return;
    index = (index + direction + works.length) % works.length;
    updateCover();
    scheduleCarousel();
  }
  ctx.listen(previous, "click", () => step(-1));
  ctx.listen(next, "click", () => step(1));
  ctx.listen(window, "resize", () => {
    placeWindow();
  });
  ctx.listen(document, "visibilitychange", scheduleCarousel);
  ctx.subscribe(({ changes }) => {
    if (changes.includes("screen")) placeWindow();
    else if (changes.includes("motion")) scheduleCarousel();
  });
  ctx.cleanup(() => {
    clearTimeout(timer);
    transfer.finish();
    stage.append(panel);
    stage.style.removeProperty("height");
    panel.dataset.mediaLayout = "library";
    compact.hidden = true;
    library.hidden = footer.hidden = false;
    panel.querySelector("[data-media-subtitle]").textContent = "02 / MEDIA POOL";
  });
  updateCover();
  placeWindow();
});

;

/* modules/workspace/timeline/timeline.js */
/* 轨道在 HTML 中定义，此模块维护选中状态、播放头与示意时间码。 */
MM.register("timeline", (ctx) => {
  const root = ctx.find("[data-timeline]");
  const previous = root.querySelector("[data-previous]"),
    next = root.querySelector("[data-next]"),
    timecode = root.querySelector("[data-timecode]"),
    content = root.querySelector(".track-content"),
    viewport = root.querySelector(".timeline-viewport");
  const clips = [...root.querySelectorAll("[data-clip]")],
    audioClips = [...root.querySelectorAll("[data-audio-clip]")];
  const duration = ctx.cycleDuration,
    fps = 24;
  let loopTime = 0,
    lastTime = null,
    clipLeft = 3,
    clipTravel = 0,
    lastFrames = -1;

  function render() {
    root.style.setProperty(
      "--playhead",
      `${clipLeft + clipTravel * (loopTime / duration)}px`,
    );
    const frames = ctx.state.screen * duration * fps + Math.floor(loopTime * fps);
    if (frames === lastFrames) return;
    lastFrames = frames;
    const seconds = Math.floor(frames / fps);
    timecode.textContent = `01:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}:${String(frames % fps).padStart(2, "0")}`;
  }

  function measure() {
    const clip = clips.find((b) => Number(b.dataset.clip) === ctx.state.screen);
    const bounds = clip.getBoundingClientRect();
    clipLeft = bounds.left - content.getBoundingClientRect().left;
    // 预留播放头自身的 2px 宽度，循环全程保持在当前片段内。
    clipTravel = Math.max(0, bounds.width - 2);
    lastTime = null;
    render();
    // 仅切章或调整尺寸时定位；动画不改变访问者的横向滚动位置。
    const right = clipLeft + bounds.width;
    if (
      clipLeft < viewport.scrollLeft ||
      right > viewport.scrollLeft + viewport.clientWidth
    ) {
      viewport.scrollTo({
        left: Math.max(0, clipLeft - (viewport.clientWidth - bounds.width) / 2),
        behavior: "instant",
      });
    }
  }

  function update() {
    clips.forEach((b) => {
      const active = Number(b.dataset.clip) === ctx.state.screen;
      b.classList.toggle("selected", active);
      if (active) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
    audioClips.forEach((clip) => {
      clip.classList.toggle(
        "selected",
        Number(clip.dataset.audioClip) === ctx.state.screen,
      );
    });
    previous.disabled = ctx.state.screen === 0;
    next.disabled = ctx.state.screen === ctx.data.screens.length - 1;
    root.querySelector("[data-sequence-name]").textContent =
      ctx.data.screens[ctx.state.screen].english;
    loopTime = 0;
    measure();
  }
  ctx.listen(root.querySelector("[data-previous]"), "click", () =>
    ctx.navigate(ctx.data.screens[Math.max(0, ctx.state.screen - 1)].id),
  );
  ctx.listen(root.querySelector("[data-next]"), "click", () =>
    ctx.navigate(
      ctx.data.screens[
        Math.min(ctx.data.screens.length - 1, ctx.state.screen + 1)
      ].id,
    ),
  );
  ctx.subscribe(({ changes }) => {
    if (changes.includes("screen")) update();
  });
  ctx.listen(window, "resize", measure);
  ctx.syncMotion();
  update();
  ctx.animate((time) => {
    if (ctx.state.screen === 0) {
      lastTime = null;
      return;
    }
    if (lastTime !== null) loopTime = (loopTime + (time - lastTime)) % duration;
    lastTime = time;
    render();
  });
});

;

/* modules/sections/works/works.js */
/* 作品由 content/works.jsonc 构建进 HTML；此模块负责过滤、媒体操作与原卡片纵向轮换。 */
MM.register("works", (ctx) => {
  const root = ctx.find("#works");
  // 媒体库是公开窗口接口，可停靠在章节外；控件引用和事件随窗口保留。
  const library = ctx.find("[data-media-library]");
  const cards = [...library.querySelectorAll("[data-work-id]")];
  const filters = [...library.querySelectorAll("[data-category-filter]")];
  const grid = library.querySelector("[data-project-grid]");
  const content = library.querySelector(".media-content");
  // 衔接区只派生展示，不注册新作品；补足高窗口轮换前的下一轮画面。
  const continuation = document.createElement("div");
  continuation.className = "project-grid reel-continuation";
  continuation.setAttribute("aria-hidden", "true");
  continuation.hidden = true;
  grid.after(continuation);
  let continuationKey = "";
  const covered = new Set(ctx.data.works.filter((item) => item.image).map((item) => item.id));
  let selectedCategory = filters.find((button) => button.getAttribute("aria-pressed") === "true")?.dataset.categoryFilter || filters[0]?.dataset.categoryFilter;
  let reel = false;
  let reelCards = [], stride = 0, limit = 0, cycleDistance = 0, position = 0, lastTime = null;
  const interaction = ctx.cyclePause([library], () => { lastTime = null; });
  // 推荐作品只指定 id，标题与封面同步读取下方卡片，避免维护两份资料。
  const featured = root.querySelector(".featured-video");
  const recommended = ctx.data.works.find(
    (item) => item.id === featured.dataset.video,
  );
  if (recommended) {
    featured.setAttribute("aria-label", `播放推荐作品《${recommended.title}》`);
    featured.disabled = !recommended.video;
    if (recommended.image) {
      const image = featured.querySelector("img");
      image.src = recommended.image;
      image.alt = `《${recommended.title}》封面`;
    }
    root.querySelector("[data-featured-title]").textContent =
      `《${recommended.title}》`;
  }
  function select(category) {
    selectedCategory = category;
    filters.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.categoryFilter === category),
      );
    });
    cards.forEach((card) => {
      card.hidden = reel ? !covered.has(card.dataset.workId) : card.dataset.category !== category;
    });
    library.querySelector("[data-items]").textContent = String(
      cards.filter((card) => !card.hidden && !card.classList.contains("is-placeholder")).length,
    ).padStart(2, "0");
    library.querySelector("[data-category-title]").textContent =
      filters
        .find((button) => button.dataset.categoryFilter === category)
        ?.textContent.trim() || category;
  }
  function updateContinuation() {
    continuation.hidden = !reel || !cycleDistance;
    if (continuation.hidden) {
      continuation.replaceChildren();
      continuationKey = "";
      return;
    }
    const repeats = Math.max(1, Math.ceil((content.clientHeight + stride) / cycleDistance));
    const key = reelCards.map((card) => card.dataset.workId).join("/") + ":" + repeats;
    if (key === continuationKey) return;
    const fragment = document.createDocumentFragment();
    for (let copy = 0; copy < repeats; copy++) {
      for (const card of reelCards) {
        const preview = card.cloneNode(true);
        for (const element of [preview, ...preview.querySelectorAll("*")]) {
          for (const attribute of [...element.attributes]) {
            if (attribute.name === "id" || attribute.name.startsWith("data-") && !["data-open-work", "data-video"].includes(attribute.name) || ["aria-controls", "aria-labelledby", "aria-describedby"].includes(attribute.name))
              element.removeAttribute(attribute.name);
          }
          if (element.matches("button, a, [tabindex]")) element.tabIndex = -1;
          if (element.matches("img")) element.loading = "eager";
        }
        preview.dataset.reelSource = card.dataset.workId;
        fragment.append(preview);
      }
    }
    continuation.replaceChildren(fragment);
    continuationKey = key;
  }
  function measureReel() {
    const gap = parseFloat(getComputedStyle(grid).rowGap);
    const heights = reelCards.map((card) => card.getBoundingClientRect().height);
    stride = heights.length ? heights[0] + gap : 0;
    cycleDistance = heights.reduce((sum, height) => sum + height + gap, 0);
    updateContinuation();
    limit = Math.max(0, content.scrollHeight - content.clientHeight);
    position = content.scrollTop;
  }
  function syncView() {
    reel = innerWidth > 960 && ctx.data.screens[ctx.state.screen].id === "studio";
    // 循环时轮换原卡片；离开后移除衔接展示并恢复原顺序及分类。
    cards.forEach((card) => grid.append(card));
    select(selectedCategory);
    reelCards = cards.filter((card) => !card.hidden);
    content.scrollTop = 0;
    lastTime = null;
    measureReel();
  }
  const observer = new ResizeObserver(measureReel);
  observer.observe(content);
  cards.forEach((card) => observer.observe(card));
  ctx.subscribe(({ changes }) => {
    if (changes.includes("screen")) syncView();
  });
  ctx.listen(window, "resize", syncView);
  ctx.animate((time) => {
    if (!reel || !ctx.state.motion || document.hidden || innerWidth <= 1360 || interaction.paused() || library.parentElement.classList.contains("window-flight") || !limit) {
      lastTime = null;
      position = content.scrollTop;
      return;
    }
    const delta = lastTime === null ? 0 : time - lastTime;
    lastTime = time;
    position += delta * cycleDistance / ctx.cyclePeriod(reelCards.length);
    while (stride && position >= stride) {
      const first = reelCards.shift();
      grid.append(first);
      reelCards.push(first);
      position -= stride;
      content.scrollTop = position;
      measureReel();
    }
    content.scrollTop = position;
  });
  ctx.cleanup(() => {
    observer.disconnect();
    continuation.remove();
    reel = false;
    cards.forEach((card) => grid.append(card));
    select(selectedCategory);
  });
  function handleClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    const card = button.closest("[data-work-id], [data-reel-source]");
    const id = card?.dataset.workId || card?.dataset.reelSource;
    if (card?.dataset.reelSource) {
      // 衔接展示可用鼠标打开同一作品，键盘和弹窗返回焦点仍指向原卡片。
      const original = cards.find((item) => item.dataset.workId === id);
      original?.querySelector("[data-open-work]")?.focus({ preventScroll: true });
    }
    if (button.hasAttribute("data-category-filter"))
      select(button.dataset.categoryFilter);
    else if (button.hasAttribute("data-open-work")) {
      const work = ctx.data.works.find((item) => item.id === id);
      if (work) ctx.openWork(work);
    } else if (button.hasAttribute("data-video")) {
      const work = ctx.data.works.find((item) => item.id === (id || button.dataset.video));
      if (work?.video) ctx.openVideo(work);
    } else if (button.hasAttribute("data-archive")) ctx.openArchive();
  }
  ctx.listen(featured, "click", handleClick);
  ctx.listen(library, "click", handleClick);
  syncView();
});

;

/* modules/sections/studio/studio.js */
/* 节点选择驱动主窗口的静态介绍面板；插图与流程文案直接维护在 HTML。 */
MM.register("studio", (ctx) => {
  const scene = ctx.find("#studio");
  const workflow = scene.querySelector(".workflow-window");
  const panels = [...scene.querySelectorAll("[data-phase-panel]")];
  const workflowGroup = scene.querySelector(".studio-workflow");
  const workflowBody = workflow.querySelector(".window-body");
  const nodeStage = scene.querySelector("[data-node-stage]");
  const grid = scene.querySelector(".studio-grid");
  const mobile = matchMedia("(max-width: 960px)");
  let layoutFrame = 0;

  function placeNodeStage() {
    if (mobile.matches) {
      if (nodeStage.parentElement !== workflowBody) workflowBody.prepend(nodeStage);
    } else if (nodeStage.parentElement !== workflowGroup) {
      workflowGroup.insertBefore(nodeStage, workflow);
    }
  }
  function fitStudio() {
    layoutFrame = 0;
    if (mobile.matches) {
      grid.style.removeProperty("--studio-overflow");
      return;
    }
    const overflow = Math.max(0, Math.ceil(radioWindow.getBoundingClientRect().bottom - grid.getBoundingClientRect().bottom));
    grid.style.setProperty("--studio-overflow", overflow + "px");
  }
  function scheduleLayout() {
    if (!layoutFrame) layoutFrame = requestAnimationFrame(fitStudio);
  }
  function revealWorkflow() {
    if (!matchMedia("(max-width: 960px)").matches) return;
    const scroller = ctx.find("[data-sequence]");
    const viewport = scroller.getBoundingClientRect();
    const padding = getComputedStyle(scroller);
    const top = viewport.top + Number.parseFloat(padding.scrollPaddingTop);
    const bottom = viewport.bottom - Number.parseFloat(padding.scrollPaddingBottom);
    const target = matchMedia("(min-width: 641px)").matches ? scene.querySelector(".studio-lead") : workflowGroup;
    const bounds = nodeStage.getBoundingClientRect();
    if (bounds.top >= top && bounds.bottom <= bottom) return;
    target.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function update() {
    const index = ctx.state.phase;
    const panel = panels[index];
    if (!panel) return;
    panels.forEach((item, i) => { item.hidden = i !== index; });
    workflow.querySelector("[data-monitor-english]").textContent = panel.querySelector(".mono").textContent;
    workflow.querySelector("[data-phase-status]").textContent = panel.querySelector("h3").textContent;
    workflow.querySelector("[data-phase-number]").textContent = String(index + 1).padStart(2, "0") + " / " + String(panels.length).padStart(2, "0");
  }
  const radio = scene.querySelector(".radio-art");
  const radioWindow = scene.querySelector(".radio-window");
  const issues = [...radioWindow.querySelectorAll("[data-radio-issue]")];
  const previousIssue = radioWindow.querySelector("[data-radio-previous]");
  const nextIssue = radioWindow.querySelector("[data-radio-next]");
  const layoutObserver = new ResizeObserver(scheduleLayout);
  layoutObserver.observe(grid);
  layoutObserver.observe(radioWindow);
  ctx.listen(window, "resize", () => { placeNodeStage(); scheduleLayout(); });
  let issueIndex = 0;
  let issueTimer = 0;
  const radioInteraction = ctx.cyclePause([radioWindow], scheduleIssues);
  previousIssue.disabled = nextIssue.disabled = issues.length < 2;

  function updateIssue() {
    issues.forEach((issue, index) => { issue.hidden = index !== issueIndex; });
    radioWindow.querySelector("[data-radio-number]").textContent = String(issues.length ? issueIndex + 1 : 0).padStart(2, "0") + " / " + String(issues.length).padStart(2, "0");
  }
  function scheduleIssues() {
    clearTimeout(issueTimer);
    issueTimer = 0;
    if (issues.length < 2 || !ctx.state.motion || document.hidden || ctx.data.screens[ctx.state.screen].id !== "studio" || radioInteraction.paused()) return;
    issueTimer = setTimeout(() => {
      stepIssue(1);
    }, ctx.cycleInterval(issues.length));
  }
  function stepIssue(direction) {
    if (!issues.length) return;
    issueIndex = (issueIndex + direction + issues.length) % issues.length;
    updateIssue();
    scheduleIssues();
  }
  ctx.listen(previousIssue, "click", () => stepIssue(-1));
  ctx.listen(nextIssue, "click", () => stepIssue(1));
  ctx.listen(document, "visibilitychange", scheduleIssues);
  ctx.listen(scene, "click", (event) => {
    if (event.target.closest("[data-node]")) revealWorkflow();
  });
  ctx.listen(radio, "click", () => {
    const image = radio.querySelector("img");
    ctx.openImage(image.getAttribute("src"), radio.dataset.imageTitle || image.alt, radio.dataset.imageCaption || "");
  });
  ctx.subscribe(({ changes }) => {
    if (changes.includes("phase")) update();
    if (changes.includes("screen") || changes.includes("motion")) scheduleIssues();
  });
  ctx.cleanup(() => {
    layoutObserver.disconnect();
    cancelAnimationFrame(layoutFrame);
    workflowGroup.insertBefore(nodeStage, workflow);
    grid.style.removeProperty("--studio-overflow");
    clearTimeout(issueTimer);
    issueIndex = 0;
    updateIssue();
  });
  updateIssue();
  placeNodeStage();
  fitStudio();
  scheduleIssues();
  update();
});

;

/* modules/sections/stories/stories.js */
MM.register("stories", (ctx) => {
  const scene = ctx.find("#stories");
  const photos = [...scene.querySelectorAll("[data-story-carousel]")].filter((element) => !element.hasAttribute("data-story-voice-lane")).map((element) => ({ element, slides: [...element.querySelectorAll("[data-story-slide]")], index: 0, timer: 0 }));
  const wrap = (value, length) => (value % length + length) % length;
  function update(display) {
    display.slides.forEach((slide, index) => {
      const inactive = index !== display.index;
      slide.setAttribute("aria-hidden", String(inactive));
      slide.inert = inactive;
    });
    display.element.querySelector("[data-story-number]").textContent = String(display.index + 1).padStart(2, "0") + " / " + String(display.slides.length).padStart(2, "0");
  }
  const active = (interaction) => ctx.state.motion && !document.hidden && ctx.data.screens[ctx.state.screen].id === "stories" && !interaction.paused();
  function schedulePhoto(display) {
    clearTimeout(display.timer);
    display.timer = 0;
    if (display.slides.length < 2 || !active(display.interaction)) return;
    display.timer = setTimeout(() => stepPhoto(display, 1), ctx.cycleInterval(display.slides.length));
  }
  function stepPhoto(display, direction) {
    display.index = wrap(display.index + direction, display.slides.length);
    update(display);
    schedulePhoto(display);
  }

  function sync() { photos.forEach(schedulePhoto); }
  photos.forEach((display) => {
    display.interaction = ctx.cyclePause([display.element], () => schedulePhoto(display));
    for (const [selector, direction] of [["[data-story-previous]", -1], ["[data-story-next]", 1]]) {
      const button = display.element.querySelector(selector);
      button.disabled = display.slides.length < 2;
      ctx.listen(button, "click", () => stepPhoto(display, direction));
    }
    update(display);
  });

  ctx.listen(document, "visibilitychange", sync);
  ctx.subscribe(({ changes }) => { if (changes.includes("screen") || changes.includes("motion")) sync(); });
  ctx.cleanup(() => { photos.forEach((display) => { clearTimeout(display.timer); display.index = 0; update(display); }); });
  sync();
});

/* 年度组手动切换；同年署名原文连续展示，不轮播或折叠。 */
MM.register("creation-notes", (ctx) => {
  const window = ctx.find("#stories .creation-window");
  const editions = [...window.querySelectorAll("[data-creation-edition]")];
  if (!editions.length) return;
  const scroller = window.querySelector("[data-creation-scroll]");
  const yearLabel = window.querySelector("[data-creation-year-label]");
  const number = window.querySelector("[data-creation-number]");
  let index = 0;
  function update() {
    editions.forEach((edition, position) => {
      edition.hidden = position !== index;
      edition.inert = edition.hidden;
    });
    yearLabel.textContent = `NOTES / ${editions[index].dataset.creationYear || "年份待补"}`;
    number.textContent = `${String(index + 1).padStart(2, "0")} / ${String(editions.length).padStart(2, "0")}`;
  }
  for (const [selector, direction] of [["[data-creation-previous]", -1], ["[data-creation-next]", 1]]) {
    const button = window.querySelector(selector);
    button.disabled = editions.length < 2;
    ctx.listen(button, "click", () => {
      if (editions.length < 2) return;
      index = (index + direction + editions.length) % editions.length;
      update();
      scroller.scrollTop = 0;
    });
  }
  ctx.cleanup(() => { index = 0; update(); scroller.scrollTop = 0; });
  update();
});

;

/* modules/sections/contact/contact.js */
/* 将 mailto 链接和复制按钮填入 contact.html 后自动启用复制。 */
MM.register("contact", (ctx) => {
  const root = ctx.find("#contact");
  ctx.listen(root, "click", async (event) => {
    if (event.target.closest("[data-archive]")) ctx.openArchive();
    if (!event.target.closest("[data-copy-email]")) return;
    const link = root.querySelector('a[href^="mailto:"]');
    const email = link?.getAttribute("href").slice(7).split("?")[0];
    if (!email) return;
    try {
      await navigator.clipboard.writeText(decodeURIComponent(email));
      ctx.toast("邮箱已复制");
    } catch {
      ctx.toast("请选中邮箱手动复制");
    }
  });
});

/* 寄语只在联系页运行，内容仍由构建器从 voices.jsonc 导入。 */
MM.register("contact-voices", (ctx) => {
  const scene = ctx.find("#contact");
  const voiceWindow = scene.querySelector(".quotes-window");
  if (!voiceWindow) return;
  const voices = [...voiceWindow.querySelectorAll("[data-story-voice-lane]")].map((element) => ({ element, voice: true, slides: [...element.querySelectorAll("[data-story-slide]")], index: 0 }));
  const restoreLegacyViews = [];
  // 旧预览可能仍生成奇偶分组的 HTML。先从实际卡片恢复完整名单，不能用一半的长度索引另一半。
  if (voices.some((display) => display.element.hasAttribute("data-story-offset"))) {
    const pool = new Map();
    const length = Math.max(...voices.map((display) => display.slides.length));
    for (let index = 0; index < length; index++) {
      voices.forEach((display) => {
        const card = display.slides[index];
        if (card) pool.set(card.dataset.voiceId, card);
      });
    }
    voices.forEach((display) => {
      const stage = display.element.querySelector(".story-slides");
      const original = display.slides.map((card) => ({ card, hidden: card.getAttribute("aria-hidden"), inert: card.inert }));
      const existing = new Map(display.slides.map((card) => [card.dataset.voiceId, card]));
      const copies = [];
      display.slides = [...pool].map(([id, source]) => {
        if (existing.has(id)) return existing.get(id);
        const card = source.cloneNode(true);
        card.setAttribute("aria-hidden", "true");
        card.inert = true;
        copies.push(card);
        return card;
      });
      stage.append(...display.slides);
      restoreLegacyViews.push(() => {
        copies.forEach((card) => card.remove());
        stage.append(...original.map(({ card }) => card));
        original.forEach(({ card, hidden, inert }) => { card.setAttribute("aria-hidden", hidden); card.inert = inert; });
      });
    });
  }
  // 兼容仍包含旧页脚标注的已打开页面。
  voiceWindow.querySelector("[data-voices-number]")?.remove();
  const voiceCount = voices[0]?.slides.length || 0;
  // 奇数人数需走两遍名单才能恢复原来的上下位置；每遍名单仍使用共享循环时长。
  const voicePeriod = voiceCount > 2 && voiceCount % 2 ? voiceCount * 2 : voiceCount;
  let voiceStep = 0, voiceTimer = 0;
  const voiceInteraction = ctx.cyclePause([voiceWindow], scheduleVoices);
  const wrap = (value, length) => (value % length + length) % length;
  function update(display) {
    display.slides.forEach((slide, index) => {
      const inactive = index !== display.index;
      slide.setAttribute("aria-hidden", String(inactive));
      slide.inert = inactive;
    });
  }
  function updateVoices() {
    voices.forEach((display, lane) => {
      const index = voiceCount <= 2
        ? voiceStep + lane
        : lane ? 2 * Math.floor(voiceStep / 2) + 1 : 2 * Math.ceil(voiceStep / 2);
      display.index = wrap(index, voiceCount);
      update(display);
    });
  }

  const active = () => ctx.state.motion && !document.hidden && ctx.data.screens[ctx.state.screen].id === "contact" && !voiceInteraction.paused();
  function scheduleVoices() {
    clearTimeout(voiceTimer);
    voiceTimer = 0;
    if (voiceCount < 2 || !active()) return;
    voiceTimer = setTimeout(() => stepVoices(1), ctx.cycleInterval(voiceCount));
  }
  function stepVoices(direction) {
    if (voiceCount < 2) return;
    voiceStep = wrap(voiceStep + direction, voicePeriod);
    updateVoices();
    scheduleVoices();
  }

  for (const [selector, direction] of [["[data-voices-previous]", -1], ["[data-voices-next]", 1]]) {
    const button = voiceWindow.querySelector(selector);
    button.disabled = voiceCount < 2;
    ctx.listen(button, "click", () => stepVoices(direction));
  }

  ctx.listen(document, "visibilitychange", scheduleVoices);
  ctx.subscribe(({ changes }) => {
    if (changes.includes("screen") || changes.includes("motion")) scheduleVoices();
  });
  ctx.cleanup(() => {
    clearTimeout(voiceTimer);
    voiceStep = 0;
    updateVoices();
    restoreLegacyViews.forEach((restore) => restore());
  });
  updateVoices();
  scheduleVoices();
});

;

/* scripts/core/sequence.js */
MM.register("sequence", (ctx) => {
  const scroller = ctx.find("[data-sequence]"),
    screens = ctx.all("[data-section]"),
    chrome = ctx.find("[data-chrome]");
  let pending = 0;
  const mobile = matchMedia("(max-width: 960px)");
  const nativeScrollEnd = "onscrollend" in scroller;
  let settleTimer = 0;
  let touching = false;
  let settledTop = scroller.scrollTop;
  function settle() {
    clearTimeout(settleTimer);
    settleTimer = 0;
    if (!mobile.matches || touching) return;
    const padding = getComputedStyle(scroller);
    const readingHeight = scroller.clientHeight
      - Number.parseFloat(padding.scrollPaddingTop)
      - Number.parseFloat(padding.scrollPaddingBottom);
    const threshold = Math.max(40, Math.min(96, readingHeight * 0.16));
    const nearest = screens.reduce((best, screen) =>
      Math.abs(screen.offsetTop - scroller.scrollTop) < Math.abs(best.offsetTop - scroller.scrollTop)
        ? screen : best,
    );
    const distance = Math.abs(nearest.offsetTop - scroller.scrollTop);
    const leavingStart = Math.abs(nearest.offsetTop - settledTop) < 1;
    settledTop = scroller.scrollTop;
    // 已经停在章首时，下一次小幅滑动应能离开，不能被辅助对齐拉回。
    if (distance < 1 || distance > threshold || leavingStart) return;
    settledTop = nearest.offsetTop;
    scroller.scrollTo({
      top: nearest.offsetTop,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }
  function scheduleSettle() {
    clearTimeout(settleTimer);
    if (!nativeScrollEnd && mobile.matches && !touching)
      settleTimer = setTimeout(settle, 180);
  }
  function measure() {
    pending = 0;
    const viewport = scroller.clientHeight,
      // 章节判定使用稳定的应用视口，不依赖导航／轨道的显隐或阅读区留白。
      middle = scroller.scrollTop + ctx.root.clientHeight * 0.45;
    let index = 0;
    screens.forEach((screen, i) => {
      if (screen.offsetTop <= middle) index = i;
    });
    const screen = ctx.data.screens[index],
      visible = index > 0;
    ctx.root.dataset.screen = screen.id;
    ctx.root.classList.toggle("workspace-entered", visible);
    chrome.inert = !visible;
    chrome.setAttribute("aria-hidden", String(!visible));
    ctx.root.style.setProperty("--scene-color", screen.color);
    const patch = {
      screen: index,
      progress: Math.max(
        0,
        Math.min(
          1,
          scroller.scrollTop / Math.max(1, scroller.scrollHeight - viewport),
        ),
      ),
    };
    if (index !== ctx.state.screen) patch.tint = screen.color;
    ctx.set(patch);
    screens.forEach((node, i) =>
      node.classList.toggle("is-current", i === index),
    );
  }
  function schedule() {
    if (!pending) pending = requestAnimationFrame(measure);
  }
  ctx.listen(scroller, "scroll", schedule, { passive: true });
  ctx.listen(scroller, "scroll", scheduleSettle, { passive: true });
  if (nativeScrollEnd) ctx.listen(scroller, "scrollend", settle);
  ctx.listen(scroller, "touchstart", () => {
    touching = true;
    clearTimeout(settleTimer);
  }, { passive: true });
  const releaseTouch = () => { touching = false; scheduleSettle(); };
  ctx.listen(scroller, "touchend", releaseTouch, { passive: true });
  ctx.listen(scroller, "touchcancel", releaseTouch, { passive: true });
  ctx.listen(window, "resize", schedule);
  ctx.listen(ctx.root, "click", (e) => {
    const link = e.target.closest("[data-go]");
    if (link) {
      e.preventDefault();
      ctx.navigate(link.dataset.go);
    }
  });
  ctx.listen(window, "hashchange", () => {
    const id = location.hash.slice(1);
    if (ctx.data.screens.some((s) => s.id === id)) ctx.navigate(id);
  });
  const initial = location.hash.slice(1);
  if (ctx.data.screens.some((s) => s.id === initial))
    scroller.scrollTop = ctx.find(`#${initial}`).offsetTop;
  settledTop = scroller.scrollTop;
  measure();
  ctx.cleanup(() => {
    cancelAnimationFrame(pending);
    clearTimeout(settleTimer);
  });
});

;

/* scripts/app.js */
(() => {
  const instances = new WeakMap();
  function mount(root) {
    if (!root) return () => {};
    instances.get(root)?.();
    const ctx = MM.createContext(root);
    MM.registry.forEach((init) => init(ctx));
    root.dataset.enhanced = "true";
    const destroy = () => {
      ctx.destroy();
      instances.delete(root);
    };
    instances.set(root, destroy);
    return destroy;
  }
  window.MovieMusicPage = { mount };
  mount(document.getElementById("movie-and-music"));
})();

