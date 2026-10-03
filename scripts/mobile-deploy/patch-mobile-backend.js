#!/usr/bin/env node
const fs = require('node:fs');

function insertOnce(source, anchor, addition) {
  if (source.includes(addition.trim())) return source;
  if (source.split(anchor).length !== 2) throw new Error('Expected a unique deployment anchor');
  return source.replace(anchor, anchor + '\n' + addition);
}

function patchMobileBackend(source) {
  let result = insertOnce(
    source,
    "const { createCircuitsRouter, ensureCircuitTables } = require('./circuits');",
    "const { createMobileSafetyRouter, ensureMobileSafetyTables } = require('./mobile-safety');",
  );
  result = insertOnce(
    result,
    "app.use('/api/circuits', createCircuitsRouter({ pool, requireAuth }));",
    "app.use('/api', createMobileSafetyRouter({ pool, requireAuth, requireAdmin }));",
  );
  const start = 'async function start() {';
  if (result.split(start).length !== 2) throw new Error('Expected a unique startup function');
  const offset = result.indexOf(start);
  result = result.slice(0, offset) + insertOnce(
    result.slice(offset),
    '  await ensureNotificationTables(pool);',
    '  await ensureMobileSafetyTables(pool);',
  );
  return result;
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: patch-mobile-backend.js INPUT OUTPUT');
  fs.writeFileSync(output, patchMobileBackend(fs.readFileSync(input, 'utf8')));
}
module.exports = { patchMobileBackend };
