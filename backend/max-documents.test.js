const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDocumentStore, normalizeDocuments } = require('./max-documents');
const { parseFile } = require('./max-files');
function pdfFixture(count) {
  const objects = ['', ''];
  const kids = [];
  for (let page = 1; page <= count; page += 1) {
    const id = objects.length + 1;
    kids.push(`${id} 0 R`);
    const stream = `q 0.2 0.5 0.7 rg 20 20 80 80 re f Q`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << >> /Contents ${id + 1} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n `)
    .join(
      '\n',
    )}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
test('long image-only documents retain all pages and render beyond page twelve on demand', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'max-document-test-'));
  try {
    const store = createDocumentStore(directory, parseFile);
    const result = await store.create(7, 'long.pdf', pdfFixture(17));
    assert.equal(result.document.pageCount, 17);
    assert.equal(result.pages.length, 0, 'upload response is metadata, not every page in memory');
    const batch = await store.pages(7, result.document.id, 13, 4);
    assert.equal(batch.pages.length, 4);
    assert.match(batch.pages[0].label, /第 13\/17 页/);
    const last = await store.pages(7, result.document.id, 17, 4);
    assert.equal(last.pages.length, 1);
    assert.match(last.pages[0].label, /第 17\/17 页/);
    const reopened = createDocumentStore(directory, parseFile);
    assert.equal((await reopened.pages(7, result.document.id, 17, 1)).pages.length, 1);
    await assert.rejects(store.pages(8, result.document.id, 1, 4), /无权访问/);
    await assert.rejects(store.pages(7, '../escape', 1, 4), /无效/);
    await assert.rejects(store.pages(7, result.document.id, 18, 1), /超出/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test('history metadata can refer to documents of any valid page count', () => {
  assert.equal(
    normalizeDocuments([
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'long.pdf', pageCount: 10000 },
    ])[0].pageCount,
    10000,
  );
});
