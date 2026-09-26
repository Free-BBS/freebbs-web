const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { extractStandaloneHtml, serializeTool } = require('./frontend-tools');

test('frontend tool HTML accepts complete standalone documents and removes markdown fences', () => {
  const html = '<!doctype html><html><head><title>计数器</title></head><body></body></html>';
  assert.equal(extractStandaloneHtml(html), html);
  assert.equal(extractStandaloneHtml(`说明\n\n\`\`\`html\n${html}\n\`\`\``), html);
  for (const invalid of ['', '<main>片段</main>', '<html><body>未闭合']) {
    assert.throws(() => extractStandaloneHtml(invalid), /完整的单文件 HTML/);
  }
});

test('frontend tools expose edit metadata only to the owner or an administrator', () => {
  const row = {
    tid: 't_example',
    user_id: 7,
    title: '示例',
    description: '简介',
    prompt: '制作一个示例',
    html_code: '<html><body>示例</body></html>',
    is_published: 1,
    uid: 'u_example',
    username: 'maker',
    avatar_path: '',
    created_at: new Date('2026-09-26T00:00:00Z'),
    updated_at: new Date('2026-09-26T00:00:00Z'),
  };
  assert.equal(serializeTool(row, null).prompt, '');
  assert.equal(serializeTool(row, null).canEdit, false);
  assert.equal(serializeTool(row, { id: 7 }).prompt, row.prompt);
  assert.equal(serializeTool(row, { id: 7 }).canEdit, true);
  assert.equal(serializeTool(row, { id: 9, is_admin: true }).canEdit, true);
});

test('tool workshop ships the public square, AI studio, sandboxed previews and discussion sharing', () => {
  const publicDir = path.join(__dirname, '..', 'public');
  const page = fs.readFileSync(path.join(publicDir, 'tool-workshop.html'), 'utf8');
  const controller = fs.readFileSync(path.join(publicDir, 'tool-workshop.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /\['\/tool-workshop', '\/tool-workshop\.html'\]/);
  assert.match(page, /id="tool-gallery"/);
  assert.match(page, /id="tool-prompt"/);
  assert.match(page, /id="tool-html"/);
  assert.match(controller, /\/tools\/generate\/html/);
  assert.match(controller, /free_bbs_tool_share_draft/);
  assert.match(controller, /sandboxDocument/);
  assert.match(controller, /connect-src 'none'/);
});
