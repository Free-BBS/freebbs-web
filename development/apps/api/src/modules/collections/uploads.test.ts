import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCollectionUpload, storeCollectionUpload } from './uploads.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function directory() {
  const value = await mkdtemp(join(tmpdir(), 'freebbs-collections-'));
  directories.push(value);
  return value;
}

describe('collection uploads', () => {
  it('stores a file only after its byte signature matches the declared type', async () => {
    const target = await directory();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const stored = await storeCollectionUpload({
      buffer: png,
      originalName: 'poster.png',
      mimeType: 'image/png',
      directory: target,
    });
    expect(stored).toMatchObject({
      name: 'poster.png',
      mimeType: 'image/png',
      sizeBytes: png.length,
    });
    await expect(readCollectionUpload(target, stored.id)).resolves.toEqual(png);
  });

  it('rejects a disguised executable and an oversized upload', async () => {
    const target = await directory();
    await expect(
      storeCollectionUpload({
        buffer: Buffer.from('MZ executable'),
        originalName: 'poster.png',
        mimeType: 'image/png',
        directory: target,
      }),
    ).rejects.toMatchObject({ code: 'file_signature_mismatch' });
    await expect(
      storeCollectionUpload({
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        originalName: 'poster.png',
        mimeType: 'image/png',
        directory: target,
        maxBytes: 3,
      }),
    ).rejects.toMatchObject({ code: 'upload_too_large' });
  });
});
