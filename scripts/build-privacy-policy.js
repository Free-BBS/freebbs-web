const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');

const root = path.join(__dirname, '..');
const draft = fs.readFileSync(path.join(root, 'docs/privacy-policy-draft.md'), 'utf8');
const markdown = draft
  .slice(draft.indexOf('## 一 适用范围和联系我们'))
  .replace(/\r\n/g, '\n')
  .trim();
if (!markdown.startsWith('## 一 ') || !markdown.includes('## 十 安全与政策更新'))
  throw new Error('隐私政策正文不完整');
const renderer = new marked.Renderer();
renderer.heading = ({ tokens, depth }) => {
  const text = renderer.parser.parseInline(tokens);
  const id = text.replace(/<[^>]+>/g, '').replace(/\s+/g, '-');
  return `<h${depth} id="${id}">${text}</h${depth}>\n`;
};
const policy = {
  version: 'privacy-2026-10-13-v1',
  title: 'FreeBBS 隐私政策',
  updatedAt: '2026-10-13',
  contentHash: crypto.createHash('sha256').update(markdown).digest('hex'),
  markdown,
  html: marked.parse(markdown, { renderer }),
};
fs.writeFileSync(
  path.join(root, 'public/privacy-policy.json'),
  `${JSON.stringify(policy, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(root, 'public/privacy.html'),
  `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${policy.title}</title><link rel="stylesheet" href="/privacy-policy.css"></head>
<body class="privacy-page"><main><nav class="privacy-navigation"><a href="/">返回网站</a><button type="button" onclick="window.print()">打印或保存</button></nav><article class="privacy-policy-document"><h1>${policy.title}</h1><p class="privacy-policy-meta">更新日期：2026 年 10 月 13 日 · 版本 ${policy.version}</p>${policy.html}</article></main></body></html>\n`,
);
console.log(`Published ${policy.version} (${policy.contentHash}) from the unchanged policy body.`);
