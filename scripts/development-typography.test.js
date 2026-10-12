const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// Node 24 imports the same TypeScript helper used by the development header.
const typography = import(
  pathToFileURL(path.join(__dirname, '../development/apps/web/src/app/main-site-typography.ts'))
    .href
);

const fonts = {
  'transistor-lab': {
    title: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
    ui: '"HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  },
  'zhongsong-study': {
    title: '"Source Han Serif SC", "Noto Serif SC", "STZhongsong", "华文中宋", serif',
    ui: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
  },
  'quantum-board': {
    title: '"Noto Serif SC", "Source Han Serif SC", "STZhongsong", serif',
    ui: '"HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  },
  'night-oscilloscope': {
    title: '"Syne", "Noto Serif SC", "Source Han Serif SC", serif',
    ui: '"Segoe UI", "Microsoft YaHei", sans-serif',
  },
};

function expectedStyle(fontPreset = 'transistor-lab', scale = 17.28) {
  return {
    '--main-site-ui-font': fonts[fontPreset].ui,
    '--main-site-ui-size': `${scale}px`,
    '--main-site-type-scale': String(scale / 16),
    '--font-ui': fonts[fontPreset].ui,
    '--font-display': fonts[fontPreset].title,
  };
}

test('development typography keeps all existing preset and scale combinations', async () => {
  const { readMainSiteTypography, MAIN_SITE_TYPOGRAPHY_STORAGE_KEY } = await typography;
  assert.equal(MAIN_SITE_TYPOGRAPHY_STORAGE_KEY, 'free_bbs_typography_preferences');
  for (const fontPreset of Object.keys(fonts)) {
    for (const [typeScale, scale] of Object.entries({
      standard: 16,
      comfortable: 17.28,
      large: 18.88,
    })) {
      assert.deepEqual(
        readMainSiteTypography(() => JSON.stringify({ fontPreset, typeScale })),
        expectedStyle(fontPreset, scale),
      );
    }
  }
});

for (const raw of [
  null,
  '',
  '{broken',
  'null',
  '[]',
  '["night-oscilloscope"]',
  '"text"',
  '42',
  'true',
  '{}',
]) {
  test(`development typography defaults safely for invalid stored data: ${raw}`, async () => {
    const { readMainSiteTypography } = await typography;
    assert.deepEqual(
      readMainSiteTypography(() => raw),
      expectedStyle(),
    );
  });
}

for (const key of ['unknown', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
  test(`development typography rejects unsupported and inherited preset keys: ${key}`, async () => {
    const { readMainSiteTypography } = await typography;
    assert.deepEqual(
      readMainSiteTypography(() => JSON.stringify({ fontPreset: key, typeScale: key })),
      expectedStyle(),
    );
  });
}

test('development typography normalizes each preference independently', async () => {
  const { readMainSiteTypography } = await typography;
  for (const invalid of [null, true, 42, [], {}, '__proto__']) {
    assert.deepEqual(
      readMainSiteTypography(() => JSON.stringify({ fontPreset: invalid, typeScale: 'large' })),
      expectedStyle('transistor-lab', 18.88),
    );
    assert.deepEqual(
      readMainSiteTypography(() =>
        JSON.stringify({ fontPreset: 'night-oscilloscope', typeScale: invalid }),
      ),
      expectedStyle('night-oscilloscope'),
    );
  }
});

test('development typography tolerates unavailable storage without invalid CSS values', async () => {
  const { readMainSiteTypography } = await typography;
  let reads = 0;
  const style = readMainSiteTypography(() => {
    reads += 1;
    throw new Error('SecurityError');
  });
  assert.equal(reads, 1);
  assert.deepEqual(style, expectedStyle());
  for (const value of Object.values(style)) {
    assert.equal(typeof value, 'string');
    assert.doesNotMatch(value, /NaN|undefined/);
  }
});
