const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const tokens = read('public/theme-tokens.css');
const actions = read('public/actions.css');
const polish = read('public/ui-polish.css');

function contrast(foreground, background) {
  const luminance = (hex) => {
    const [red, green, blue] = hex
      .slice(1)
      .match(/.{2}/g)
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('one canonical polish entry imports shared themes, actions, and loading states', () => {
  assert.match(polish, /@import url\('\/theme-tokens\.css'\);/);
  assert.match(polish, /@import url\('\/actions\.css'\);/);
  assert.match(polish, /@import url\('\/ui-state\.css'\);/);
  assert.ok(polish.indexOf("@import url('/theme-tokens.css')") < polish.indexOf(':root {'));
  assert.doesNotMatch(polish, /--ui-(?:page|surface|text|action|focus|danger)\s*:/);
});

test('semantic aliases resolve on the themed body instead of inheriting stale light values', () => {
  const aliasBlock = tokens.match(/:root,\s*body\s*\{([^}]+)\}/)?.[1];
  assert.ok(aliasBlock, 'theme aliases must be recomputed on body');
  for (const name of ['primary', 'secondary', 'quiet', 'danger', 'focus']) {
    assert.match(aliasBlock, new RegExp(`--action-${name}(?:-[a-z-]+)?:`));
  }
  assert.match(aliasBlock, /--action-danger-text:\s*var\(--ui-danger-contrast\)/);
  assert.match(tokens, /body\.theme-dark\s*\{[^}]*--ui-danger-contrast:\s*#071317;/);
});

test('opt-in action tones do not collide with delegated business data-action attributes', () => {
  for (const tone of ['primary', 'quiet', 'danger']) {
    assert.ok(actions.includes(`.bbs-action[data-action-tone='${tone}']`));
  }
  assert.doesNotMatch(actions, /\[data-action=/);
  assert.doesNotMatch(actions, /!important|(?:^|[;{\s])transform\s*:/);
  assert.match(actions, /:hover:not\(:disabled, \[aria-disabled='true'\]\)/);
  assert.match(actions, /:active:not\(:disabled, \[aria-disabled='true'\]\)/);
  assert.doesNotMatch(actions.replace(/\/\*[\s\S]*?\*\//g, ''), /pointer-events\s*:\s*none/);
  assert.match(actions, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(actions, /@media \(forced-colors: active\)/);
  assert.match(actions, /outline-color:\s*Highlight/);
});

test('shared action foreground/fill pairs meet normal-text contrast in both themes', () => {
  for (const pair of [
    ['#ffffff', '#0b5f6c'],
    ['#ffffff', '#084c57'],
    ['#071317', '#ffffff'],
    ['#071317', '#edf2f3'],
    ['#edf6f7', '#14242b'],
    ['#edf6f7', '#1c3139'],
    ['#ffffff', '#9b3429'],
    ['#071317', '#ff9b8f'],
  ]) {
    assert.ok(contrast(...pair) >= 4.5, `${pair.join(' on ')} must remain readable`);
  }
});

test('legacy text rules exclude explicit action roles without raising selector specificity', () => {
  assert.match(polish, /:where\(a:not\(\.bbs-action, \.bbs-action \*\)\)/);
  assert.match(polish, /:not\(:where\(\.bbs-action, \.bbs-action \*\)\)/);
  assert.match(polish, /\.settings-form \.auth-submit\s*\{[^}]*var\(--action-primary\)/);
});

test('shared desktop presses no longer move targets and comment positioning remains intact', () => {
  const desktop = read('public/desktop-elegant.css');
  assert.doesNotMatch(desktop, /:where\(a, button, summary\):active\s*\{/);
  const styles = read('public/styles.css');
  assert.doesNotMatch(styles, /\.system-settings-(?:submit|clear|menu-item):active/);
  assert.match(
    read('public/post-reader.css'),
    /\.discussion-comment-thread-toggle:active\s*\{\s*transform:\s*translate\(-50%, -50%\);/,
  );
});

test('development reuses the exact shared action implementation with semantic mappings', () => {
  assert.match(
    read('development/apps/web/src/styles/components.css'),
    /@import '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/public\/actions\.css';/,
  );
  const developmentTokens = read('development/apps/web/src/styles/tokens.css');
  for (const name of ['secondary', 'quiet-hover', 'danger', 'focus', 'disabled-opacity']) {
    assert.ok(developmentTokens.includes(`--action-${name}:`));
  }
});

test('workbench destructive hover/active fills always use their paired semantic foreground', () => {
  const workbench = read('public/workbench.css');
  assert.match(
    workbench,
    /\.workbench-item-action\.is-danger:is\(:hover, :active\):where\([\s\S]*?\)\s*\{[^}]*color:\s*var\(--action-danger-text\);[^}]*background:\s*var\(--action-danger\);/,
  );
  assert.doesNotMatch(workbench, /\.workbench-item-action\.is-danger:hover[^}]*color:\s*#ffaaa5;/);
});
