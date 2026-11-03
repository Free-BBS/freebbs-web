import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { Router, type Response } from 'express';
import multer from 'multer';
import type { UserContext } from '@freebbs-development/contracts';
import { HttpError } from '../../core/errors/http-error.js';

export type FinanceFilePurpose = 'work_proof' | 'instruction';
export interface FinancePrivateFile {
  id: string;
  purpose: FinanceFilePurpose;
  originalName: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
  size: number;
  createdAt: string;
}
export interface FinancePrivateFileMetadata extends FinancePrivateFile {
  ownerUid: string;
}
export const FINANCE_PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const FINANCE_INSTRUCTION_MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageExtensions: Record<string, readonly string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};
function fail(status: number, code: string, message: string): never {
  throw new HttpError(status, code, message);
}
function notFound(): never {
  return fail(404, 'finance_file_missing', '文件不存在或不可查看');
}
const validDimensions = (width: number, height: number) =>
  width > 0 &&
  height > 0 &&
  width <= 32768 &&
  height <= 32768 &&
  Number.isSafeInteger(width * height) &&
  width * height <= MAX_PIXELS;

function png(bytes: Buffer): boolean {
  if (bytes.length < 57 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') return false;
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) return false;
      if (!validDimensions(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12)))
        return false;
      sawHeader = true;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT') sawData = true;
    if (type === 'IEND') return length === 0 && sawData && end === bytes.length;
    offset = end;
  }
  return false;
}

function jpeg(bytes: Buffer): boolean {
  if (
    bytes.length < 16 ||
    bytes.readUInt16BE(0) !== 0xffd8 ||
    bytes.readUInt16BE(bytes.length - 2) !== 0xffd9
  )
    return false;
  let offset = 2;
  let dimensions = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda) return dimensions;
    if (marker === 0xd9 || marker === 0x00) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      if (
        length < 8 ||
        !validDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))
      )
        return false;
      dimensions = true;
    }
    offset += length;
  }
  return false;
}

function webp(bytes: Buffer): boolean {
  if (
    bytes.length < 30 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    return false;
  let offset = 12;
  let imageCount = 0;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length || ['ANIM', 'ANMF'].includes(type)) return false;
    if (type === 'VP8 ') {
      if (
        length < 10 ||
        bytes.toString('hex', start + 3, start + 6) !== '9d012a' ||
        !validDimensions(
          bytes.readUInt16LE(start + 6) & 0x3fff,
          bytes.readUInt16LE(start + 8) & 0x3fff,
        )
      )
        return false;
      imageCount += 1;
    } else if (type === 'VP8L') {
      if (length < 5 || bytes[start] !== 0x2f) return false;
      const bits = bytes.readUInt32LE(start + 1);
      if (!validDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)) return false;
      imageCount += 1;
    } else if (type === 'VP8X') {
      if (
        length !== 10 ||
        !validDimensions(bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1)
      )
        return false;
    }
    offset = end + (length % 2);
  }
  return offset === bytes.length && imageCount === 1;
}

function cleanName(input: string): string {
  const decoded = [...input].every((character) => character.charCodeAt(0) <= 255)
    ? Buffer.from(input, 'latin1').toString('utf8')
    : input;
  const source = decoded.includes('\ufffd') ? input : decoded;
  const safe = [...source]
    .map((character) =>
      character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127 ||
      (character.length === 1 &&
        character.charCodeAt(0) >= 0xd800 &&
        character.charCodeAt(0) <= 0xdfff) ||
      /[/\\<>:"|?*]/.test(character)
        ? '_'
        : character,
    )
    .join('');
  const suffix = extname(safe).toLowerCase();
  return [...safe.slice(0, safe.length - suffix.length)].slice(0, 150).join('') + suffix;
}

export function inspectFinancePrivateFile(file: Express.Multer.File, purpose: FinanceFilePurpose) {
  const bytes = file.buffer;
  const limit = purpose === 'work_proof' ? FINANCE_PROOF_MAX_BYTES : FINANCE_INSTRUCTION_MAX_BYTES;
  if (!bytes?.length || bytes.length > limit)
    fail(
      413,
      'finance_file_too_large',
      purpose === 'work_proof' ? '工作证明图片不能超过 5 MB' : '说明 PDF 不能超过 10 MB',
    );
  const originalName = cleanName(file.originalname);
  let mime: FinancePrivateFile['mime'] | undefined;
  if (purpose === 'work_proof') {
    if (png(bytes)) mime = 'image/png';
    else if (jpeg(bytes)) mime = 'image/jpeg';
    else if (webp(bytes)) mime = 'image/webp';
  } else if (
    /^%PDF-(?:1\.[0-9]|2\.0)/.test(bytes.toString('ascii', 0, 8)) &&
    bytes
      .subarray(Math.max(0, bytes.length - 1024))
      .toString('ascii')
      .trimEnd()
      .endsWith('%%EOF')
  )
    mime = 'application/pdf';
  const declared = file.mimetype?.toLowerCase().trim();
  if (
    !mime ||
    !imageExtensions[mime].includes(extname(originalName).toLowerCase()) ||
    ![mime, 'application/octet-stream', ...(mime === 'image/jpeg' ? ['image/jpg'] : [])].includes(
      declared,
    )
  )
    fail(
      400,
      'finance_invalid_file_type',
      purpose === 'work_proof'
        ? '请上传真实的 PNG、JPEG 或 WebP 图片（不支持动图）'
        : '请上传有效的 PDF 说明文件',
    );
  return { originalName, mime, size: bytes.length };
}

/** Opaque assets stay below the separately validated private finance root. */
export class FinancePrivateFileStore {
  private readonly root: string;
  constructor(directory: string) {
    this.root = resolve(directory);
  }

  private async directory(): Promise<string> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await realpath(this.root)) !== this.root)
      fail(503, 'finance_file_storage_unavailable', '财务文件私有目录不可用');
    const directory = join(this.root, 'private-files');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== directory)
      fail(503, 'finance_file_storage_unavailable', '财务文件私有目录不可用');
    return directory;
  }

  private async readPart(id: string, extension: 'json' | 'bin', limit: number): Promise<Buffer> {
    if (!uuid.test(id)) notFound();
    const filename = join(await this.directory(), `${id}.${extension}`);
    try {
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.size > limit) notFound();
      const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.size > limit) notFound();
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) notFound();
      throw error;
    }
  }

  async create(
    ownerUid: string,
    purpose: FinanceFilePurpose,
    file: Express.Multer.File,
  ): Promise<FinancePrivateFileMetadata> {
    if (!ownerUid || ownerUid.length > 128) fail(400, 'finance_invalid_file_owner', '文件归属无效');
    const inspected = inspectFinancePrivateFile(file, purpose);
    const metadata: FinancePrivateFileMetadata = {
      id: randomUUID(),
      ownerUid,
      purpose,
      ...inspected,
      createdAt: new Date().toISOString(),
    };
    const directory = await this.directory();
    const dataPath = join(directory, `${metadata.id}.bin`);
    const metadataPath = join(directory, `${metadata.id}.json`);
    await writeFile(dataPath, file.buffer, { flag: 'wx', mode: 0o600 });
    try {
      await writeFile(metadataPath, JSON.stringify(metadata), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      await rm(dataPath, { force: true });
      throw error;
    }
    return metadata;
  }

  async getMetadata(id: string): Promise<FinancePrivateFileMetadata> {
    let file: FinancePrivateFileMetadata;
    try {
      file = JSON.parse(
        (await this.readPart(id, 'json', 16 * 1024)).toString('utf8'),
      ) as FinancePrivateFileMetadata;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      notFound();
    }
    if (
      !file ||
      typeof file !== 'object' ||
      file.id !== id ||
      !['work_proof', 'instruction'].includes(file.purpose) ||
      !imageExtensions[file.mime] ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size >
        (file.purpose === 'work_proof' ? FINANCE_PROOF_MAX_BYTES : FINANCE_INSTRUCTION_MAX_BYTES) ||
      typeof file.ownerUid !== 'string' ||
      !file.ownerUid ||
      typeof file.originalName !== 'string' ||
      !file.originalName ||
      file.originalName !== cleanName(file.originalName) ||
      typeof file.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(file.createdAt)) ||
      (file.purpose === 'instruction') !== (file.mime === 'application/pdf')
    )
      notFound();
    return file;
  }

  async read(file: FinancePrivateFileMetadata): Promise<Buffer> {
    const bytes = await this.readPart(
      file.id,
      'bin',
      file.purpose === 'work_proof' ? FINANCE_PROOF_MAX_BYTES : FINANCE_INSTRUCTION_MAX_BYTES,
    );
    if (bytes.length !== file.size) notFound();
    return bytes;
  }

  async assertOwnedFiles(
    uid: string,
    ids: readonly string[],
    purpose: FinanceFilePurpose,
  ): Promise<void> {
    if (new Set(ids).size !== ids.length)
      fail(400, 'finance_duplicate_file', '请勿重复选择同一个文件');
    for (const id of ids) {
      const file = await this.getMetadata(id);
      if (file.ownerUid !== uid || file.purpose !== purpose)
        fail(403, 'finance_file_forbidden', '不能使用其他同学的文件或错误类型的文件');
      await this.read(file);
    }
  }
}

export interface FinancePrivateFilesRouterOptions {
  store: FinancePrivateFileStore;
  getActor: (response: Response) => UserContext;
  assertAccess: (actor: UserContext) => void | Promise<void>;
  authorizeUpload: (actor: UserContext, purpose: FinanceFilePurpose) => void | Promise<void>;
  authorizeRead: (actor: UserContext, file: FinancePrivateFileMetadata) => void | Promise<void>;
}
const publicFile = (file: FinancePrivateFileMetadata): FinancePrivateFile => ({
  id: file.id,
  purpose: file.purpose,
  originalName: file.originalName,
  mime: file.mime,
  size: file.size,
  createdAt: file.createdAt,
});

export function createFinancePrivateFilesRouter(options: FinancePrivateFilesRouterOptions): Router {
  const router = Router();
  router.use(async (_request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      await options.assertAccess(options.getActor(response));
      next();
    } catch (error) {
      next(error);
    }
  });
  for (const [route, purpose, size] of [
    ['/work-proof', 'work_proof', FINANCE_PROOF_MAX_BYTES],
    ['/instruction', 'instruction', FINANCE_INSTRUCTION_MAX_BYTES],
  ] as const) {
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: size, files: 1, fields: 0 },
    }).single('file');
    router.post(
      route,
      async (_request, response, next) => {
        try {
          await options.authorizeUpload(options.getActor(response), purpose);
          next();
        } catch (error) {
          next(error);
        }
      },
      (request, response, next) => {
        upload(request, response, (error: unknown) => {
          if (error) {
            next(
              new HttpError(
                error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
                'finance_invalid_upload',
                error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
                  ? purpose === 'work_proof'
                    ? '工作证明图片不能超过 5 MB'
                    : '说明 PDF 不能超过 10 MB'
                  : '每次请选择一个文件上传',
              ),
            );
          } else next();
        });
      },
      async (request, response) => {
        const actor = options.getActor(response);
        await options.assertAccess(actor);
        await options.authorizeUpload(actor, purpose);
        if (!request.file) fail(400, 'finance_file_required', '请选择要上传的文件');
        const file = await options.store.create(actor.uid, purpose, request.file);
        response.status(201).json({ data: publicFile(file), requestId: response.locals.requestId });
      },
    );
  }
  router.get('/:id', async (request, response) => {
    const actor = options.getActor(response);
    const file = await options.store.getMetadata(request.params.id);
    await options.authorizeRead(actor, file);
    const bytes = await options.store.read(file);
    // Recheck current access before sending bytes, including pilot and fresh record visibility.
    await options.assertAccess(actor);
    await options.authorizeRead(actor, file);
    response.setHeader('Content-Type', file.mime);
    response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="file${extname(file.originalName).replace(/[^a-zA-Z0-9.]/g, '')}"; filename*=UTF-8''${encodeURIComponent(file.originalName).replace(/'/g, '%27')}`,
    );
    response.send(bytes);
  });
  return router;
}
