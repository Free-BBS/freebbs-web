const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const MAX_BYTES = 100 * 1024 * 1024;
function createUploads() {
  const uploads = new Map();
  async function remove(key, upload) {
    clearTimeout(upload.timer);
    uploads.delete(key);
    await fs.rm(upload.directory, { recursive: true, force: true });
  }
  return async function receive(userId, headers, name, chunk) {
    const id = headers['x-upload-id'];
    const offset = Number(headers['x-upload-offset']);
    const total = Number(headers['x-upload-size']);
    if (
      !/^[a-f0-9-]{36}$/i.test(id || '') ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(total) ||
      total < 1 ||
      total > MAX_BYTES ||
      !chunk.length ||
      chunk.length > 8 * 1024 * 1024 ||
      offset + chunk.length > total
    )
      throw new Error('上传分片或文件大小无效；单文件最多 100 MB。');
    const key = `${userId}:${id}`;
    let upload = uploads.get(key);
    if (!upload) {
      if (offset !== 0) throw new Error('上传已过期，请重新选择文件。');
      if (
        uploads.size >= 6 ||
        [...uploads.values()].filter((item) => item.userId === userId).length >= 2
      )
        throw new Error('上传任务过多，请稍后重试。');
      upload = { userId, name, total, received: 0, busy: true };
      uploads.set(key, upload);
      try {
        upload.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'max-upload-'));
      } catch (error) {
        uploads.delete(key);
        throw error;
      }
      upload.file = path.join(upload.directory, 'document');
      upload.busy = false;
    }
    if (upload.busy || upload.name !== name || upload.total !== total || upload.received !== offset)
      throw new Error('上传分片顺序不一致，请重新选择文件。');
    upload.busy = true;
    clearTimeout(upload.timer);
    try {
      await fs.appendFile(upload.file, chunk);
      upload.received += chunk.length;
      if (upload.received === total) {
        const buffer = await fs.readFile(upload.file);
        await remove(key, upload);
        return { buffer };
      }
      upload.timer = setTimeout(
        () => {
          remove(key, upload).catch(() => {});
        },
        10 * 60 * 1000,
      );
      upload.timer.unref();
      return { uploading: true, received: upload.received, total };
    } catch (error) {
      await remove(key, upload);
      throw error;
    } finally {
      upload.busy = false;
    }
  };
}
module.exports = { createUploads, MAX_BYTES };
