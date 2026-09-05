(() => {
  const STORAGE_KEY = 'free_bbs_typography_preferences';

  const TYPOGRAPHY_PRESETS = Object.freeze({
    'transistor-lab': {
      name: '清晰阅读',
      description: '中文正文和界面采用清爽无衬线，适合长时间阅读课程、表格和讨论。',
      fonts: {
        zhBody: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
        zhTitle: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
        zhUi: '"HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
        latin: '"Segoe UI", "Source Sans Pro", Arial, sans-serif',
        math: '"KaTeX_Main", "STIX Two Math", "Cambria Math", "Times New Roman", serif',
        code: '"Cascadia Code", "Consolas", "SFMono-Regular", monospace',
      },
    },
    'zhongsong-study': {
      name: '中宋书卷',
      description: '中文正文和标题采用中宋风格，保留纸张感；按钮仍保持利落。',
      weights: {
        // The body uses the lighter face/weight; semantic emphasis remains 700.
        zhBody: 300,
      },
      fonts: {
        // Keep the reading body light; the heavier 中宋 face remains reserved
        // for titles so ordinary paragraphs do not look globally bold.
        zhBody:
          '"Source Han Serif SC Light", "Noto Serif SC Light", "Noto Serif SC", "STSong", "SimSun", serif',
        zhTitle: '"Source Han Serif SC", "Noto Serif SC", "STZhongsong", "华文中宋", serif',
        zhUi: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
        latin: '"Source Sans Pro", "Segoe UI", Arial, sans-serif',
        math: '"KaTeX_Main", "STIX Two Math", "Cambria Math", "Times New Roman", serif',
        code: '"Cascadia Mono", "Consolas", "SFMono-Regular", monospace',
      },
    },
    'quantum-board': {
      name: '衬线标题',
      description: '正文和操作控件保持明快，只为中文标题加入衬线风格。',
      fonts: {
        zhBody: '"HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
        zhTitle: '"Noto Serif SC", "Source Han Serif SC", "STZhongsong", serif',
        zhUi: '"HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
        latin: '"Segoe UI", Arial, sans-serif',
        math: '"KaTeX_Main", "Cambria Math", "STIX Two Math", "Times New Roman", serif',
        code: '"Cascadia Code", "Consolas", "SFMono-Regular", monospace',
      },
    },
    'night-oscilloscope': {
      name: '高对比代码',
      description: '提高英文、数字和代码的对比度，适合深色模式与技术内容阅读。',
      fonts: {
        zhBody: '"Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif',
        zhTitle: '"Syne", "Noto Serif SC", "Source Han Serif SC", serif',
        zhUi: '"Segoe UI", "Microsoft YaHei", sans-serif',
        latin: '"Syne", "Segoe UI", Arial, sans-serif',
        math: '"KaTeX_Main", "STIX Two Math", "Cambria Math", "Times New Roman", serif',
        code: '"Consolas", "Cascadia Mono", "SFMono-Regular", monospace',
      },
    },
  });

  const TYPE_SCALE_PRESETS = Object.freeze({
    standard: {
      name: '标准',
      description: '保持当前页面密度。',
      rootSize: '100%',
    },
    comfortable: {
      name: '舒适',
      description: '正文和控件略放大，适合日常使用。',
      rootSize: '108%',
    },
    large: {
      name: '大字',
      description: '进一步放大阅读文字，适合投屏或视力友好场景。',
      rootSize: '118%',
    },
  });

  const DEFAULT_TYPOGRAPHY_PREFERENCES = Object.freeze({
    fontPreset: 'transistor-lab',
    typeScale: 'comfortable',
  });

  let currentPreferences = { ...DEFAULT_TYPOGRAPHY_PREFERENCES };

  function normalizePreferences(preferences) {
    const value = preferences && typeof preferences === 'object' ? preferences : {};
    return {
      fontPreset:
        typeof value.fontPreset === 'string' &&
        Object.prototype.hasOwnProperty.call(TYPOGRAPHY_PRESETS, value.fontPreset)
          ? value.fontPreset
          : DEFAULT_TYPOGRAPHY_PREFERENCES.fontPreset,
      typeScale:
        typeof value.typeScale === 'string' &&
        Object.prototype.hasOwnProperty.call(TYPE_SCALE_PRESETS, value.typeScale)
          ? value.typeScale
          : DEFAULT_TYPOGRAPHY_PREFERENCES.typeScale,
    };
  }

  function getStoredPreferences() {
    try {
      return normalizePreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
    } catch {
      return { ...DEFAULT_TYPOGRAPHY_PREFERENCES };
    }
  }

  function getCurrentPreferences() {
    return { ...currentPreferences };
  }

  function applyPreferences(preferences) {
    const normalized = normalizePreferences(preferences);
    const root = document.documentElement;
    const preset = TYPOGRAPHY_PRESETS[normalized.fontPreset];
    const scale = TYPE_SCALE_PRESETS[normalized.typeScale];

    Object.entries(preset.fonts).forEach(([role, family]) => {
      const cssRole = role.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
      root.style.setProperty(`--font-${cssRole}`, family);
    });
    root.style.setProperty('--font-zh-body-weight', String(preset.weights?.zhBody || 400));
    root.dataset.fontPreset = normalized.fontPreset;
    root.dataset.typeScale = normalized.typeScale;
    root.style.setProperty('--type-scale-rem', scale.rootSize);
    currentPreferences = normalized;
    return getCurrentPreferences();
  }

  function savePreferences(preferences) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePreferences(preferences)));
      return true;
    } catch {
      // Storage can be full or unavailable. Keep the current page's applied settings.
      return false;
    }
  }

  window.freeBbsTypography = Object.freeze({
    getStoredPreferences,
    getCurrentPreferences,
    applyPreferences,
    savePreferences,
    presets: TYPOGRAPHY_PRESETS,
    typeScalePresets: TYPE_SCALE_PRESETS,
  });

  // Reading a page never requires storage to be writable.
  applyPreferences(getStoredPreferences());
})();
