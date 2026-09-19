const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const XLSX = require('xlsx');
const { parseFile, registerMaxFiles } = require('./max-files');

test('Markdown extraction and limits reject empty, oversized and corrupt content', async () => {
  assert.equal(await parseFile('notes.md', Buffer.from('# 电路\n欧姆定律')), '# 电路\n欧姆定律');
  await assert.rejects(parseFile('empty.md', Buffer.from(' ')), /未提取/);
  await assert.rejects(parseFile('long.md', Buffer.from('a'.repeat(60001))), /6 万/);
  await assert.rejects(parseFile('broken.pdf', Buffer.from('not a pdf')));
  await assert.rejects(parseFile('broken.doc', Buffer.from('not a doc')));
});
test('XLS and XLSX retain worksheet labels, Chinese text and values', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['电阻', '电流'],
      [1000, 0.005],
    ]),
    '测量',
  );
  for (const ext of ['xls', 'xlsx']) {
    const text = await parseFile(
      `measure.${ext}`,
      XLSX.write(book, { type: 'buffer', bookType: ext }),
    );
    assert.match(text, /测量/);
    assert.match(text, /电阻,电流/);
    assert.match(text, /1000,0.005/);
  }
});
test('DOCX and PPTX extract text without exposing XML and order slides numerically', async () => {
  const word = new JSZip();
  word.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  word.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  word.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>电路实验</w:t></w:r></w:p></w:body></w:document>',
  );
  assert.match(
    await parseFile('lab.docx', await word.generateAsync({ type: 'nodebuffer' })),
    /电路实验/,
  );
  const slides = new JSZip();
  slides.file('ppt/slides/slide10.xml', '<a:t>结论 &amp; 分析</a:t>');
  slides.file('ppt/slides/slide2.xml', '<a:t>方法</a:t>');
  const text = await parseFile('lab.pptx', await slides.generateAsync({ type: 'nodebuffer' }));
  assert.ok(text.indexOf('方法') < text.indexOf('结论'));
  assert.match(text, /结论 & 分析/);
});
test('legacy PPT extracts Unicode atoms from its compound stream', async () => {
  const cfb = XLSX.CFB.utils.cfb_new();
  const words = Buffer.from('逻辑实验', 'utf16le');
  const header = Buffer.alloc(8);
  header.writeUInt16LE(4000, 2);
  header.writeUInt32LE(words.length, 4);
  XLSX.CFB.utils.cfb_add(cfb, 'PowerPoint Document', Buffer.concat([header, words]));
  assert.equal(await parseFile('lab.ppt', XLSX.CFB.write(cfb, { type: 'buffer' })), '逻辑实验');
});
test('file endpoint requires authentication and rejects unsupported input', async () => {
  let route;
  const app = {
    post(path, handler) {
      route = handler;
    },
  };
  let status;
  const response = {
    status(code) {
      status = code;
      return this;
    },
    json(value) {
      return value;
    },
  };
  registerMaxFiles(app, async () => null);
  assert.equal(await route({ body: {} }, response), undefined);
  registerMaxFiles(app, async () => ({ uid: 1 }));
  await route({ body: { name: 'file.exe', data: 'YQ==' } }, response);
  assert.equal(status, 400);
});

test('PDF text extraction reads a real text page', async () => {
  const stream = 'BT /F1 12 Tf 30 150 Td (Circuit experiment) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n `)
    .join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  assert.match(await parseFile('experiment.pdf', Buffer.from(pdf)), /Circuit experiment/);
});
