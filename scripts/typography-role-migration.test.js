const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const publicRoot = path.join(__dirname, '../public');
const read = (file) => fs.readFileSync(path.join(publicRoot, file), 'utf8');
const normalizeSelector = (selector) => selector.trim().replace(/\s+/g, ' ');

function declaration(file, selector, property) {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    ([, candidate]) => normalizeSelector(candidate) === normalizeSelector(selector),
  );
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`);
  const values = rules.map(([, , body]) => body.match(pattern)?.[1].trim()).filter(Boolean);
  assert.ok(values.length, `${file}: missing ${property} for ${selector}`);
  return values.at(-1);
}

test('ordinary course, learning and discussion headings follow the shared title role', () => {
  for (const selector of [
    '.course-material-header h1',
    '.course-map-node strong',
    '.course-map-studio-identity h1',
    '.course-hero h1, .knowledge-header h1',
  ])
    assert.equal(declaration('course.css', selector, 'font-family'), 'var(--font-zh-title)');
  assert.equal(
    declaration(
      'ui-polish.css',
      'body:not(.world-page) .course-hero h1, body:not(.world-page) .knowledge-header h1',
      'font-family',
    ),
    'var(--font-zh-title) !important',
  );
  assert.equal(
    declaration(
      'discussion.css',
      'body.discussion-page .discussion-page-heading h1, body.discussion-page .discussion-board-about h2, body.discussion-page .discussion-stats-section h2, body.discussion-page .discussion-post-card h3, body.discussion-page .discussion-post-title, body.discussion-page .discussion-detail-head h2, body.discussion-page .discussion-comments-head h3, body.discussion-page .discussion-empty strong',
      'font-family',
    ),
    'var(--font-zh-title) !important',
  );
});

test('ordinary prose, navigation, page titles and Latin labels consume explicit semantic roles', () => {
  for (const [selector, role] of [
    ['body:not(.auth-page-body)', '--font-body'],
    ['body:not(.auth-page-body) .nav-link', '--font-ui'],
    ['body:not(.auth-page-body) .user-name', '--font-ui'],
    ['body:not(.auth-page-body) .main-content::before', '--font-display'],
    ['body:not(.auth-page-body) .workbench-intro h1', '--font-display'],
  ])
    assert.equal(declaration('styles.css', selector, 'font-family'), `var(${role})`);
  assert.equal(
    declaration('discussion.css', 'body.discussion-page .discussion-page-eyebrow', 'font-family'),
    'var(--font-latin)',
  );
  assert.equal(
    declaration('course.css', '.knowledge-chat-message-body', 'font-family'),
    'var(--font-zh-body)',
  );
  assert.equal(
    declaration('course.css', '.knowledge-chat-message-body', 'font-weight'),
    'var(--font-zh-body-weight, 400)',
  );
  assert.match(read('styles.css'), /--font-copy:\s*var\(--font-zh-body\);/);
});

test('shared size and weight tokens retain the exact previous defaults', () => {
  const defaults = {
    '--type-body-size': '1rem',
    '--type-body-small-size': '0.9rem',
    '--type-ui-small-size': '0.86rem',
    '--type-meta-size': '0.76rem',
    '--type-section-title-size': '1.35rem',
    '--type-fixed-badge-size': '10px',
    '--type-fixed-micro-size': '11px',
    '--type-fixed-meta-size': '12px',
    '--type-fixed-caption-size': '13px',
    '--type-fixed-control-size': '14px',
    '--type-fixed-ui-size': '16px',
    '--type-fixed-subheading-size': '17px',
    '--type-fixed-section-title-size': '18px',
    '--type-fixed-heading-size': '20px',
    '--type-weight-regular': '400',
    '--type-weight-medium': '500',
    '--type-weight-semibold': '600',
    '--type-weight-bold': '700',
    '--type-weight-heavy': '800',
    '--type-weight-black': '900',
  };
  for (const [name, value] of Object.entries(defaults))
    assert.equal(declaration('styles.css', ':root', name), value);
});

test('notification, search, learning entry and desktop profile copy reuse shared size tokens', () => {
  for (const [file, selector, token] of [
    ['notifications.css', '.notification-panel-header h2', '--type-fixed-section-title-size'],
    ['notifications.css', '.notification-item-body', '--type-fixed-caption-size'],
    [
      'notifications.css',
      '.notification-item time, .notification-item-action',
      '--type-fixed-meta-size',
    ],
    ['site-search.css', '.site-search-results strong', '--type-fixed-ui-size'],
    ['site-search.css', '.site-search-results p', '--type-fixed-caption-size'],
    ['learning-start.css', '.learning-start h3', '--type-fixed-subheading-size'],
    [
      'learning-start.css',
      '.learning-start select, .learning-start button',
      '--type-fixed-control-size',
    ],
    [
      'desktop-elegant.css',
      'body.personal-settings-page .personal-profile-link',
      '--type-ui-small-size',
    ],
    [
      'desktop-elegant.css',
      'body.personal-settings-page .personal-balances span',
      '--type-meta-size',
    ],
    [
      'desktop-elegant.css',
      'body.personal-settings-page .personal-balances strong',
      '--type-section-title-size',
    ],
  ])
    assert.equal(declaration(file, selector, 'font-size'), `var(${token})`);
  assert.match(
    declaration('notifications.css', '.notification-badge', 'font'),
    /^var\(--type-weight-bold\) var\(--type-fixed-badge-size\)\s*\/\s*1 var\(--font-ui, sans-serif\)$/,
  );
  assert.equal(
    declaration('max-models.css', '.max-image-viewer-toolbar', 'font'),
    'var(--type-fixed-control-size) var(--font-ui, sans-serif)',
  );
});

test('ordinary course and shell text no longer override preferences with installed font stacks', () => {
  for (const file of ['styles.css', 'course.css', 'discussion.css', 'ui-polish.css'])
    assert.doesNotMatch(read(file), /font-family:\s*['"](?:Hiragino Sans GB|PingFang SC|Syne)['"]/);
});

test('map geometry, formula/code fonts, graphic glyphs and iOS focus sizing remain explicit exceptions', () => {
  assert.match(
    declaration('course.css', '.course-map-node-id', 'font-family'),
    /SFMono-Regular.*Consolas.*monospace/,
  );
  assert.equal(
    declaration('course.css', '.course-map-immersive :where(.katex, .katex *)', 'font-family'),
    'var(--course-map-font-math) !important',
  );
  assert.equal(
    declaration('knowledge-workspace.css', '.chapter-network text', 'font'),
    '16px var(--font-ui)',
  );
  assert.equal(declaration('site-search.css', '.site-search-form input', 'font-size'), '16px');
  assert.equal(
    declaration(
      'post-reader.css',
      'body.discussion-page.post-reading .post-comment-sheet textarea',
      'font-size',
    ),
    '16px !important',
  );
  assert.equal(declaration('notifications.css', '.notification-close', 'font-size'), '24px');
  assert.equal(
    declaration('notifications.css', '.notification-item.is-unread strong::before', 'font-size'),
    '8px',
  );
  assert.equal(
    declaration('publish.css', '.publish-back', 'font'),
    '300 36px/1 sans-serif !important',
  );
  assert.match(read('circuit-embed.css'), /font-family:\s*system-ui,/);
});

test(
  'real Chrome follows font roles and retains compact UI dimensions for every preset/scale',
  { skip: !process.env.PUPPETEER_MODULE },
  async () => {
    // eslint-disable-next-line import/no-dynamic-require
    const puppeteer = require(process.env.PUPPETEER_MODULE);
    const styles = [
      'styles.css',
      'course.css',
      'discussion.css',
      'desktop-elegant.css',
      'notifications.css',
      'max-models.css',
      'site-search.css',
      'learning-start.css',
      'ui-polish.css',
    ];
    const allowed = new Set([
      ...styles,
      'actions.css',
      'theme-tokens.css',
      'ui-state.css',
      'typography-preferences.js',
      'typography.js',
    ]);
    const html = `<!doctype html><html><head><meta charset="utf-8">
      ${styles.map((file) => `<link rel="stylesheet" href="/${file}">`).join('')}
      <script src="/typography-preferences.js"></script></head><body>
      <script src="/typography.js"></script>
      <main class="main-content"><header class="course-hero"><h1>课程标题</h1></header>
      <header class="knowledge-header"><h1>知识标题</h1></header>
      <div class="knowledge-chat-message-body">Max 阅读解释</div>
      <div class="discussion-page-heading"><h1>讨论标题</h1></div>
      <p class="discussion-page-eyebrow">DISCUSSION</p>
      <div class="notification-widget"><span class="notification-badge">12</span></div>
      <div class="notification-item-body">通知正文</div>
      <div class="max-image-viewer-toolbar">图片工具</div>
      <div class="learning-start"><h3>学习起点</h3><button>开始</button></div>
      <div class="personal-balances"><strong>23</strong><span>磁元</span></div></main>
      </body></html>`;
    const server = http.createServer((request, response) => {
      const file = request.url.slice(1);
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(html);
      } else if (allowed.has(file)) {
        response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
        response.end(read(file));
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    const errors = [];
    try {
      browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().startsWith(origin) || request.url().startsWith('data:'))
          request.continue();
        else request.abort();
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin, { waitUntil: 'networkidle0' });
      const choices = await page.evaluate(() => ({
        fonts: Object.keys(window.freeBbsTypography.presets),
        scales: Object.keys(window.freeBbsTypography.typeScalePresets),
      }));
      for (const fontPreset of choices.fonts) {
        for (const typeScale of choices.scales) {
          const result = await page.evaluate(
            (choice) => {
              document.body.className = 'discussion-page personal-settings-page';
              window.freeBbsTypography.applyPreferences(choice);
              const { fonts } = window.freeBbsTypography.presets[choice.fontPreset];
              const normalize = (family) => {
                const sample = document.createElement('span');
                sample.style.fontFamily = family;
                return sample.style.fontFamily;
              };
              const style = (selector) => getComputedStyle(document.querySelector(selector));
              return {
                course: style('.course-hero h1').fontFamily,
                knowledge: style('.knowledge-header h1').fontFamily,
                discussion: style('.discussion-page-heading h1').fontFamily,
                prose: style('.knowledge-chat-message-body').fontFamily,
                latin: style('.discussion-page-eyebrow').fontFamily,
                badge: style('.notification-badge').fontFamily,
                toolbar: style('.max-image-viewer-toolbar').fontFamily,
                badgeSize: style('.notification-badge').fontSize,
                badgeWeight: style('.notification-badge').fontWeight,
                noteSize: style('.notification-item-body').fontSize,
                toolbarSize: style('.max-image-viewer-toolbar').fontSize,
                entrySize: style('.learning-start h3').fontSize,
                title: normalize(fonts.zhTitle),
                body: normalize(fonts.zhBody),
                ui: normalize(fonts.zhUi),
                expectedLatin: normalize(fonts.latin),
              };
            },
            { fontPreset, typeScale },
          );
          for (const role of ['course', 'knowledge', 'discussion'])
            assert.equal(result[role], result.title);
          assert.equal(result.prose, result.body);
          assert.equal(result.latin, result.expectedLatin);
          for (const role of ['badge', 'toolbar']) assert.equal(result[role], result.ui);
          assert.equal(result.badgeSize, '10px');
          assert.equal(result.badgeWeight, '700');
          assert.equal(result.noteSize, '13px');
          assert.equal(result.toolbarSize, '14px');
          assert.equal(result.entrySize, '17px');
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
  },
);
