(() => {
  // A missing optional preference asset must never suppress early theme setup.
  // Raw and generated entry contracts still require it before this controller.
  const typography = globalThis.freeBbsTypographyPreferences;
  if (typography) initializeTypography(typography);
  else initializeFallbackTypography();

  function initializeFallbackTypography() {
    // A failed asset request retains the installed CSS fallbacks and a usable
    // settings API. Never overwrite saved preferences from this degraded state.
    const fallback = Object.freeze({ fontPreset: 'transistor-lab', typeScale: 'comfortable' });
    const preferences = () => ({ ...fallback });
    window.freeBbsTypography = Object.freeze({
      getStoredPreferences: preferences,
      getCurrentPreferences: preferences,
      applyPreferences: preferences,
      savePreferences: () => false,
      presets: Object.freeze({
        [fallback.fontPreset]: Object.freeze({ name: '当前字体', description: '', fonts: {} }),
      }),
      typeScalePresets: Object.freeze({
        [fallback.typeScale]: Object.freeze({ name: '当前字号', description: '' }),
      }),
    });
  }

  function initializeTypography(contract) {
    let currentPreferences = { ...contract.defaults };

    function getStoredPreferences() {
      return contract.read(() => window.localStorage.getItem(contract.STORAGE_KEY));
    }

    function getCurrentPreferences() {
      return { ...currentPreferences };
    }

    function applyPreferences(preferences) {
      const normalized = contract.normalize(preferences);
      const root = document.documentElement;
      Object.entries(contract.cssVariables(normalized)).forEach(([name, value]) => {
        root.style.setProperty(name, value);
      });
      root.dataset.fontPreset = normalized.fontPreset;
      root.dataset.typeScale = normalized.typeScale;
      currentPreferences = normalized;
      return getCurrentPreferences();
    }

    function savePreferences(preferences) {
      try {
        window.localStorage.setItem(
          contract.STORAGE_KEY,
          JSON.stringify(contract.normalize(preferences)),
        );
        return true;
      } catch {
        // Keep this page's applied settings when storage is full or unavailable.
        return false;
      }
    }

    window.freeBbsTypography = Object.freeze({
      getStoredPreferences,
      getCurrentPreferences,
      applyPreferences,
      savePreferences,
      presets: contract.presets,
      typeScalePresets: contract.typeScalePresets,
    });
    // Reading never requires storage to be writable.
    applyPreferences(getStoredPreferences());
  }

  // This script runs at the start of <body>, before any page controller. Keep
  // theme application here so every entry, including embedded pages, agrees.
  const THEME_STORAGE_KEY = 'free_bbs_theme_mode';
  let currentMode = 'dark';
  const themeListeners = new Set();

  function getStoredMode() {
    try {
      return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return currentMode;
    }
  }

  function initialMode() {
    try {
      if (window.parent && window.parent !== window) {
        const parentBody = window.parent.document.body;
        if (parentBody?.classList.contains('theme-light')) return 'light';
        if (parentBody?.classList.contains('theme-dark')) return 'dark';
      }
    } catch {
      // An embedded page can only read its parent when they share an origin.
    }
    return getStoredMode();
  }

  function themePeers() {
    const peers = Array.from(document.querySelectorAll('iframe'), (frame) => frame.contentWindow);
    if (window.parent && window.parent !== window) peers.push(window.parent);
    return peers.filter(Boolean);
  }

  function sendTheme(peer, mode) {
    peer.postMessage({ type: 'freebbs:theme-sync', mode }, window.location.origin);
  }

  function applyMode(mode, { broadcast = true, source = null } = {}) {
    const normalizedMode = mode === 'light' ? 'light' : 'dark';
    const changed = currentMode !== normalizedMode;
    currentMode = normalizedMode;
    document.body?.classList.toggle('theme-light', normalizedMode === 'light');
    document.body?.classList.toggle('theme-dark', normalizedMode === 'dark');
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const light = normalizedMode === 'light';
      const label = light ? '切换到暗色模式' : '切换到明亮模式';
      button.setAttribute('aria-pressed', String(light));
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = `
        <img class="nav-icon theme-toggle-icon" src="/assets/icons/${light ? 'moon' : 'sun'}.svg" alt="" aria-hidden="true" />
        <span>${light ? '暗色模式' : '明亮模式'}</span>
      `;
    });
    if (changed) {
      themeListeners.forEach((listener) => listener(normalizedMode));
      if (broadcast) {
        themePeers().forEach((peer) => {
          if (peer !== source) sendTheme(peer, normalizedMode);
        });
      }
    }
    return normalizedMode;
  }

  function saveMode(mode) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode === 'light' ? 'light' : 'dark');
      return true;
    } catch {
      // The visible selection still works when storage is blocked or full.
      return false;
    }
  }

  window.freeBbsTheme = Object.freeze({
    getStoredMode,
    getCurrentMode: () => currentMode,
    applyMode,
    saveMode,
    subscribe(listener) {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
  });

  applyMode(initialMode(), { broadcast: false });
  window.addEventListener?.('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY) applyMode(event.newValue);
    else if (event.key === null) applyMode(getStoredMode());
  });
  window.addEventListener?.('message', (event) => {
    if (event.origin !== window.location.origin || !themePeers().includes(event.source)) return;
    if (event.data?.type === 'freebbs:theme-request') sendTheme(event.source, currentMode);
    else if (
      event.data?.type === 'freebbs:theme-sync' &&
      ['light', 'dark'].includes(event.data.mode)
    )
      applyMode(event.data.mode, { source: event.source });
  });
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'freebbs:theme-request' }, window.location.origin);
  }
})();
