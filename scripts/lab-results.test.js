const test = require('node:test');
const assert = require('node:assert/strict');
const results = require('../public/lab-results');
const previews = require('../public/discussion-previews');
const { getDiscussionPreview } = require('../backend/discussion-preview');

const origin = 'https://free-bbs.example';
const id = `e_${  'a'.repeat(32)}`;
test('only local immutable experiment references generate previews', () => {
  assert.deepEqual(results.parseReference(`/code-lab?experiment=${id}`, origin), { id });
  for (const url of [
    `https://other.example/code-lab?experiment=${id}`,
    `/code-lab?experiment=${id}&experiment=${id}`,
    '/code-lab?experiment=bad',
    `https://u:p@free-bbs.example/code-lab?experiment=${id}`,
  ])
    assert.equal(results.parseReference(url, origin), null);
  assert.deepEqual(getDiscussionPreview(`[实验](/code-lab?experiment=${id})`, origin), {
    type: 'lab',
    id,
  });
  assert.equal(
    getDiscussionPreview(`\`\`\`\n[实验](/code-lab?experiment=${  id  })\n\`\`\``, origin),
    null,
  );
  assert.match(previews.markup({ type: 'lab', id }, 'post1'), /discussion-post-preview-lab/);
  assert.equal(previews.markup({ type: 'lab', id: '<script>' }, 'post1'), '');
});
test('renders bus and unknown transitions with escaped labels and bounded finite coordinates', () => {
  const html = results.digital({
    timescale: '1ns',
    end: 20,
    signals: [
      {
        name: '<img onerror=alert(1)>',
        width: 1,
        values: [
          [0, '0'],
          [10, '1'],
          [15, 'x'],
          [Infinity, '1'],
        ],
      },
      {
        name: 'bus',
        width: 4,
        values: [
          [0, '0000'],
          [5, '1010'],
        ],
      },
    ],
  });
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|Infinity|NaN/);
  assert.match(html, /1010/);
  assert.match(html, /#d58a39/);
});
test('snapshot views never execute authored source, variable values, SVG or HTML images', () => {
  const html = results.preview({
    title: '<script>x</script>',
    language: 'python',
    source: '',
    result: {
      lastTrace: {
        variables: [{ name: '<img>', type: 'str', value: '<script>alert(1)</script>' }],
      },
    },
  });
  assert.doesNotMatch(html, /<script>|<img>/);
  assert.match(html, /&lt;script&gt;/);
  const image = results.preview({
    title: 'figure',
    result: { figures: ['data:image/svg+xml,<svg onload=alert(1)>'] },
  });
  assert.doesNotMatch(image, /<img|<svg/);
});
