// Shared, DOM-free typography contract. Both frontends consume these exact values.
(function typographyPreferences(root) {
  function freeze(value) {
    Object.values(value).forEach((entry) => {
      if (entry && typeof entry === 'object') freeze(entry);
    });
    return Object.freeze(value);
  }

  const STORAGE_KEY = 'free_bbs_typography_preferences';
  const presets = freeze({
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
      weights: { zhBody: 300 },
      fonts: {
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
  const typeScalePresets = freeze({
    standard: { name: '标准', description: '保持当前页面密度。', rootSize: '100%' },
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
  const defaults = freeze({ fontPreset: 'transistor-lab', typeScale: 'comfortable' });
  // The bundled reading face is deliberately regular 400, not the lighter site body.
  const knowledgeBody = freeze({
    family: '"FREEBBS Knowledge Serif", "Noto Serif SC", "STSong", "SimSun", serif',
    weight: 400,
  });

  function ownKey(values, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(values, key);
  }

  function normalize(preferences) {
    const value =
      preferences !== null && typeof preferences === 'object' && !Array.isArray(preferences)
        ? preferences
        : {};
    return {
      fontPreset: ownKey(presets, value.fontPreset) ? value.fontPreset : defaults.fontPreset,
      typeScale: ownKey(typeScalePresets, value.typeScale) ? value.typeScale : defaults.typeScale,
    };
  }

  function read(readStoredPreferences) {
    try {
      return normalize(JSON.parse(readStoredPreferences() || '{}'));
    } catch {
      return { ...defaults };
    }
  }

  function cssVariables(preferences) {
    const normalized = normalize(preferences);
    const preset = presets[normalized.fontPreset];
    const variables = {};
    Object.entries(preset.fonts).forEach(([role, family]) => {
      const cssRole = role.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
      variables[`--font-${cssRole}`] = family;
    });
    variables['--font-zh-body-weight'] = String(preset.weights?.zhBody || 400);
    variables['--type-scale-rem'] = typeScalePresets[normalized.typeScale].rootSize;
    variables['--font-knowledge-body'] = knowledgeBody.family;
    variables['--font-knowledge-body-weight'] = String(knowledgeBody.weight);
    return variables;
  }

  function mainSiteVariables(preferences) {
    const normalized = normalize(preferences);
    const fonts = presets[normalized.fontPreset].fonts;
    const ratio = Number.parseFloat(typeScalePresets[normalized.typeScale].rootSize) / 100;
    return {
      '--main-site-ui-font': fonts.zhUi,
      '--main-site-ui-size': `${16 * ratio}px`,
      '--main-site-type-scale': String(ratio),
      '--font-ui': fonts.zhUi,
      '--font-display': fonts.zhTitle,
    };
  }

  const contract = Object.freeze({
    STORAGE_KEY,
    presets,
    typeScalePresets,
    defaults,
    knowledgeBody,
    normalize,
    read,
    cssVariables,
    mainSiteVariables,
  });
  root.freeBbsTypographyPreferences = contract;
  if (typeof window !== 'undefined') window.freeBbsTypographyPreferences = contract;
  if (typeof module !== 'undefined' && module.exports) module.exports = contract;
})(globalThis);
