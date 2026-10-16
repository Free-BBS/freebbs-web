import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(repo, 'development/apps/web');
const out = join(web, 'dist-review');
execFileSync(
  process.execPath,
  [join(web, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.review.config.ts'],
  { cwd: web, stdio: 'inherit' },
);
await cp(join(web, 'public/organization-showcase'), join(out, 'organization-showcase'), {
  recursive: true,
});
// Classic scripts and relative media paths work under file:// without a server.
const script = await readFile(join(out, 'review.js'), 'utf8');
await writeFile(
  join(out, 'review.js'),
  script.replaceAll('/development/organization-showcase/', './organization-showcase/'),
);
async function walk(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink: ${file}`);
    if (entry.isDirectory()) files.push(...(await walk(file)));
    else files.push(file);
  }
  return files;
}
// Sandboxed local documents cannot request local fonts through CORS.
// Embed fonts in CSS; keep photos and videos separate to avoid duplication.
let embeddedFonts = 0;
for (const file of await walk(out)) {
  if (!/\.(css|html?)$/i.test(file)) continue;
  let source = await readFile(file, 'utf8');
  for (const match of [
    ...source.matchAll(/url\(\s*(['"]?)([^)'"\s]+\.(?:woff2?|otf|ttf))\1\s*\)/gi),
  ]) {
    if (/^[a-z]+:|^\/\//i.test(match[2])) continue;
    const font = resolve(dirname(file), decodeURIComponent(match[2]));
    if (relative(out, font).startsWith('..')) throw new Error('Font outside review package');
    const mime = {
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.otf': 'font/otf',
      '.ttf': 'font/ttf',
    }[extname(font)];
    source = source.replace(
      match[0],
      `url("data:${mime};base64,${(await readFile(font)).toString('base64')}")`,
    );
    embeddedFonts++;
  }
  await writeFile(file, source);
}
const destinations = [
  ['TMS', '电子系 TMS 分会', 'tms'],
  ['团委', '组织组', 'youth_league/organization', false],
  ['团委', '办公室·新生组', 'youth_league/freshman'],
  ['团委', '志愿组', 'youth_league/volunteer'],
  ['团委', '实践组', 'youth_league/practice'],
  ['团委', '调研组', 'youth_league/research'],
  ['团委', '人文组', 'youth_league/humanities'],
  ['团委', '扬帆计划组', 'youth_league/sail'],
  ['学生会', '学生文艺中心', 'student_union/arts_center'],
  ['学生会', '学生体育中心', 'student_union/sports_center'],
  ['学生会', '学生联络中心', 'student_union/liaison_center'],
  ['学生会', '学生权益发展中心', 'student_union/rights_development_center'],
  ['科协', '软件部', 'science_association/software'],
  ['科协', '硬件部', 'science_association/hardware'],
  ['科协', '学习培养部', 'science_association/training', false],
  ['科协', '项目部', 'science_association/project'],
  ['科协', '智能策划部', 'science_association/planning'],
  ['媒体中心', '创意设计部', 'media_center/creative'],
  ['媒体中心', '影音策划部', 'media_center/audiovisual'],
  ['媒体中心', '新媒体部暨记者团', 'media_center/new_media_reporters'],
].map(([group, name, route, submitted = true], index) => ({
  group,
  name,
  route: `/organizations/${route}`,
  submitted,
  file: `${String(index + 1).padStart(2, '0')}-${name}.html`,
}));
function page(title, route) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} · FREE BBS 组织风采</title><link rel="stylesheet" href="./review.css"><script defer src="./review.js"></script></head><body class="theme-light" data-route="${route}"><div id="root"></div><noscript>请使用启用 JavaScript 的浏览器打开。无需登录，也不需要启动服务器。</noscript></body></html>`;
}
await writeFile(join(out, '开始浏览.html'), page('组织风采', '/organizations'));
await writeFile(join(out, 'index.html'), page('组织风采', '/organizations'));
for (const item of destinations) await writeFile(join(out, item.file), page(item.name, item.route));
await writeFile(join(out, '审核目录.json'), JSON.stringify(destinations, null, 2));
const directoryGroups = [...new Set(destinations.map((item) => item.group))]
  .map(
    (group) =>
      `<section><h2>${group}</h2>${destinations
        .filter((item) => item.group === group)
        .map((item) => `<a href="./${item.file}">${item.name}<span>↗</span></a>`)
        .join('')}</section>`,
  )
  .join('');
await writeFile(
  join(out, '部门目录.html'),
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>部门目录 · FREE BBS</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f8f5;color:#193d36;font:17px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1080px;margin:auto;padding:40px 24px}header{background:#dff5e9;border:1px solid #b9d7c7;border-radius:24px;padding:28px}h1{margin:8px 0}header a{color:inherit}article{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin:28px 0}section{border:1px solid #c7d7cb;background:#fff;border-radius:20px;padding:22px}section:nth-child(3n){background:#fff5d9}h2{margin:0 0 12px}section a{display:flex;justify-content:space-between;gap:16px;color:inherit;text-decoration:none;padding:12px 0;border-bottom:1px dashed #c7d7cb}a:hover{text-decoration:underline}span{font-size:13px;color:#52695a}@media(max-width:600px){article{grid-template-columns:1fr}}@media(prefers-color-scheme:dark){body{background:#14251e;color:#e1efe6}header{background:#234d39}section{background:#22392c}section:nth-child(3n){background:#413d29}span{color:#b6cbbb}}</style><main><header>FREE BBS · 组织风采<h1>部门目录</h1><a href="./开始浏览.html">进入组织小街 ↗</a></header><article>${directoryGroups}</article></main></html>`,
);
await writeFile(
  join(out, '请先阅读.txt'),
  '\uFEFFFREE BBS · 组织风采离线浏览说明\r\n\r\n1. 请先完整解压，再用 Edge、Chrome 或其他现代浏览器打开“开始浏览.html”。无需登录、无需安装依赖、无需启动服务器。\r\n2. 根目录每个部门的 HTML 文件可直接进入对应展区。请保留文件夹结构，分享时发送完整压缩包，不要仅发送一个 HTML 文件。\r\n3. 图片和已提供的视频可在本地浏览，文章及其他外链需要联网。\r\n4. 微信、QQ 内置文件预览可能无法运行网页，请下载并完整解压后使用浏览器打开，建议使用电脑浏览。\r\n',
);
console.log(
  JSON.stringify({
    out,
    departments: destinations.length,
    submitted: destinations.filter((item) => item.submitted).length,
    embeddedFonts,
    mode: 'offline-file-no-login-no-server',
    hardwareVideo: 'included-existing-75.5MB',
  }),
);
