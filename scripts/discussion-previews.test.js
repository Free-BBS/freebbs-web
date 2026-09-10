const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizePreview, markup, diagramBounds } = require('../public/discussion-previews');

const cid = 'c_0123456789abcdef01234567';

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
