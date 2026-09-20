const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
function normalizeDocuments(value = []) {
  if (!Array.isArray(value) || value.length > 4) throw new Error('最多附加 4 个文件。');
  return value.map((item) => {
    if (
      !item ||
      !/^[a-f0-9-]{36}$/.test(item.id) ||
      typeof item.name !== 'string' ||
      !Number.isSafeInteger(item.pageCount) ||
      item.pageCount < 1
    )
      throw new Error('文件引用无效。');
    return { id: item.id, name: item.name.slice(0, 180), pageCount: item.pageCount };
  });
}
function createDocumentStore(directory, parseFile) {
  return {
    async create(userId, name, buffer) {
      const prepared = await parseFile(name, buffer, 'prepare');
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const id = crypto.randomUUID();
      const document = { id, name, pageCount: prepared.pageCount };
      try {
        await fs.writeFile(path.join(directory, `${id}.pdf`), prepared.pdf, { mode: 0o600 });
        await fs.writeFile(
          path.join(directory, `${id}.json`),
          JSON.stringify({ ...document, userId }),
          { mode: 0o600 },
        );
      } catch (error) {
        await Promise.all(
          ['pdf', 'json'].map((ext) =>
            fs.rm(path.join(directory, `${id}.${ext}`), { force: true }),
          ),
        );
        throw error;
      }
      return {
        document,
        text: `共 ${document.pageCount} 页。发送后将按页分批视觉读取整份文件。`,
        pages: [],
      };
    },
    async pages(userId, id, start, count) {
      if (
        !/^[a-f0-9-]{36}$/.test(id) ||
        !Number.isSafeInteger(start) ||
        start < 1 ||
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count > 4
      )
        throw new Error('页码无效。');
      let document;
      try {
        document = JSON.parse(await fs.readFile(path.join(directory, `${id}.json`), 'utf8'));
      } catch {
        throw new Error('文件不存在或无权访问。');
      }
      if (document.userId !== userId) throw new Error('文件不存在或无权访问。');
      if (start > document.pageCount) throw new Error('页码超出文件范围。');
      const buffer = await fs.readFile(path.join(directory, `${id}.pdf`));
      const result = await parseFile(document.name, buffer, {
        start,
        end: Math.min(document.pageCount, start + count - 1),
        pdf: true,
      });
      return { ...result, document: { id, name: document.name, pageCount: document.pageCount } };
    },
  };
}
module.exports = { createDocumentStore, normalizeDocuments };
