const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const sharp = require('sharp');
const { validateVisionImages, validateImageContents } = require('../backend/ai-models');

const backend = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
const normalize = vm.runInNewContext(
  `${section(backend, 'function normalizeAiMessages(', '\nfunction buildAiDialogTitle(')}\nnormalizeAiMessages`,
  {
    validateVisionImages,
    normalizeDocuments: require('../backend/max-documents').normalizeDocuments,
    normalizeAiDialogNavigation: () => null,
    normalizeAiDialogRag: () => null,
  },
);
test('saved image messages survive JSON storage and are rendered when reopening the dialog', async () => {
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  const images = [
    { label: '问题截图.png', dataUrl: `data:image/png;base64,${buffer.toString('base64')}` },
  ];
  const messages = normalize([
    { role: 'user', content: '解释这张图', images },
    { role: 'assistant', content: '回答' },
  ]);
  await validateImageContents(messages[0].images);
  const restored = JSON.parse(JSON.stringify(messages));
  assert.deepEqual(restored[0].images, images);
  const displayed = [];
  vm.runInNewContext(
    `${section(frontend, 'function renderAiChatThread()', '\nfunction updateAiChatMessage(')}\nrenderAiChatThread();`,
    {
      aiChatThread: {},
      aiChatState: { messages: restored, currentDid: 'saved-dialog' },
      renderAiWelcomeMessage() {},
      setAiDialogId() {},
      scrollAiChatToBottom() {},
      appendAiChatMessage: () => ({ querySelector: () => ({}) }),
      window: { FreeBbsMaxImages: { show: (_host, items) => displayed.push(items) } },
    },
  );
  assert.deepEqual(displayed, [images]);
  const payload = vm.runInNewContext(
    `${section(frontend, 'function buildAiChatPayload(', '\nconst MAX_NAVIGATION_PATHS')}\nbuildAiChatPayload('继续');`,
    { aiChatState: { messages: restored, currentDid: 'saved-dialog' } },
  );
  assert.equal(payload.messages[0].images, undefined);
  assert.deepEqual(restored[0].images, images);
});
test('stored images reject unsafe URLs, malformed data and excessive attachments; old dialogs still work', async () => {
  assert.equal(normalize([{ role: 'user', content: '旧对话' }])[0].images, undefined);
  for (const dataUrl of [
    // eslint-disable-next-line no-script-url -- Reject executable URLs in saved images.
    'javascript:alert(1)',
    'https://example.com/image.png',
    'data:image/svg+xml;base64,YQ==',
  ]) {
    assert.throws(() =>
      normalize([{ role: 'user', content: '图', images: [{ label: 'x', dataUrl }] }]),
    );
  }
  const invalid = { label: 'x', dataUrl: 'data:image/png;base64,YQ==' };
  assert.throws(
    () => normalize([{ role: 'user', content: '图', images: Array(5).fill(invalid) }]),
    /4 张/,
  );
  await assert.rejects(validateImageContents([invalid]));
});

test('document page images survive history but are excluded from plain text model messages', () => {
  const filePages = [{ label: '课件.pdf · 第 1/1 页', dataUrl: 'data:image/jpeg;base64,YQ==' }];
  const saved = normalize([{ role: 'user', content: '总结附件', filePages }]);
  assert.deepEqual(JSON.parse(JSON.stringify(saved))[0].filePages, filePages);
  assert.throws(
    () => normalize([{ role: 'user', content: 'x', filePages: Array(13).fill(filePages[0]) }]),
    /12 页/,
  );
  const payload = vm.runInNewContext(
    `${section(frontend, 'function buildAiChatPayload(', '\nconst MAX_NAVIGATION_PATHS')}\nbuildAiChatPayload('继续');`,
    { aiChatState: { messages: saved, currentDid: 'saved' } },
  );
  assert.equal(payload.messages[0].filePages, undefined);
});

test('long document references survive history without embedding page images', () => {
  const documents = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '课件.pdf', pageCount: 257 },
  ];
  const restored = JSON.parse(
    JSON.stringify(normalize([{ role: 'user', content: '总结课件', documents }])),
  );
  assert.deepEqual(restored[0].documents, documents);
  assert.equal(restored[0].filePages, undefined);
});
