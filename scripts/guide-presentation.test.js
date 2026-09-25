const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
test('header button and span balances share font family, size, weight and number metrics', () => {
  const css = read('ui-polish.css');
  assert.match(css, /\.user-economy-stack \.currency-value\s*\{[^}]*font-weight:\s*700;/);
  assert.match(css, /\.user-economy-stack \.currency-value\s*\{[^}]*font-family:\s*var\(--font-ui/);
  assert.match(
    css,
    /\.user-economy-stack \.currency-value\s*\{[^}]*font-size:\s*var\(--header-currency-font-size\)/,
  );
  assert.match(
    css,
    /\.user-economy-stack \.currency-value\s*\{[^}]*font-variant-numeric:\s*tabular-nums/,
  );
  assert.match(css, /\.user-economy-stack \.currency-value\s*\{[^}]*line-height:\s*1;/);
  assert.match(css, /--header-currency-font-size:\s*0\.9rem/);
  assert.match(css, /--header-currency-font-size:\s*0\.84rem/);
  const source = read('app.js');
  const renderer = source.slice(
    source.indexOf('function renderCurrency('),
    source.indexOf('function formatDateTime('),
  );
  assert.match(renderer, /electric:/);
  assert.match(renderer, /magnetic:/);
  assert.match(renderer, /heat:/);
  assert.match(renderer, /class="currency-value"/);
});
test('guide prose, hints and controls follow the chosen typography roles on every page', () => {
  const css = read('max-guide.css');
  assert.match(css, /\.guide-page \.guide-main\s*\{[^}]*font-family:\s*var\(--font-body/);
  assert.match(css, /\.max-tour\s*\{[^}]*font-family:\s*var\(--font-body/);
  assert.match(
    css,
    /\.max-tour :is\(\.max-tour-body, \.max-tour-caption, \.max-tour-status\)\s*\{[^}]*font-family:\s*var\(--font-body/,
  );
  assert.match(
    css,
    /\.max-tour :is\(button, select, option, \.max-tour-kicker\)\s*\{[^}]*font-family:\s*var\(--font-ui/,
  );
  assert.match(
    css,
    /\.max-tour #max-tour-title\s*\{[^}]*font-family:\s*var\(--font-display[^;]*!important/,
  );
});
