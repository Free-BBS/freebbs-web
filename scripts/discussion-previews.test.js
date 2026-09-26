const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizePreview, markup, diagramBounds } = require('../public/discussion-previews');

const cid = 'c_0123456789abcdef01234567';
const tid = 't_0123456789abcdef';

test('tool thumbnails reference a saved tool and open the post rather than execute it', () => {
  assert.deepEqual(normalizePreview({ type: 'tool', tid }), { type: 'tool', tid });
  assert.equal(normalizePreview({ type: 'tool', tid: '../private' }), null);
  const html = markup({ type: 'tool', tid }, 'post-1');
  assert.match(html, /discussion-post-preview-tool/);
  assert.match(html, /data-action="open-post"/);
  assert.match(html, /aria-label="查看帖子中的小工具"/);
  assert.match(html, /^<a /);
  assert.match(html, /href="\/discussion\?post=post-1"/);
  assert.doesNotMatch(html, /<iframe|<script/);
});

test('feed nameplates wrap as whole badges instead of squeezing their labels into the narrow author slot', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/discussion.css'), 'utf8');
  assert.match(
    css,
    /\.discussion-post-source\s*>\s*\.discussion-author-link:not\([^}]+max-width: 100%;/,
  );
  assert.match(
    css,
    /\.discussion-post-source \.cosmetic-nameplate \.nameplate-label\s*\{[^}]+white-space: nowrap;/,
  );
});

function toolPreviewEnvironment(fetch) {
  let removed = false;
  const frames = [];
  const host = {
    dataset: { tid },
    clientWidth: 112,
    clientHeight: 84,
    classList: { contains: (name) => name === 'discussion-post-preview-tool' },
    querySelector: () => frames[0],
    append: (frame) => frames.push(frame),
    closest: () => ({
      closest: () => ({ classList: { remove() {} } }),
      remove() {
        removed = true;
      },
    }),
  };
  const root = {
    querySelectorAll: (selector) => (selector.endsWith(' img') ? [] : [host]),
    contains: () => !removed,
  };
  const window = { FreeBbsToolEmbeds: require('../public/tool-embeds') };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/discussion-previews.js'), 'utf8'),
    {
      window,
      fetch,
      AbortSignal,
      document: {
        createElement: () => ({
          style: {},
          attributes: {},
          setAttribute(key, value) {
            this.attributes[key] = value;
          },
        }),
      },
    },
  );
  return { root, window, frames, removed: () => removed };
}

test('feed tool renderer runs canvas scripts in an opaque credential-free sandbox with fixed scaling', async () => {
  const env = toolPreviewEnvironment(async (url, options) => {
    assert.equal(url, `/api/tools/${tid}`);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    return {
      ok: true,
      json: async () => ({
        tool: {
          id: tid,
          isPublished: true,
          html: '<html><body>计数器<script>bad()</script></body></html>',
        },
      }),
    };
  });
  env.window.FreeBbsDiscussionPreviews.enhance(env.root);
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(env.frames.length, 1);
  assert.equal(env.frames[0].attributes.sandbox, 'allow-scripts');
  assert.equal(env.frames[0].attributes.inert, undefined);
  assert.equal(env.frames[0].attributes.tabindex, '-1');
  assert.match(env.frames[0].srcdoc, /script-src 'unsafe-inline'/);
  assert.match(env.frames[0].srcdoc, /connect-src 'none'/);
  assert.equal(env.frames[0].style.width, '640px');
  assert.equal(env.frames[0].style.transform, 'scale(0.175)');
  env.window.FreeBbsDiscussionPreviews.enhance(env.root);
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(env.frames.length, 1);
});

test('private, missing and mismatched tools drop the thumbnail without reserving empty space', async () => {
  for (const payload of [
    null,
    { id: tid, isPublished: false, html: '<html></html>' },
    { id: 'wrong', isPublished: true, html: '<html></html>' },
  ]) {
    const env = toolPreviewEnvironment(async () => ({
      ok: Boolean(payload),
      json: async () => ({ tool: payload }),
    }));
    env.window.FreeBbsDiscussionPreviews.enhance(env.root);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    assert.equal(env.removed(), true);
    assert.equal(env.frames.length, 0);
  }
});

test('posts without media reserve no thumbnail, and unsafe URLs are rejected', () => {
  assert.equal(markup(null, 'p1'), '');
  for (const url of [
    // eslint-disable-next-line no-script-url -- verify rejection of an unsafe thumbnail URL
    'javascript:alert(1)',
    'data:image/svg+xml,test',
    '//other.test/image',
    '/\\other.test/image',
    '/bad\nimage',
  ]) {
    assert.equal(normalizePreview({ type: 'image', url }), null);
  }
  assert.equal(normalizePreview({ type: 'circuit', cid, revision: 0 }), null);
  assert.equal(normalizePreview({ type: 'circuit', cid: '../bad', revision: 1 }), null);
});

test('image thumbnails escape metadata and resolve upload URLs to the API host', () => {
  const html = markup({ type: 'image', url: '/uploads/photo.webp', alt: '"><script>' }, 'post"id', {
    resolveAssetUrl: (url) => `http://127.0.0.1:3001${url}`,
  });
  assert.match(html, /src="http:\/\/127\.0\.0\.1:3001\/uploads\/photo.webp"/);
  assert.match(html, /alt="&quot;&gt;&lt;script&gt;"/);
  assert.match(html, /data-post-id="post&quot;id"/);
  assert.match(html, /loading="lazy"/);
});

test('circuit previews keep the saved revision and render a static drawing without an iframe', () => {
  const html = markup({ type: 'circuit', cid, revision: 7, view: 'live' }, 'p1');
  assert.match(html, /data-revision="7"/);
  assert.match(html, /data-action="open-post"/);
  assert.doesNotMatch(html, /iframe|circuit-embed/);
  const [x, y, width, height] = diagramBounds({
    components: [
      { x: 100, y: 100 },
      { x: 350, y: 200 },
    ],
    wires: [{ points: [{ x: 700, y: 450 }] }],
  });
  assert.ok(x <= 0 && y <= 0 && x + width >= 800 && y + height >= 550);
});
