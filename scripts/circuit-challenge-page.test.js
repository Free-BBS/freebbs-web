const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../public/circuit-challenge.html'), 'utf8');
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
    'challenge-admin-save',
  ])
    assert.match(html, new RegExp(`id="${id}"`));
  assert.match(script, /\/circuit-challenges\/\$\{state\.challenge\.id\}\/submissions/);
  assert.match(script, /new Worker\('\/circuit-worker\.js'\)/);
  assert.match(script, /terminalPorts:\s*\{/);
  assert.match(script, /positiveLabel: 'IN \+'/);
  assert.match(script, /negativeLabel: 'IN − · GND'/);
  assert.match(script, /OUT: \{ side: 'right', label: 'OUT' \}/);
  assert.match(server, /\['\/circuit-challenge', '\/circuit-challenge\.html'\]/);
});

test('circuit challenge page uses the complete responsive site navigation', () => {
  assert.match(html, /class="searchbar"/);
  assert.match(html, /href="\/aichat"/);
  assert.match(html, /class="mobile-nav"/);
  assert.match(html, /id="user-settings-button"/);
  assert.match(html, /id="user-logout-button"/);
});
