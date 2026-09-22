const assert = require('node:assert/strict');
const test = require('node:test');
const { readMaxBackgroundStream } = require('./max-background-stream');

function upstream(parts) {
  return {
    body: (async function* () {
      for (const part of parts) yield Buffer.from(part);
    })(),
  };
}

test('reports image generation after thought and retains only the final answer', async () => {
  const phases = [];
  const result = await readMaxBackgroundStream(
    upstream([
      'data: {"status":"thinking"}\n\ndata: {"reasoning_delta":"先思考"}\n\ndata: {"status":"image_',
      'generating"}\n\ndata: {"done":true,"result":{"answer":"图片","generated_images":[]}}\n\n',
    ]),
    { onImageGeneration: () => phases.push('generating') },
  );
  assert.deepEqual(phases, ['generating']);
  assert.equal(result.answer, '图片');
});

test('incomplete or failed generation never looks complete', async () => {
  await assert.rejects(
    readMaxBackgroundStream(upstream(['data: {"status":"image_generating"}\n\n'])),
    /提前中断/,
  );
  await assert.rejects(
    readMaxBackgroundStream(upstream(['data: {"error":{"message":"生成失败"}}\n\n'])),
    /生成失败/,
  );
});
