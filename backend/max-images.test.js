const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const {
  createImageGenerationGate,
  persistGeneratedImages,
  persistGeneratedSsePayload,
  safeAlt,
  stripGeneratedImages,
} = require('./max-images');

test('persists one generated image and replaces private payload data with Markdown', async (t) => {
  const uploadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'freebbs-max-image-'));
  t.after(() => fs.promises.rm(uploadDir, { recursive: true, force: true }));
  const source = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#345678' },
  })
    .png()
    .toBuffer();
  const payload = {
    answer: '生成结果：\n\n[[MAX_IMAGE_0]]',
    chat_answer: '[[MAX_IMAGE_0]]',
    generated_images: [
      {
        placeholder: '[[MAX_IMAGE_0]]',
        alt: '示意图[]\\',
        dataUrl: `data:image/png;base64,${source.toString('base64')}`,
      },
    ],
  };

  const result = await persistGeneratedImages(payload, { ownerId: 42, uploadDir });
  assert.equal(result.generatedCount, 1);
  assert.equal(Object.hasOwn(result.payload, 'generated_images'), false);
  assert.match(result.payload.answer, /!\[示意图\]\(\/uploads\/max-image-42-/);
  assert.match(result.payload.chat_answer, /\/uploads\/max-image-42-/);
  assert.equal((await fs.promises.readdir(uploadDir)).length, 1);
  const metadata = await sharp(path.join(uploadDir, result.files[0])).metadata();
  assert.equal(metadata.format, 'webp');
});

test('image generation gate blocks concurrent and cooldown requests', () => {
  const gate = createImageGenerationGate({ cooldownMs: 60_000 });
  const first = gate.acquire('u1');
  assert.equal(first.allowed, true);
  assert.equal(gate.acquire('u1').allowed, false);
  first.release(false);
  const second = gate.acquire('u1');
  assert.equal(second.allowed, true);
  second.release(true);
  assert.equal(gate.acquire('u1').allowed, false);
});

test('alt text cannot break generated Markdown', () => {
  assert.equal(safeAlt('bad [alt]\\\nnext'), 'bad alt next');
});

test('strips private image data when persistence cannot complete', () => {
  const result = stripGeneratedImages({
    answer: 'before [[MAX_IMAGE_0]] after',
    generated_images: [{ dataUrl: 'data:image/png;base64,private' }],
  });
  assert.equal(Object.hasOwn(result, 'generated_images'), false);
  assert.doesNotMatch(JSON.stringify(result), /base64|MAX_IMAGE/);
  assert.match(result.answer, /暂时无法保存/);
});

test('persists generated images inside the final reasoning SSE payload', async (t) => {
  const uploadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'freebbs-max-sse-'));
  t.after(() => fs.promises.rm(uploadDir, { recursive: true, force: true }));
  const source = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
  const original = {
    done: true,
    result: {
      answer: '[[MAX_IMAGE_0]]',
      generated_images: [
        {
          placeholder: '[[MAX_IMAGE_0]]',
          alt: '流式图片',
          dataUrl: `data:image/png;base64,${source.toString('base64')}`,
        },
      ],
    },
  };

  const persisted = await persistGeneratedSsePayload(original, { ownerId: 7, uploadDir });
  assert.equal(persisted.generatedCount, 1);
  assert.match(persisted.event.result.answer, /\/uploads\/max-image-7-/);
  assert.equal(Object.hasOwn(persisted.event.result, 'generated_images'), false);
});
