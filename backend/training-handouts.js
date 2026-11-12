const path = require('node:path');
const { Worker } = require('node:worker_threads');

const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_CONCURRENT_RENDERS = 2;

function createHandoutProcessor() {
  let active = 0;
  return async (source, identity, format = 'pdf') => {
    if (active >= MAX_CONCURRENT_RENDERS) {
      throw Object.assign(new Error('讲义正在处理，请稍后重试'), { status: 503 });
    }
    const worker = new Worker(path.join(__dirname, 'training-handout-worker.js'), {
      workerData: { source, identity, format },
      resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    active += 1;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        const invalidDocument = () =>
          Object.assign(
            new Error('讲义处理失败。请使用未加密、最多 100 页的常规 PDF，或清晰的 JPG/PNG 图片'),
            { status: 422 },
          );
        timer = setTimeout(() => reject(invalidDocument()), 60000);
        worker.once('message', ({ bytes, invalid }) => {
          if (invalid) reject(invalidDocument());
          else resolve(bytes ? Buffer.from(bytes) : null);
        });
        worker.once('error', reject);
        worker.once('exit', () => reject(invalidDocument()));
      });
    } finally {
      clearTimeout(timer);
      await worker.terminate();
      active -= 1;
    }
  };
}

module.exports = { createHandoutProcessor, MAX_PDF_BYTES };
