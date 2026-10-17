const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');
const cheerio = require('cheerio');
const sharp = require('sharp');
const { parseReference: parseCircuitReference } = require('../public/circuit-embeds');
const { parseReference: parseToolReference } = require('../public/tool-embeds');
const { parseReference: parseLabReference } = require('../public/lab-results');

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_DIMENSION = 1600;
const MAX_MARKDOWN_LENGTH = 20000;
const MAX_ATTACHMENTS = 12;
const ATTACHMENT_ROUTE = '/api/moderation/attachments/';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class ModerationAttachmentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ModerationAttachmentError';
    this.status = status;
  }
}

function assertAttachmentId(id) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new ModerationAttachmentError('附件不存在或不可访问', 404);
  }
  return id;
}

function attachmentIdFromUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(ATTACHMENT_ROUTE)) return null;
  const id = value.slice(ATTACHMENT_ROUTE.length);
  return UUID_PATTERN.test(id) ? id : null;
}

function assertSafeLink(href) {
  try {
    const url = new URL(href, 'https://moderation.invalid');
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
      throw new Error('Unsupported protocol');
    }
    // Reject references on any host: the same draft may later be rendered on a
    // different configured origin. Ordinary links remain usable as text links.
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      [parseCircuitReference, parseToolReference, parseLabReference].some((parse) =>
        parse(url.href, url.origin),
      )
    ) {
      throw new Error('Dynamic embed');
    }
  } catch {
    throw new ModerationAttachmentError('审核稿暂不支持动态嵌入或该链接格式，请改用普通文字');
  }
}

function validateModerationMarkdown(content) {
  if (typeof content !== 'string' || content.length > MAX_MARKDOWN_LENGTH) {
    throw new ModerationAttachmentError('正文长度不能超过 20000 个字符');
  }
  const attachmentIds = new Set();
  let imageCount = 0;
  let tokens;
  try {
    tokens = marked.lexer(content, { gfm: true, breaks: true });
    marked.walkTokens(tokens, (token) => {
      if (token.type === 'html') {
        throw new ModerationAttachmentError('审核稿暂不支持 HTML，请使用 Markdown 和本地上传图片');
      }
      if (token.type !== 'image') return;
      const id = attachmentIdFromUrl(token.href);
      if (!id) {
        throw new ModerationAttachmentError('图片必须通过本站上传，暂不支持外链或内嵌图片');
      }
      imageCount += 1;
      if (imageCount > MAX_ATTACHMENTS) {
        throw new ModerationAttachmentError('单次审核最多包含 12 张图片');
      }
      attachmentIds.add(id);
    });
    // Inspect the rendered DOM as well as tokens, including reference links,
    // entity-encoded destinations, autolinks and links wrapped around images.
    const document = cheerio.load(marked.parser(tokens, { gfm: true, breaks: true }));
    document('a[href]').each((_index, element) => {
      assertSafeLink(document(element).attr('href'));
    });
    document('img').each((_index, element) => {
      if (!attachmentIds.has(attachmentIdFromUrl(document(element).attr('src')))) {
        throw new ModerationAttachmentError('图片必须通过本站上传');
      }
    });
    if (document('img').length !== imageCount) {
      throw new ModerationAttachmentError('图片格式无法验证，请重新插入图片');
    }
  } catch (error) {
    if (error instanceof ModerationAttachmentError) throw error;
    throw new ModerationAttachmentError('正文格式无法验证，请检查 Markdown 内容');
  }
  return [...attachmentIds];
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function resolvePublicDirectories(uploadDir, publicDirs) {
  if (
    !Array.isArray(publicDirs) ||
    [uploadDir, ...publicDirs].some(
      (directory) => typeof directory !== 'string' || !path.isAbsolute(directory),
    )
  ) {
    throw new ModerationAttachmentError('附件存储配置无效', 500);
  }
  return [uploadDir, ...publicDirs].map((directory) => path.resolve(directory));
}

function assertPrivateDirectory(privateRoot, publicRoots) {
  if (
    publicRoots.some(
      (publicRoot) => isWithin(publicRoot, privateRoot) || isWithin(privateRoot, publicRoot),
    )
  ) {
    throw new ModerationAttachmentError(
      '待审附件必须保存在公开上传目录之外，且不得与静态目录重叠',
      500,
    );
  }
}

function resolvePrivateDirectory({ uploadDir, privateDir, publicDirs = [] }) {
  const publicRoots = resolvePublicDirectories(uploadDir, publicDirs);
  const privateRoot = path.resolve(
    privateDir || path.join(path.dirname(publicRoots[0]), 'moderation-private'),
  );
  assertPrivateDirectory(privateRoot, publicRoots);
  return privateRoot;
}

function attachmentFilePath(privateDir, fileName) {
  if (typeof fileName !== 'string' || !fileName.endsWith('.webp')) {
    throw new ModerationAttachmentError('附件不存在或不可访问', 404);
  }
  const id = fileName.slice(0, -5);
  assertAttachmentId(id);
  return path.join(privateDir, `${id}.webp`);
}

async function validateStoredImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new ModerationAttachmentError('图片大小需在 4MB 以内');
  }
  try {
    const image = sharp(buffer, {
      limitInputPixels: MAX_ATTACHMENT_DIMENSION ** 2,
      failOn: 'warning',
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== 'webp' ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_ATTACHMENT_DIMENSION ||
      metadata.height > MAX_ATTACHMENT_DIMENSION ||
      (metadata.pages || 1) !== 1 ||
      metadata.exif ||
      metadata.xmp ||
      metadata.iptc ||
      metadata.icc
    ) {
      throw new Error('Unnormalized image');
    }
    // Force a complete decode before recording a file, not just a header read.
    await image.raw().toBuffer();
  } catch {
    throw new ModerationAttachmentError('图片必须是经过转换的完整静态 WebP 图片');
  }
}

function createModerationAttachmentStore({
  uploadDir,
  privateDir,
  publicDirs = [],
  service,
  files = fs.promises,
  createId = crypto.randomUUID,
}) {
  const privateRoot = resolvePrivateDirectory({ uploadDir, privateDir, publicDirs });
  const publicRoots = resolvePublicDirectories(uploadDir, publicDirs);

  async function prospectiveRealPath(directory) {
    try {
      return await files.realpath(directory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A build directory may not exist yet. Resolve its existing ancestors,
      // but never treat a dangling symlink as an ordinary missing directory.
      const entry = await files.lstat(directory).catch((entryError) => {
        if (entryError.code !== 'ENOENT') throw entryError;
        return null;
      });
      if (entry) throw error;
      const parent = path.dirname(directory);
      if (parent === directory) throw error;
      return path.join(await prospectiveRealPath(parent), path.basename(directory));
    }
  }

  async function realPublicDirectories() {
    // Preserve the existing requirement that the upload directory exists.
    return Promise.all([
      files.realpath(publicRoots[0]),
      ...publicRoots.slice(1).map((directory) => prospectiveRealPath(directory)),
    ]);
  }

  async function prepareDirectory() {
    try {
      const [prospectivePrivate, publicBefore] = await Promise.all([
        prospectiveRealPath(privateRoot),
        realPublicDirectories(),
      ]);
      assertPrivateDirectory(prospectivePrivate, publicBefore);
      await files.mkdir(privateRoot, { recursive: true, mode: 0o700 });
      const [publicReal, privateReal] = await Promise.all([
        realPublicDirectories(),
        files.realpath(privateRoot),
      ]);
      assertPrivateDirectory(privateReal, publicReal);
      return privateReal;
    } catch {
      throw new ModerationAttachmentError('附件存储暂不可用', 503);
    }
  }

  async function store({ ownerId, buffer }) {
    if (!Number.isSafeInteger(Number(ownerId)) || Number(ownerId) <= 0) {
      throw new ModerationAttachmentError('请先登录', 401);
    }
    await validateStoredImage(buffer);
    const id = assertAttachmentId(createId());
    const fileName = `${id}.webp`;
    const destination = attachmentFilePath(await prepareDirectory(), fileName);
    let created = false;
    let writer;
    try {
      writer = await files.open(destination, 'wx', 0o600);
      created = true;
      await writer.writeFile(buffer);
      await writer.close();
      writer = null;
      await service.registerAttachment({
        id,
        authorId: Number(ownerId),
        fileName,
        mimeType: 'image/webp',
        byteSize: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      });
    } catch {
      if (writer) await writer.close().catch(() => {});
      if (created) {
        // A connection error can occur after COMMIT. Delete only after a
        // successful authority check confirms the record does not exist.
        try {
          const record = await service.getAttachment({ id, userId: Number(ownerId) });
          if (!record) await files.unlink(destination);
        } catch (error) {
          if (error.status === 404) await files.unlink(destination).catch(() => {});
        }
      }
      throw new ModerationAttachmentError('图片保存失败，请稍后重试', 503);
    }
    return { id, url: `${ATTACHMENT_ROUTE}${id}`, mimeType: 'image/webp', byteSize: buffer.length };
  }

  async function read({ id, userId }) {
    assertAttachmentId(id);
    // Always consult current DB authorization, even for previously public
    // images. The authority checks the target still exists and is visible.
    let record;
    try {
      record = await service.getAttachment({ id, userId });
    } catch (error) {
      if (error.status === 404 || error.status === 403) {
        throw new ModerationAttachmentError('附件不存在或不可访问', 404);
      }
      throw new ModerationAttachmentError('附件暂不可用', 503);
    }
    if (!record || record.id !== id || record.fileName !== `${id}.webp` || record.purgedAt) {
      throw new ModerationAttachmentError('附件不存在或不可访问', 404);
    }
    if (
      record.mimeType !== 'image/webp' ||
      !Number.isSafeInteger(Number(record.byteSize)) ||
      Number(record.byteSize) < 1 ||
      Number(record.byteSize) > MAX_ATTACHMENT_BYTES ||
      !/^[0-9a-f]{64}$/.test(record.sha256 || '')
    ) {
      throw new ModerationAttachmentError('附件暂不可用', 503);
    }
    let handle;
    try {
      const root = await prepareDirectory();
      const destination = attachmentFilePath(root, record.fileName);
      const before = await files.lstat(destination);
      if (!before.isFile() || before.isSymbolicLink()) throw new Error('Not a regular file');
      const realFile = await files.realpath(destination);
      if (path.dirname(realFile) !== root) throw new Error('Unexpected file location');
      handle = await files.open(
        destination,
        fs.constants.O_RDONLY + (fs.constants.O_NOFOLLOW || 0),
      );
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== Number(record.byteSize))
        throw new Error('Unexpected size');
      // Bound the read even if a file is concurrently replaced or enlarged.
      const bounded = Buffer.alloc(Number(record.byteSize) + 1);
      let count = 0;
      while (count < bounded.length) {
        const { bytesRead } = await handle.read(bounded, count, bounded.length - count, null);
        if (!bytesRead) break;
        count += bytesRead;
      }
      const buffer = bounded.subarray(0, count);
      if (
        buffer.length !== Number(record.byteSize) ||
        crypto.createHash('sha256').update(buffer).digest('hex') !== record.sha256
      ) {
        throw new Error('Unexpected file contents');
      }
      return { buffer, mimeType: 'image/webp', byteSize: buffer.length, access: record.access };
    } catch {
      throw new ModerationAttachmentError('附件暂不可用', 503);
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  return { store, read };
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_DIMENSION,
  MAX_MARKDOWN_LENGTH,
  MAX_ATTACHMENTS,
  ATTACHMENT_ROUTE,
  ModerationAttachmentError,
  assertAttachmentId,
  attachmentIdFromUrl,
  validateModerationMarkdown,
  resolvePrivateDirectory,
  attachmentFilePath,
  validateStoredImage,
  createModerationAttachmentStore,
};
