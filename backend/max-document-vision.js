const path = require('node:path');
const sharp = require('sharp');
const { PDFParse } = require('pdf-parse');
const MAX_PAGES = 12;
async function renderDocument(name, input) {
  const extension = path.extname(name).toLowerCase();
  let buffer = input;
  if (extension !== '.pdf') {
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
    if (!info.total || info.total > MAX_PAGES)
      throw new Error('视觉文件最多 12 页，请拆分 PDF / PPT 后上传；不会静默省略后面的页面。');
    const pages = [];
    for (let page = 1; page <= info.total; page += 1) {
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
        label: `${name.slice(0, 90)} · 第 ${page}/${info.total} 页`,
        dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      });
    }
    const text = (await parser.getText({ pageJoiner: '\n-- 第 page_number 页 --\n' })).text.trim();
    if (text.length > 60000) throw new Error('文件文字超过 6 万字，请拆分后上传。');
    return {
      text: text || '此文件为扫描或图片文档，请逐页查看附带的页面图片。',
      pages,
      pageCount: info.total,
    };
  } finally {
    await parser.destroy();
  }
}
module.exports = { renderDocument };
