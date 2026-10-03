const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { patchMobileBackend } = require('./patch-mobile-backend');

const source = fs.readFileSync(path.join(__dirname, '../../backend/server.js'), 'utf8');
const oldRange = `第 \${start}–\${end}/\${document.pageCount} 页`;
const newRange = `第 \${pageStart}–\${end}/\${document.pageCount} 页`;

test('document patch preserves all production code except the known typo and is idempotent', () => {
  const original = source.replace(newRange, oldRange);
  const patched = patchMobileBackend(original);
  assert.equal(patched, source);
  assert.equal(patchMobileBackend(patched), source);
});

test('ambiguous document patches stop before deployment', () => {
  assert.throws(
    () => patchMobileBackend(`${source}\n${oldRange}${oldRange}`),
    /unique document range/,
  );
});

test('missing production startup anchors stop before deployment', () => {
  assert.throws(
    () =>
      patchMobileBackend(source.replace('async function start() {', 'async function other() {')),
    /startup function/,
  );
});
