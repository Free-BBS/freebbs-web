const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { createAutomaticImageReader } = require('./moderation-auto-images');

async function fixture(t) {
  const privateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freebbs-auto-image-'));
  t.after(() => fs.rm(privateDir, { recursive: true, force: true }));
  const id = crypto.randomUUID();
  const buffer = await sharp({
    create: { width: 24, height: 24, channels: 3, background: '#b3e1ef' },
  })
    .webp()
    .toBuffer();
  const record = {
    id,
    file_name: `${id}.webp`,
    mime_type: 'image/webp',
    byte_size: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
  await fs.writeFile(path.join(privateDir, record.file_name), buffer);
  return { privateDir, record, buffer, read: createAutomaticImageReader({ privateDir }) };
}

test('only complete normalized WebP bytes matching recorded size and hash reach the image client', async (t) => {
  const h = await fixture(t);
  assert.deepEqual(await h.read([h.record]), [
    {
      id: h.record.id,
      sha256: h.record.sha256,
      mimeType: 'image/webp',
      dataBase64: h.buffer.toString('base64'),
    },
  ]);
  for (const patch of [
    { file_name: '../outside.webp' },
    { mime_type: 'image/png' },
    { byte_size: 999999999 },
    { byte_size: 1 },
    { sha256: '0'.repeat(64) },
    { id: 'https://example.invalid/image' },
  ])
    await assert.rejects(h.read([{ ...h.record, ...patch }]));
  await assert.rejects(h.read([h.record, h.record]));
  await assert.rejects(h.read(Array.from({ length: 13 }, () => h.record)));
});

test('changed or invalid image bytes cannot become approved attachments', async (t) => {
  const h = await fixture(t);
  const changed = Buffer.from(h.buffer);
  changed[changed.length - 1] = (changed[changed.length - 1] + 1) % 256;
  await fs.writeFile(path.join(h.privateDir, h.record.file_name), changed);
  await assert.rejects(h.read([h.record]));
  const invalid = Buffer.from('not-an-image');
  await fs.writeFile(path.join(h.privateDir, h.record.file_name), invalid);
  await assert.rejects(
    h.read([
      {
        ...h.record,
        byte_size: invalid.length,
        sha256: crypto.createHash('sha256').update(invalid).digest('hex'),
      },
    ]),
  );
});
