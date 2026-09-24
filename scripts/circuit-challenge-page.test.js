const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../public/circuit-challenge.html'), 'utf8');
const circuitHtml = fs.readFileSync(path.join(__dirname, '../public/circuit.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/circuit-challenge.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

test('circuit challenge page exposes player, leaderboard, and administrator surfaces', () => {
  for (const id of [
    'challenge-level-list',
    'challenge-empty',
    'challenge-waveform',
    'challenge-stage',
    'challenge-palette',
    'challenge-submit',
    'challenge-leaderboard',
    'challenge-admin-form',
    'challenge-admin-reward',
    'challenge-admin-save',
    'challenge-celebration',
    'challenge-fireworks',
    'challenge-beautify',
    'challenge-undo',
    'challenge-redo',
    'challenge-shortcuts',
    'challenge-shortcuts-dialog',
    'challenge-undo-wire',
    'challenge-start-wire',
    'challenge-reset-wire',
  ])
    assert.match(html, new RegExp(`id="${id}"`));
  assert.match(script, /\/circuit-challenges\/\$\{state\.challenge\.id\}\/submissions/);
  assert.match(script, /new Worker\('\/circuit-worker\.js'\)/);
  assert.match(script, /rewardElectric: Number\(\$\('admin-reward'\)\.value\)/);
  assert.match(script, /刷新最低纪录/);
  assert.match(script, /syncWallet\(payload\.balance/);
  assert.match(script, /terminalPorts:\s*\{/);
  assert.match(script, /positiveLabel: 'IN \+'/);
  assert.match(script, /negativeLabel: 'IN − · GND'/);
  assert.match(script, /OUT: \{ side: 'right', label: 'OUT' \}/);
  assert.match(script, /wirePoints: state\.wirePoints/);
  assert.match(script, /onCanvasPoint: addConnectionPoint/);
  assert.match(script, /shortcuts\.bind\(\{/);
  assert.match(script, /layout\.normalizeCircuitLayout/);
  assert.match(script, /lockedComponentIds: \[\.\.\.fixedIds\]/);
  assert.match(script, /'ground'/);
  assert.match(script, /if \(passed && !state\.celebrated\)/);
  assert.match(script, /launchFireworks\(\)/);
  const saveAdmin = script.slice(
    script.indexOf('async function saveAdmin()'),
    script.indexOf('function reset()'),
  );
  assert.ok(
    saveAdmin.indexOf('state.busy = false') < saveAdmin.indexOf('await loadChallenges'),
    'admin save must leave the busy state before reloading the saved challenge',
  );
  for (const module of ['circuit-layout.js', 'circuit-history.js', 'circuit-shortcuts.js'])
    assert.match(html, new RegExp(`src="/${module.replace('.', '\\.')}`));
  assert.match(server, /\['\/circuit-challenge', '\/circuit-challenge\.html'\]/);
});

test('circuit challenge page uses the complete responsive site navigation', () => {
  assert.match(html, /class="searchbar"/);
  assert.match(html, /href="\/aichat"/);
  assert.match(html, /class="mobile-nav"/);
  assert.match(html, /id="user-settings-button"/);
  assert.match(html, /id="user-logout-button"/);
});

test('circuit library exposes a prominent challenge entry beside new circuit', () => {
  const listPage =
    circuitHtml.match(/<section id="circuit-list-page"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(listPage, /href="\/circuit-challenge"/);
  assert.match(listPage, />进入闯关模式</);
  assert.match(listPage, /href="\/circuit\?new=1"/);
});
