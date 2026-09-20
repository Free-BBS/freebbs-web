const path = require('node:path');
const sharp = require('sharp');
const { PDFParse } = require('pdf-parse');
async function prepareDocument(name, input, alreadyPdf = false) {
  const extension = path.extname(name).toLowerCase();
  let buffer = input;
  if (!alreadyPdf && extension !== '.pdf') {
    const response = await fetch(
      `${process.env.DOCUMENT_CONVERTER_URL || 'http://172.30.77.2:8080'}/convert`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Document-Extension': extension },
        body: buffer,
        signal: AbortSignal.timeout(45000),
      },
    ).catch(() => {
      throw new Error('PPT 转换服务暂不可用，请导出为 PDF 后上传。');
    });
    if (!response.ok) throw new Error('PPT 转换失败或服务繁忙，请稍后重试，也可以导出为 PDF。');
    buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 100 * 1024 * 1024 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-')))
      throw new Error('PPT 转换结果无效或过大。');
  }
  const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false });
  try {
    const info = await parser.getInfo();
    if (!Number.isSafeInteger(info.total) || info.total < 1)
      throw new Error('文件没有可读取的页面。');
    return { pdf: buffer, pageCount: info.total };
  } finally {
    await parser.destroy();
  }
}
async function renderDocument(name, input, range = {}) {
  const prepared = await prepareDocument(name, input, range.pdf);
  const parser = new PDFParse({ data: new Uint8Array(prepared.pdf), isEvalSupported: false });
  try {
    const total = prepared.pageCount;
    const start = range.start || 1;
    const end = range.end || Math.min(total, start + 3);
    if (start < 1 || end > total || end < start || end - start >= 4)
      throw new Error('分页请求无效。');
    const pages = [];
    const partial = [];
    for (let page = start; page <= end; page += 1) {
      partial.push(page);
      const result = await parser.getScreenshot({
        partial: [page],
        desiredWidth: 1100,
        imageDataUrl: false,
        imageBuffer: true,
      });
      const rendered = result.pages[0];
      if (!rendered) throw new Error(`第 ${page} 页渲染失败。`);
      const jpeg = await sharp(rendered.data)
        .resize({ width: 1400, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer();
      if (jpeg.length > 1024 * 1024) throw new Error(`第 ${page} 页图片过大，请降低文档分辨率。`);
      pages.push({
        label: `${name.slice(0, 90)} · 第 ${page}/${total} 页`,
        dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      });
    }
    const text = (
      await parser.getText({ partial, pageJoiner: '\n-- 第 page_number 页 --\n' })
    ).text.trim();
    return { text, pages, pageCount: total, start, end };
  } finally {
    await parser.destroy();
  }
}
module.exports = { renderDocument, prepareDocument };
