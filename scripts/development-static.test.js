const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('main site redirects legacy entries directly to the peer SPA', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'public', 'development.html'), 'utf8');
  assert.match(
    server,
    /\['\/development', '\/development\.html'\]\.includes\(requestUrl\.pathname\)/,
  );
  assert.doesNotMatch(server, /\['\/development', '\/development\.html'\],/);
  assert.match(server, /requestUrl\.pathname\.startsWith\('\/development\/'\)/);
  assert.match(server, /development[\s\S]*apps[\s\S]*web[\s\S]*dist/);
  assert.match(page, /development-entry\.js/);
});

test('authentication accepts only same-origin development return paths', () => {
  const auth = fs.readFileSync(path.join(root, 'public', 'auth.js'), 'utf8');
  assert.match(auth, /next\.pathname\.startsWith\('\/development\/'\)/);
  assert.match(auth, /next\.origin === window\.location\.origin && allowed/);
});

test('shared profile and settings pages support the development embed shell', () => {
  for (const page of ['profile.html', 'settings.html']) {
    const html = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    assert.match(html, /development-commerce-embed\.js/);
    assert.match(html, /development-commerce-embed\.css/);
  }
});

test('shared desktop chrome stays disabled inside the development shell', () => {
  const shell = fs.readFileSync(path.join(root, 'public', 'desktop-shell.js'), 'utf8');
  const embed = fs.readFileSync(
    path.join(root, 'public', 'development-commerce-embed.css'),
    'utf8',
  );
  assert.match(shell, /documentElement\.classList\.contains\('development-embedded'\)/);
  assert.match(embed, /development-embedded \.notification-widget/);
});

test('the production Node routes redirect old development entries without an auth probe', async (t) => {
  const requireServer = createRequire(path.join(root, 'server.js'));
  let server;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), {
    __dirname: root,
    process: { env: { HOST: '127.0.0.1', PORT: '0' } },
    URL,
    require: (name) =>
      name === 'http'
        ? {
            ...http,
            createServer: (handler) => {
              server = http.createServer(handler);
              return { listen() {} };
            },
          }
        : requireServer(name),
  });
  assert.ok(server);
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const entry of ['/development', '/development.html']) {
    const response = await fetch(`${origin}${entry}?from=learning&section=organizations`, {
      redirect: 'manual',
    });
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get('location'),
      '/development/?from=learning&section=organizations',
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), '');
  }
});

test('both nginx deployment forms redirect legacy entries while preserving query parameters', () => {
  for (const filename of ['freebbs-development.conf', 'freebbs-development.locations.conf']) {
    const config = fs.readFileSync(
      path.join(root, 'development', 'deploy', 'nginx', filename),
      'utf8',
    );
    for (const entry of ['/development', '/development.html']) {
      const start = config.indexOf(`location = ${entry} {`);
      assert.ok(start >= 0, `${filename}: ${entry}`);
      assert.match(
        config.slice(start, config.indexOf('}', start)),
        /return 302 \/development\/\$is_args\$args;/,
      );
    }
  }
});
