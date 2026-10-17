const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  assertAttachmentId,
  attachmentFilePath,
  validateStoredImage,
} = require('./moderation-attachments');

function createAutomaticImageReader({ privateDir }) {
  if (typeof privateDir !== 'string' || !path.isAbsolute(privateDir))
    throw new TypeError('图片存储路径无效。');
  const fail = () => new Error('待审图片无法安全读取，保留人工审核。');
  return async function readImages(records) {
    if (!Array.isArray(records) || records.length > MAX_ATTACHMENTS) throw fail();
    const root = await fs.realpath(privateDir);
    const seen = new Set();
    const images = [];
    for (const record of records) {
      assertAttachmentId(record.id);
      if (
        seen.has(record.id) ||
        record.file_name !== `${record.id}.webp` ||
        record.mime_type !== 'image/webp' ||
        !Number.isSafeInteger(Number(record.byte_size)) ||
        Number(record.byte_size) <= 0 ||
        Number(record.byte_size) > MAX_ATTACHMENT_BYTES ||
        !/^[a-f0-9]{64}$/.test(record.sha256)
      )
        throw fail();
      seen.add(record.id);
      const file = attachmentFilePath(root, record.file_name);
      const stat = await fs.lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size !== Number(record.byte_size) ||
        path.dirname(await fs.realpath(file)) !== root
      )
        throw fail();
      const handle = await fs.open(file, 'r');
      let buffer;
      try {
        const current = await handle.stat();
        if (
          !current.isFile() ||
          current.size !== stat.size ||
          current.ino !== stat.ino ||
          current.dev !== stat.dev
        )
          throw fail();
        // Bound allocation/read even if a file is concurrently replaced or grows.
        buffer = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
          if (!bytesRead) throw fail();
          offset += bytesRead;
        }
        const last = await handle.stat();
        if (last.size !== stat.size || last.mtimeMs !== stat.mtimeMs) throw fail();
      } finally {
        await handle.close();
      }
      if (
        buffer.length !== Number(record.byte_size) ||
        crypto.createHash('sha256').update(buffer).digest('hex') !== record.sha256
      )
        throw fail();
      await validateStoredImage(buffer);
      images.push({
        id: record.id,
        sha256: record.sha256,
        mimeType: 'image/webp',
        dataBase64: buffer.toString('base64'),
      });
    }
    return images;
  };
}

module.exports = { createAutomaticImageReader };
