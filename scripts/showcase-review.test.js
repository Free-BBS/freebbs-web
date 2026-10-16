const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, existsSync, statSync } = require('node:fs');
const { join, resolve, dirname, relative } = require('node:path');
const { Script } = require('node:vm');

const root = process.env.SHOWCASE_REVIEW_DIR
  ? resolve(process.env.SHOWCASE_REVIEW_DIR)
  : resolve(__dirname, '../development/apps/web/dist-review');
const text = (path) => readFileSync(path, 'utf8');
const manifest = JSON.parse(text(join(root, '审核目录.json')));
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
test('offline package provides twenty portable department entries in the requested order', () => {
  assert.equal(manifest.length, 20);
  assert.equal(manifest.filter((item) => item.submitted).length, 20);
  assert.deepEqual(
    [...new Set(manifest.map((item) => item.group))],
    ['TMS', '团委', '学生会', '科协', '媒体中心'],
  );
  assert.equal(manifest.filter((item) => item.group === '科协').length, 5);
  assert.deepEqual(
    manifest.filter((item) => item.group === '团委').map((item) => item.name),
    ['组织组', '办公室·新生组', '志愿组', '实践组', '调研组', '人文组', '扬帆计划组'],
  );
  assert.ok(manifest.some((item) => item.name === '学习培养部'));
  assert.ok(manifest.some((item) => item.name === '办公室·新生组'));
  for (const item of manifest) {
    const html = text(join(root, item.file));
    assert.ok(html.includes(`data-route="${item.route}"`));
    assert.match(html, /src="\.\/review\.js"/);
    assert.doesNotMatch(html, /type="module"|crossorigin|https?:|localhost|127\.0\.0\.1/);
  }
});
test('standalone script runs without module loading, Node globals, authentication or root asset paths', () => {
  const source = text(join(root, 'review.js'));
  assert.doesNotThrow(() => new Script(source));
  assert.doesNotMatch(
    source,
    /process\.env|\/api\/auth|VITE_AUTH_MODE|\/development\/organization-showcase\/|127\.0\.0\.1|localhost/,
  );
  assert.match(source, /\.\/organization-showcase\//);
});
test('all local HTML and CSS asset references resolve inside the portable package', () => {
  const failures = [];
  for (const file of walk(root).filter((candidate) => /\.(?:html?|css)$/.test(candidate))) {
    const rawSource = text(file);
    const scripts = [...rawSource.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(
      (match) => match[1],
    );
    const source = rawSource
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    const references = [...source.matchAll(/\b(?:src|href|poster)=["']([^"']+)["']/gi)].map(
      (match) => match[1],
    );
    references.push(...scripts);
    references.push(
      ...[...source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((match) => match[1]),
    );
    for (const raw of references) {
      if (/^(?:#|data:|https?:|mailto:|tel:|blob:|\/\/)/i.test(raw)) continue;
      const asset = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
      if (!asset || asset.startsWith('#')) continue;
      const target = resolve(dirname(file), asset);
      if (asset.startsWith('/') || relative(root, target).startsWith('..') || !existsSync(target))
        failures.push(`${relative(root, file)} → ${raw}`);
    }
  }
  assert.deepEqual(failures, []);
});
test('existing hardware video is included intact, with all submitted pages and a shared theme bridge', () => {
  const sites = join(root, 'organization-showcase/sites');
  assert.equal(statSync(join(sites, 'hardware/assets/video/hardware-design.mp4')).size, 75480143);
  for (const slug of [
    'organization',
    'research',
    'creative',
    'audiovisual',
    'sail',
    'humanities',
    'hardware',
    'software',
    'liaison',
  ]) {
    assert.ok(existsSync(join(sites, slug, 'index.html')));
    assert.ok(text(join(sites, slug, 'index.html')).includes('../platform-bridge.js'));
  }
  assert.ok(text(join(sites, 'platform-bridge.js')).includes('platform-theme.css'));
  assert.ok(existsSync(join(sites, 'platform-theme.css')));
});
