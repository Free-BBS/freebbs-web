const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../public/max-document-reader');
test('all pages are read in bounded batches before a single final answer', async () => {
  const seen = [];
  const calls = [];
  const progress = [];
  const result = await read({
    payload: { messages: [{ role: 'user', content: '总结文件' }] },
    documents: [
      { id: 'one', name: 'long.pdf', pageCount: 37 },
      { id: 'two', name: 'slides.pptx', pageCount: 15 },
    ],
    fetchPages: async (id, start, count) => {
      const total = id === 'one' ? 37 : 15;
      const pages = Array.from({ length: Math.min(count, total - start + 1) }, (_, i) => ({
        label: `${id}:${start + i}`,
      }));
      seen.push(...pages.map((page) => page.label));
      return { pages };
    },
    request: async (payload, final) => {
      calls.push({ payload, final });
      if (!final) assert.ok(payload.vision_images.length <= 4);
      return { answer: final ? '最终回答' : `更新后的完整阅读笔记 ${calls.length}` };
    },
    onProgress: (message) => progress.push(message),
  });
  assert.equal(result.answer, '最终回答');
  assert.equal(seen.length, 52);
  assert.equal(new Set(seen).size, 52);
  assert.ok(seen.includes('one:37'));
  assert.ok(seen.includes('two:15'));
  assert.equal(calls.filter((call) => call.final).length, 1);
  assert.match(calls.at(-1).payload.messages.at(-1).content, /阅读笔记 14/);
  assert.match(progress.at(-1), /所有页面已读取/);
});
test('a missing or failed batch never produces a falsely complete answer', async () => {
  let finalized = false;
  await assert.rejects(
    read({
      payload: {},
      documents: [{ id: 'one', name: 'long.pdf', pageCount: 20 }],
      fetchPages: async () => ({ pages: [] }),
      request: async (_payload, final) => {
        finalized ||= final;
        return { answer: 'x' };
      },
    }),
    /尚未读完整份/,
  );
  assert.equal(finalized, false);
});
