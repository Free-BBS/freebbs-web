import express from 'express';
import request from 'supertest';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HttpError } from '../../core/errors/http-error.js';
import type { StoredAsset } from './domain.js';
import { inspectFile, sendFile, storeFile } from './files.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);
const temporaryRoot = resolve(tmpdir());
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (
      dirname(directory) !== temporaryRoot ||
      !basename(directory).startsWith('organization-group-filenames-')
    )
      throw new Error('Refusing to remove an unexpected test directory');
    await rm(directory, { recursive: true, force: true });
  }
});

const upload = (originalname: string, buffer: Buffer = png, mimetype = 'image/png') =>
  ({ originalname, buffer, mimetype, size: buffer.length }) as Express.Multer.File;

async function download(originalName: string) {
  const directory = await mkdtemp(join(temporaryRoot, 'organization-group-filenames-'));
  directories.push(directory);
  const asset: StoredAsset = {
    id: randomUUID(),
    originalName,
    mime: 'image/png',
    size: png.length,
    previewable: true,
    purpose: 'activity_photo',
    yearId: '2026-2027',
    createdAt: new Date().toISOString(),
    ownerUid: 'alice',
    binding: null,
  };
  await storeFile(directory, asset.id, png);
  const app = express();
  app.get('/file', async (_req, res) => {
    await sendFile(directory, asset, res, false);
  });
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next;
      res.status(error instanceof HttpError ? error.status : 500).json({ error: String(error) });
    },
  );
  return { response: await request(app).get('/file'), asset };
}

it.each([
  ['a'.repeat(179) + '😀.png', 'a'.repeat(176) + '.png'],
  ['a'.repeat(175) + '😀'.repeat(5) + '.png', 'a'.repeat(175) + '😀.png'],
  ['😀'.repeat(200) + '.png', '😀'.repeat(176) + '.png'],
])(
  'downloads a long Unicode PNG filename without splitting code points: %s',
  async (name, expected) => {
    const inspected = await inspectFile(upload(name), 'activity_photo');
    const { response } = await download(inspected.originalName);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(png);
    expect(inspected.originalName).toBe(expected);
    expect(Array.from(inspected.originalName)).toHaveLength(180);
    expect(response.headers['content-disposition']).toContain(`filename="file.png"`);
    expect(response.headers['content-disposition']).toContain(encodeURIComponent(expected));
  },
);

it.each([
  ['a'.repeat(179) + '\uD83D', 'a'.repeat(179) + '\uFFFD'],
  ['legacy\uDC00😀.png', 'legacy\uFFFD😀.png'],
])(
  'downloads a legacy malformed filename without changing the stored asset: %s',
  async (name, expected) => {
    const { response, asset } = await download(name);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(png);
    expect(response.headers['content-disposition']).toContain(encodeURIComponent(expected));
    expect(asset.originalName).toBe(name);
  },
);

it('restores multipart UTF-8 names and sanitizes unsafe characters before downloading', async () => {
  const filename = '组织组😀资料<旧>\\照片.png';
  const multipartName = Buffer.from(filename, 'utf8').toString('latin1');
  const inspected = await inspectFile(upload(multipartName), 'activity_photo');
  const expected = '组织组😀资料_旧__照片.png';
  expect(inspected.originalName).toBe(expected);
  const { response } = await download(inspected.originalName);
  expect(response.status).toBe(200);
  expect(response.headers['content-disposition']).toContain(encodeURIComponent(expected));
});

const officeFormats = [
  {
    extension: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    part: 'word/document.xml',
  },
  {
    extension: '.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    part: 'xl/workbook.xml',
  },
  {
    extension: '.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    part: 'ppt/presentation.xml',
  },
];

it.each([...officeFormats, { extension: '.zip', mime: 'application/zip', part: '' }])(
  'preserves $extension for long resource filename validation',
  async ({ extension, mime, part }) => {
    const archive = new JSZip();
    archive.file('safe.txt', 'content');
    if (part) {
      archive.file('[Content_Types].xml', '<Types />');
      archive.file(part, '<document />');
    }
    const bytes = await archive.generateAsync({ type: 'nodebuffer' });
    const inspected = await inspectFile(
      upload('a'.repeat(180) + '😀' + extension, bytes, 'application/octet-stream'),
      'resource',
    );
    expect(inspected.originalName).toBe('a'.repeat(180 - extension.length) + extension);
    expect(Array.from(inspected.originalName)).toHaveLength(180);
    expect(inspected.mime).toBe(mime);
    expect(inspected.previewable).toBe(false);
  },
);

it.each(officeFormats)(
  'checks $extension package contents against the original long extension',
  async ({ extension }) => {
    const archive = new JSZip();
    archive.file('safe.txt', 'content');
    const bytes = await archive.generateAsync({ type: 'nodebuffer' });
    await expect(
      inspectFile(
        upload('a'.repeat(180) + extension, bytes, 'application/octet-stream'),
        'resource',
      ),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_file' });
  },
);

it('rejects a long Office filename with an explicit MIME mismatch', async () => {
  const archive = new JSZip();
  archive.file('[Content_Types].xml', '<Types />');
  archive.file('word/document.xml', '<document />');
  const bytes = await archive.generateAsync({ type: 'nodebuffer' });
  await expect(
    inspectFile(upload('a'.repeat(180) + '.docx', bytes, 'application/pdf'), 'resource'),
  ).rejects.toMatchObject({ status: 400, code: 'invalid_file_type' });
});

it('keeps content recognition mandatory and generic MIME limited to resources', async () => {
  await expect(
    inspectFile(upload('a'.repeat(180) + '.png', Buffer.from('spoof')), 'activity_photo'),
  ).rejects.toMatchObject({ status: 400, code: 'invalid_file_type' });
  await expect(
    inspectFile(
      upload('a'.repeat(180) + '.png', png, 'application/octet-stream'),
      'activity_photo',
    ),
  ).rejects.toMatchObject({ status: 400, code: 'invalid_file_type' });
  expect(
    (
      await inspectFile(
        upload('a'.repeat(180) + '.png', png, 'application/octet-stream'),
        'resource',
      )
    ).mime,
  ).toBe('image/png');
});
