import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const syncScript = join(dirname(fileURLToPath(import.meta.url)), 'sync-site-footer.mjs');

function fixture(t, { source, destination } = {}) {
  assert.ok(existsSync(syncScript), 'The footer synchronization script must exist');
  const root = mkdtempSync(join(tmpdir(), 'freebbs-footer-'));
  t.onTestFinished(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('freebbs-footer-'));
    rmSync(root, { recursive: true, force: true });
  });
  const script = join(root, 'development/apps/web/scripts/sync-site-footer.mjs');
  const target = join(root, 'development/apps/web/src/styles/shared-site-footer.css');
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(syncScript, script);
  for (const [path, content] of [
    [join(root, 'public/site-footer.css'), source],
    [target, destination],
  ]) {
    if (content !== undefined) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  }
  return {
    target,
    run: () => spawnSync(process.execPath, [script], { cwd: tmpdir(), encoding: 'utf8' }),
  };
}

test('copies the canonical CSS exactly and resolves paths independently of the working directory', (t) => {
  const css = Buffer.from('/* 学习页脚 */\r\n.site-footer { color: red; }\r\n');
  const { target, run } = fixture(t, { source: css, destination: 'stale css' });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(target), css);
});

test('creates the bundled CSS when the canonical source exists', (t) => {
  const { target, run } = fixture(t, { source: '.site-footer { padding: 0; }\n' });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(target, 'utf8'), '.site-footer { padding: 0; }\n');
});

test('keeps identical CSS without rewriting it', (t) => {
  const css = '.site-footer { padding: 0; }\n';
  const { target, run } = fixture(t, { source: css, destination: css });
  const before = statSync(target).mtimeMs;
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(statSync(target).mtimeMs, before);
});

test('retains the bundled CSS in an isolated development-only build', (t) => {
  const css = '.site-footer { padding: 0; }\n';
  const { target, run } = fixture(t, { destination: css });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(target, 'utf8'), css);
});

test('fails clearly when both canonical and bundled CSS are missing', (t) => {
  const { target, run } = fixture(t);
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Footer CSS is missing/);
  assert.match(result.stderr, /shared-site-footer\.css/);
  assert.equal(existsSync(target), false);
});
