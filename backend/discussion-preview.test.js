const assert = require('node:assert/strict');
const test = require('node:test');
const { getDiscussionPreview } = require('./discussion-preview');

const origin = 'https://www.free-bbs.cn';
const cid = 'c_0123456789abcdef01234567';
const circuitUrl = `/circuit?cid=${cid}&revision=3&view=schematic`;
const image = { type: 'image', url: '/first.png', alt: '第一张图' };
const circuit = { type: 'circuit', cid, revision: 3, view: 'schematic' };

test('post preview follows document order for images and embedded circuit links', () => {
  assert.deepEqual(
    getDiscussionPreview(`![第一张图](/first.png)\n\n[电路](${circuitUrl})`, origin),
    image,
  );
  assert.deepEqual(
    getDiscussionPreview(`[电路](${circuitUrl})\n\n![第一张图](/first.png)`, origin),
    circuit,
  );
  assert.deepEqual(
    getDiscussionPreview(`![第一张图](/first.png) ![第二张图](/second.png)`, origin),
    image,
  );
});

test('reference-style, shortcut, linked images and formatted alt text are supported', () => {
  for (const markdown of [
    '![第一张图][figure]\n\n[figure]: /first.png "图示"',
    '![第一张图]\n\n[第一张图]: /first.png',
    '[![第一张图](/first.png)](https://example.org/details)',
    '![**第一张图**](/first.png)',
  ]) {
    assert.deepEqual(getDiscussionPreview(markdown, origin), image, markdown);
  }
  assert.deepEqual(
    getDiscussionPreview(`[![缩略图](/first.png)](${circuitUrl})`, origin),
    circuit,
    'a circuit embed replaces its entire anchor, including a linked image',
  );
});

test('media in list items, blockquotes and table cells keeps its rendered order', () => {
  for (const markdown of [
    '- 说明\n- ![第一张图](/first.png)\n\n![后图](/second.png)',
    '> ![第一张图](/first.png)\n\n![后图](/second.png)',
    '| 图一 | 图二 |\n| --- | --- |\n| ![第一张图](/first.png) | ![后图](/second.png) |',
  ]) {
    assert.deepEqual(getDiscussionPreview(markdown, origin), image, markdown);
  }
});

test('code, raw HTML and image alt text do not create fake previews', () => {
  const markdown = [
    '```markdown',
    '![代码图片](/fake.png)',
    `[假电路](${circuitUrl})`,
    '```',
    '',
    '    ![缩进代码](/fake.png)',
    '',
    '`![行内代码](/fake.png)`',
    '',
    '<div>\n![HTML 块里的文本](/fake.png)\n</div>',
    '',
    '<code>![HTML 代码](/fake.png)</code>',
    '',
    '<img src="/fake.png">',
    '',
    `<!-- [电路](${circuitUrl}) -->`,
    '',
    '![![图片的替代文本](/fake.png)](data:image/png;base64,AAAA)',
    '',
    '![第一张图](/first.png)',
  ].join('\n');
  assert.deepEqual(getDiscussionPreview(markdown, origin), image);
});

test('only safe HTTP images are selected and HTML URL entities are decoded', () => {
  for (const unsafeUrl of [
    // eslint-disable-next-line no-script-url -- deliberately rejected URL schemes
    'javascript:alert(1)',
    'jav&#x61;script:alert(1)',
    'javascript&colon;alert(1)',
    'data:image/png;base64,AAAA',
    'file:///private/image.png',
    'https://name:secret@example.org/image.png',
    'https://name:secret@www.free-bbs.cn/uploads/image.png',
  ]) {
    assert.deepEqual(
      getDiscussionPreview(`![错误](${unsafeUrl}) ![第一张图](/first.png)`, origin),
      image,
      unsafeUrl,
    );
  }
  assert.deepEqual(
    getDiscussionPreview('![A &amp; B](https://images.example.org/a.png?a=1&amp;b=2)', origin),
    { type: 'image', url: 'https://images.example.org/a.png?a=1&b=2', alt: 'A & B' },
  );
});

test('local uploads retain API-resolvable paths while external images keep their origin', () => {
  const path = '/uploads/photo.webp?size=small&version=2#detail';
  for (const value of [path, `${origin}${path}`, `//www.free-bbs.cn${path}`]) {
    assert.deepEqual(getDiscussionPreview(`![照片](${value})`, origin), {
      type: 'image',
      url: path,
      alt: '照片',
    });
  }
  assert.deepEqual(
    getDiscussionPreview(
      '![照片](http://localhost:3000/uploads/photo.webp)',
      'http://localhost:3000',
    ),
    { type: 'image', url: '/uploads/photo.webp', alt: '照片' },
  );
  for (const [value, expected] of [
    ['//images.example.org/photo.webp', 'https://images.example.org/photo.webp'],
    ['http://localhost:3001/uploads/photo.webp', 'http://localhost:3001/uploads/photo.webp'],
    [`${origin}//images.example.org/photo.webp`, `${origin}//images.example.org/photo.webp`],
  ]) {
    assert.deepEqual(getDiscussionPreview(`![照片](${value})`, origin), {
      type: 'image',
      url: expected,
      alt: '照片',
    });
  }
});

test('circuits require same-site, pinned, supported embeds', () => {
  for (const invalidCircuit of [
    `https://other.example${circuitUrl}`,
    `/circuit?cid=${cid}&view=schematic`,
    `/circuit?cid=${cid}&revision=0&view=live`,
    `/circuit?cid=${cid}&revision=3&view=other`,
  ]) {
    assert.deepEqual(
      getDiscussionPreview(`[普通链接](${invalidCircuit}) ![第一张图](/first.png)`, origin),
      image,
    );
  }
  assert.deepEqual(
    getDiscussionPreview(
      `[电路][c]\n\n[c]: ${origin}${circuitUrl.replaceAll('&', '&amp;')}`,
      origin,
    ),
    circuit,
  );
});

test('posts without media return null and extraction is bounded to the post limit', () => {
  for (const value of [
    null,
    undefined,
    '',
    '没有图片的帖子。',
    '[普通链接](https://example.org)',
  ]) {
    assert.equal(getDiscussionPreview(value, origin), null);
  }
  assert.equal(getDiscussionPreview(`${'a'.repeat(20000)}\n![图](/beyond.png)`, origin), null);
  assert.equal(getDiscussionPreview('![失效图片](/first.png)', 'not an origin'), null);
});
