const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createUploads, MAX_BYTES } = require('./max-file-uploads');
const headers = (id, offset, total) => ({
  'x-upload-id': id,
  'x-upload-offset': String(offset),
  'x-upload-size': String(total),
});
test('100 MiB files assemble in order using requests no larger than 8 MiB', async () => {
  const receive = createUploads();
  const id = crypto.randomUUID();
  for (let offset = 0; offset < MAX_BYTES; offset += 8 * 1024 * 1024) {
    const count = Math.min(8 * 1024 * 1024, MAX_BYTES - offset);
    const result = await receive(
      1,
      headers(id, offset, MAX_BYTES),
      'large.pdf',
      Buffer.alloc(count, 65),
    );
    if (offset + count < MAX_BYTES) assert.equal(result.received, offset + count);
    else {
      assert.equal(result.buffer.length, MAX_BYTES);
      assert.equal(result.buffer[0], 65);
      assert.equal(result.buffer.at(-1), 65);
    }
  }
});
test('upload ownership, order and size are enforced before combining chunks', async () => {
  const receive = createUploads();
  const id = crypto.randomUUID();
  await assert.rejects(
    receive(1, headers(id, 0, MAX_BYTES + 1), 'x.pdf', Buffer.from('a')),
    /100 MB/,
  );
  await receive(1, headers(id, 0, 4), 'x.pdf', Buffer.from('ab'));
  await assert.rejects(receive(2, headers(id, 2, 4), 'x.pdf', Buffer.from('cd')), /过期/);
  await assert.rejects(receive(1, headers(id, 1, 4), 'x.pdf', Buffer.from('cd')), /顺序/);
  await assert.rejects(receive(1, headers(id, 2, 4), 'other.pdf', Buffer.from('cd')), /顺序/);
  const result = await receive(1, headers(id, 2, 4), 'x.pdf', Buffer.from('cd'));
  assert.equal(result.buffer.toString(), 'abcd');
});
