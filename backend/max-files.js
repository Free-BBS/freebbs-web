const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const { DOMParser } = require('@xmldom/xmldom');

const { createUploads, MAX_BYTES } = require('./max-file-uploads');
const MAX_TEXT = 60000;
const extensions = new Set([
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.pdf',
  '.md',
  '.txt',
]);
async function extract(name, buffer) {
  const ext = path.extname(name).toLowerCase();
  let text;
  if (!extensions.has(ext)) throw new Error('不支持此文件格式。');
  if (ext === '.md' || ext === '.txt') text = buffer.toString('utf8');
  else if (ext === '.docx') text = (await require('mammoth').extractRawText({ buffer })).value;
  else if (ext === '.doc')
    text = (await new (require('word-extractor'))().extract(buffer)).getBody();
  else if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false });
    try {
      text = (await parser.getText({ pageJoiner: '\n\n' })).text;
    } finally {
      await parser.destroy();
    }
  } else if (ext === '.xlsx' || ext === '.xls') {
    const xlsx = require('xlsx');
    const book = xlsx.read(buffer, { type: 'buffer', sheetRows: 3000 });
    for (const sheet of book.SheetNames) {
      const ref = book.Sheets[sheet]['!fullref'];
      if (ref && xlsx.utils.decode_range(ref).e.r >= 3000)
        throw new Error('工作表超过 3000 行，请拆分后上传。');
    }
    text = book.SheetNames.map(
      (sheet) => `工作表：${sheet}\n${xlsx.utils.sheet_to_csv(book.Sheets[sheet])}`,
    ).join('\n\n');
  } else if (ext === '.pptx') {
    const zip = await require('jszip').loadAsync(buffer);
    const xmlDocument = async (entryName) => {
      const file = zip.file(entryName);
      if (!file) throw new Error(`PPTX 缺少 ${entryName}，无法确定幻灯片顺序。`);
      return new DOMParser({
        errorHandler: {
          warning() {},
          error() {
            throw new Error('PPTX XML 格式无效。');
          },
          fatalError() {
            throw new Error('PPTX XML 格式无效。');
          },
        },
      }).parseFromString(await file.async('string'), 'application/xml');
    };
    const presentation = await xmlDocument('ppt/presentation.xml');
    const relations = await xmlDocument('ppt/_rels/presentation.xml.rels');
    const targets = new Map(
      Array.from(relations.getElementsByTagNameNS('*', 'Relationship'))
        .filter(
          (node) =>
            node.getAttribute('Type').endsWith('/slide') &&
            node.getAttribute('TargetMode') !== 'External',
        )
        .map((node) => [node.getAttribute('Id'), node.getAttribute('Target')]),
    );
    const slides = Array.from(presentation.getElementsByTagNameNS('*', 'sldId'));
    const parts = [];
    for (const [index, slide] of slides.entries()) {
      const relationshipId = Array.from(slide.attributes).find(
        (attribute) =>
          attribute.localName === 'id' && attribute.namespaceURI?.endsWith('/relationships'),
      )?.value;
      const target = targets.get(relationshipId);
      if (!target) throw new Error('PPTX 幻灯片关系缺失或指向外部文件。');
      const fileName = path.posix.normalize(
        target.startsWith('/') ? target.slice(1) : `ppt/${target}`,
      );
      const xml = await xmlDocument(fileName);
      const words = Array.from(xml.getElementsByTagNameNS('*', 't'))
        .filter(
          (node) =>
            node.namespaceURI?.endsWith('/drawingml/2006/main') ||
            node.namespaceURI?.endsWith('/drawingml/main'),
        )
        .map((node) => node.textContent);
      parts.push(`幻灯片 ${index + 1}\n${words.join('\n')}`);
    }
    text = parts.join('\n\n');
  } else if (ext === '.ppt') {
    const cfb = require('xlsx').CFB;
    const file = cfb.read(buffer, { type: 'buffer' });
    const stream = cfb.find(file, 'PowerPoint Document');
    if (!stream) throw new Error('无法读取 PPT，请检查文件是否加密。');
    const bytes = Buffer.from(stream.content);
    const parts = [];
    // MS-PPT TextCharsAtom (4000) and TextBytesAtom (4008).
    const records = (start, end, depth = 0) => {
      if (depth > 50) throw new Error('PPT 层级过深。');
      for (let at = start; at + 8 <= end;) {
        const version = bytes.readUInt16LE(at) % 16;
        const type = bytes.readUInt16LE(at + 2);
        const stop = at + 8 + bytes.readUInt32LE(at + 4);
        if (stop > end) throw new Error('PPT 数据损坏。');
        if (version === 15) records(at + 8, stop, depth + 1);
        else if (type === 4000 || type === 4008)
          parts.push(bytes.subarray(at + 8, stop).toString(type === 4000 ? 'utf16le' : 'latin1'));
        at = stop;
      }
    };
    records(0, bytes.length);
    text = parts.join('\n');
  }
  text = String(text || '')
    .split(String.fromCharCode(0))
    .join('')
    .trim();
  if (!text) throw new Error('未提取到文字；扫描版 PDF 请将页面作为图片发送。');
  if (text.length > MAX_TEXT) throw new Error('文件文字超过 6 万字，请拆分文件后上传。');
  return text;
}
function parseFile(name, buffer, visual = false) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { name, buffer, visual },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const timer = setTimeout(
      () => {
        worker.terminate();
        reject(new Error('文件解析超时，请拆分后重试。'));
      },
      visual ? 70000 : 15000,
    );
    worker.once('message', (result) => {
      clearTimeout(timer);
      worker.terminate();
      if (result.error) reject(new Error(result.error));
      else resolve(visual ? result.document : result.text);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (code) reject(new Error('文件解析失败，请检查文件格式。'));
    });
  });
}
function registerMaxFiles(app, requireAuth, { directory } = {}) {
  const documents = require('./max-documents').createDocumentStore(
    directory || path.join(require('node:os').tmpdir(), 'freebbs-documents'),
    parseFile,
  );
  let active = 0;
  const receive = createUploads();
  app.get('/api/ai/files/:id/pages', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return;
    if (active >= 2) return response.status(429).json({ message: '文件渲染繁忙，请稍后重试。' });
    active += 1;
    try {
      response.setHeader('Cache-Control', 'private, no-store');
      return response.json(
        await documents.pages(
          user.id,
          request.params.id,
          Number(request.query.start || 1),
          Number(request.query.count || 4),
        ),
      );
    } catch (error) {
      return response.status(422).json({ message: error.message });
    } finally {
      active -= 1;
    }
  });
  app.post('/api/ai/files/parse', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return;
    const binary = Buffer.isBuffer(request.body);
    const name = binary ? request.query.name : request.body?.name;
    const data = binary ? null : request.body?.data;
    if (
      typeof name !== 'string' ||
      name.length > 180 ||
      !extensions.has(path.extname(name).toLowerCase()) ||
      (!binary &&
        (typeof data !== 'string' ||
          data.length > Math.ceil(MAX_BYTES / 3) * 4 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(data)))
    )
      return response
        .status(400)
        .json({ message: '支持 Word、Excel、PPT、PDF、Markdown；单文件最多 100 MB。' });
    let buffer = binary ? request.body : Buffer.from(data, 'base64');
    if (binary && request.headers['x-upload-id']) {
      try {
        const received = await receive(user.id, request.headers, name, buffer);
        if (received.uploading) return response.json(received);
        buffer = received.buffer;
      } catch (error) {
        return response.status(400).json({ message: error.message });
      }
    }
    if (!buffer.length || buffer.length > MAX_BYTES)
      return response.status(400).json({ message: '文件大小无效；最多 100 MB。' });
    if (active >= 2) return response.status(429).json({ message: '文件解析繁忙，请稍后重试。' });
    active += 1;
    try {
      const visual = ['.pdf', '.ppt', '.pptx'].includes(path.extname(name).toLowerCase());
      const parsed = visual
        ? await documents.create(user.id, name, buffer)
        : await parseFile(name, buffer);
      return response.json({ name, ...(visual ? parsed : { text: parsed }) });
    } catch (error) {
      return response.status(422).json({ message: error.message || '文件解析失败。' });
    } finally {
      active -= 1;
    }
  });
}
if (!isMainThread) {
  const task = workerData.visual
    ? workerData.visual === 'prepare'
      ? require('./max-document-vision').prepareDocument(
          workerData.name,
          Buffer.from(workerData.buffer),
        )
      : require('./max-document-vision').renderDocument(
          workerData.name,
          Buffer.from(workerData.buffer),
          typeof workerData.visual === 'object' ? workerData.visual : {},
        )
    : extract(workerData.name, Buffer.from(workerData.buffer));
  task
    .then((value) =>
      parentPort.postMessage(workerData.visual ? { document: value } : { text: value }),
    )
    .catch((error) => parentPort.postMessage({ error: error.message }));
}
module.exports = { registerMaxFiles, extract, parseFile };
