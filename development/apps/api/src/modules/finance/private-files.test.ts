import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { UserContext } from '@freebbs-development/contracts';
import { HttpError } from '../../core/errors/http-error.js';
import {
  createFinancePrivateFilesRouter,
  FinancePrivateFileStore,
  FINANCE_PROOF_MAX_BYTES,
  inspectFinancePrivateFile,
  type FinanceFilePurpose,
  type FinancePrivateFileMetadata,
} from './private-files.js';

const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKIAAAAAASUVORK5CYII=',
  'base64',
);
const pdf = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);
const actor = (uid: string): UserContext => ({
  uid,
  displayName: uid,
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
});
const file = (bytes = image, name = '工作证明.png', mime = 'image/png') =>
  ({
    buffer: bytes,
    originalname: name,
    mimetype: mime,
  }) as Express.Multer.File;
const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'finance-private-files-'));
  roots.push(root);
  const store = new FinancePrivateFileStore(join(root, 'finance'));
  const denied = () => {
    throw new HttpError(403, 'finance_forbidden', '没有权限');
  };
  const assertAccess = vi.fn((user: UserContext) => {
    if (!['owner', 'reviewer'].includes(user.uid) || user.previewing) denied();
  });
  const authorizeUpload = vi.fn((user: UserContext, purpose: FinanceFilePurpose) => {
    if (purpose === 'instruction' && user.uid !== 'reviewer') denied();
  });
  const bound = new Set<string>();
  const authorizeRead = vi.fn((user: UserContext, metadata: FinancePrivateFileMetadata) => {
    if (metadata.ownerUid === user.uid) return;
    if (bound.has(metadata.id) && user.uid === 'reviewer') return;
    denied();
  });
  const app = express();
  app.use((req, res, next) => {
    const user = actor(req.get('X-User') ?? 'visitor');
    if (req.get('X-Preview') === 'true') user.previewing = true;
    res.locals.financeActor = user;
    res.locals.requestId = 'test-request';
    next();
  });
  app.use(
    '/files',
    createFinancePrivateFilesRouter({
      store,
      getActor: (res) => res.locals.financeActor,
      assertAccess,
      authorizeUpload,
      authorizeRead,
    }),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next;
      res
        .status(error instanceof HttpError ? error.status : 500)
        .json({ error: error instanceof Error ? error.message : 'error' });
    },
  );
  return { root, store, app, bound, assertAccess, authorizeUpload, authorizeRead };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      !resolve(root).startsWith(resolve(tmpdir()) + sep) ||
      !dirname(root).startsWith(resolve(tmpdir()))
    )
      throw new Error('Unexpected temporary cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});

describe('Finance private file validation', () => {
  it('recognizes actual PNG/PDF content and preserves safe Unicode filenames', () => {
    expect(inspectFinancePrivateFile(file(), 'work_proof')).toEqual({
      originalName: '工作证明.png',
      mime: 'image/png',
      size: image.length,
    });
    expect(
      inspectFinancePrivateFile(file(pdf, '操作说明.pdf', 'application/pdf'), 'instruction').mime,
    ).toBe('application/pdf');
    const latinName = Buffer.from('工作证明.png', 'utf8').toString('latin1');
    expect(inspectFinancePrivateFile(file(image, latinName), 'work_proof').originalName).toBe(
      '工作证明.png',
    );
  });

  it.each([
    file(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), 'x.png'),
    file(Buffer.from('<html>not an image</html>'), 'x.png'),
    file(image.subarray(0, 30), 'x.png'),
    file(image, 'x.jpg', 'image/jpeg'),
    file(image, 'x.html', 'image/png'),
    file(pdf, 'x.pdf', 'application/pdf'),
  ])('rejects disguised, unsupported, truncated or mismatched work proof files', (sample) => {
    expect(() => inspectFinancePrivateFile(sample, 'work_proof')).toThrow(HttpError);
  });

  it('rejects oversized proofs and unreasonable image dimensions', () => {
    expect(() =>
      inspectFinancePrivateFile(file(Buffer.alloc(FINANCE_PROOF_MAX_BYTES + 1)), 'work_proof'),
    ).toThrow('5 MB');
    const huge = Buffer.from(image);
    huge.writeUInt32BE(100_000, 16);
    expect(() => inspectFinancePrivateFile(file(huge), 'work_proof')).toThrow(HttpError);
  });
});

describe('Finance private file store', () => {
  it('stores opaque metadata and bytes only below the private root and validates ownership', async () => {
    const { store, root } = await setup();
    const metadata = await store.create('owner', 'work_proof', file());
    expect(metadata.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(metadata.ownerUid).toBe('owner');
    expect(await store.getMetadata(metadata.id)).toEqual(metadata);
    expect(await store.read(metadata)).toEqual(image);
    await expect(
      store.assertOwnedFiles('owner', [metadata.id], 'work_proof'),
    ).resolves.toBeUndefined();
    await expect(
      store.assertOwnedFiles('other', [metadata.id], 'work_proof'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      store.assertOwnedFiles('owner', [metadata.id], 'instruction'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      store.assertOwnedFiles('owner', [metadata.id, metadata.id], 'work_proof'),
    ).rejects.toMatchObject({ status: 400 });
    expect(await readFile(join(root, 'finance', 'private-files', `${metadata.id}.bin`))).toEqual(
      image,
    );
    await rm(join(root, 'finance', 'private-files', `${metadata.id}.bin`));
    await expect(
      store.assertOwnedFiles('owner', [metadata.id], 'work_proof'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects traversal identifiers and a substituted private-files symlink', async () => {
    const { store, root } = await setup();
    await expect(store.getMetadata('../outside')).rejects.toMatchObject({ status: 404 });
    const outside = join(root, 'outside');
    await mkdir(outside);
    await mkdir(join(root, 'finance'));
    await symlink(
      outside,
      join(root, 'finance', 'private-files'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(store.create('owner', 'work_proof', file())).rejects.toMatchObject({
      status: 503,
    });
  });

  it('does not serve data if private metadata has been modified or its bin is inconsistent', async () => {
    const { store, root } = await setup();
    const metadata = await store.create('owner', 'work_proof', file());
    await writeFile(join(root, 'finance', 'private-files', `${metadata.id}.bin`), Buffer.from('x'));
    await expect(store.read(metadata)).rejects.toMatchObject({ status: 404 });
    await writeFile(
      join(root, 'finance', 'private-files', `${metadata.id}.json`),
      JSON.stringify({ ...metadata, mime: 'text/html' }),
    );
    await expect(store.getMetadata(metadata.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('Finance private file HTTP routes', () => {
  it('uploads a single proof with no owner/path leak and requires fresh read authorization', async () => {
    const { app, store, bound, authorizeRead, assertAccess } = await setup();
    const upload = await request(app)
      .post('/files/work-proof')
      .set('X-User', 'owner')
      .attach('file', image, { filename: '工作证明.png', contentType: 'image/png' })
      .expect(201);
    const result = upload.body.data;
    expect(result.originalName).toBe('工作证明.png');
    expect(result).not.toHaveProperty('ownerUid');
    expect(JSON.stringify(result)).not.toContain('private-files');
    await request(app).get(`/files/${result.id}`).set('X-User', 'reviewer').expect(403);
    bound.add(result.id);
    const read = await request(app)
      .get(`/files/${result.id}`)
      .set('X-User', 'reviewer')
      .expect(200);
    expect(read.body).toEqual(image);
    expect(read.headers['cache-control']).toBe('private, no-store');
    expect(read.headers['x-content-type-options']).toBe('nosniff');
    expect(read.headers['content-disposition']).toContain('attachment;');
    expect(read.headers['content-security-policy']).toContain('sandbox');
    expect(await store.getMetadata(result.id)).toHaveProperty('ownerUid', 'owner');
    expect(assertAccess).toHaveBeenCalled();
    expect(authorizeRead).toHaveBeenCalledTimes(3);
  });

  it('checks pilot identity and upload role before multipart parsing or filesystem reads', async () => {
    const { app, store, authorizeUpload, authorizeRead } = await setup();
    const metadata = vi.spyOn(store, 'getMetadata');
    await request(app)
      .post('/files/work-proof')
      .set('X-User', 'other-root')
      .attach('unexpected-file-field', image, 'proof.png')
      .expect(403);
    await request(app)
      .post('/files/instruction')
      .set('X-User', 'owner')
      .attach('file', pdf, { filename: 'guide.pdf', contentType: 'application/pdf' })
      .expect(403);
    await request(app)
      .get('/files/55555555-5555-4555-8555-555555555555')
      .set('X-User', 'owner')
      .set('X-Preview', 'true')
      .expect(403);
    expect(metadata).not.toHaveBeenCalled();
    expect(authorizeRead).not.toHaveBeenCalled();
    expect(authorizeUpload).toHaveBeenCalledTimes(1);
  });

  it('accepts administrator PDF instructions, rejects unsupported content and enforces the upload bound', async () => {
    const { app } = await setup();
    const uploaded = await request(app)
      .post('/files/instruction')
      .set('X-User', 'reviewer')
      .attach('file', pdf, { filename: 'guide.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(uploaded.body.data.mime).toBe('application/pdf');
    await request(app).get(`/files/${uploaded.body.data.id}`).set('X-User', 'reviewer').expect(200);
    await request(app)
      .post('/files/work-proof')
      .set('X-User', 'owner')
      .attach('file', Buffer.from('<svg/>'), { filename: 'fake.png', contentType: 'image/png' })
      .expect(400);
    await request(app)
      .post('/files/work-proof')
      .set('X-User', 'owner')
      .attach('file', Buffer.alloc(FINANCE_PROOF_MAX_BYTES + 1), {
        filename: 'large.png',
        contentType: 'image/png',
      })
      .expect(413);
    await request(app)
      .post('/files/work-proof')
      .set('X-User', 'owner')
      .attach('file', image, 'one.png')
      .attach('file', image, 'two.png')
      .expect(400);
  });
});
