import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

// Only reviewed, static browser deliverables are copied. Original submissions are never modified.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const source = resolve(argument('--source') ?? join(repo, '../../..', '66 发展端/组织风采'));
const destination = join(repo, 'development/apps/web/public/organization-showcase/sites');
const execute = promisify(execFile);
const roots = [
  ['research', '调研组/网站demo', 'index.html'],
  ['creative', '创意设计部/site', 'index.html'],
  ['audiovisual', '影音策划部', 'index.html'],
  ['sail', '扬帆计划组', 'index.html'],
  ['humanities', '人文组', '人文组.html'],
  ['hardware', '硬件部/FREE-BBS-hardware-page', 'index.html'],
  ['software', '软件部', '网页示例.html'],
  ['liaison', '学生联络中心', 'index.html'],
];
const runtimeExtensions = new Set([
  '.html',
  '.htm',
  '.css',
  '.js',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp4',
  '.webm',
  '.mp3',
  '.m4a',
  '.wav',
  '.ogg',
]);
const excludedDirectories =
  /^(?:node_modules|\.tools|\.git|__MACOSX|_原包元数据|build|source|src|internal|content)$/i;
let sharp;
try {
  const require = createRequire(join(argument('--sharp-root') ?? repo, 'package.json'));
  sharp = require('sharp');
} catch {
  console.warn(
    'sharp unavailable: copying source images without optimization. Use --sharp-root <directory containing node_modules>.',
  );
}

function within(root, path) {
  const part = relative(root, path);
  if (part === '..' || part.startsWith(`..${sep}`) || resolve(root, part) !== resolve(path))
    throw new Error(`Path escapes the generated showcase directory: ${path}`);
  return path;
}
async function writeOutput(path, content) {
  within(destination, path);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.preparing-${process.pid}`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
async function list(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error(`Symbolic links are not publishable: ${entry.name}`);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!excludedDirectories.test(entry.name) && !entry.name.startsWith('.'))
        result.push(...(await list(directory, name)));
    } else if (
      runtimeExtensions.has(extname(entry.name).toLowerCase()) ||
      /^LICENSE(?:[-.]|$)/i.test(entry.name)
    ) {
      // Logo comparison pages are design QA artifacts, not public sections.
      if (!/assets\/logo\/[^/]+\.html$/i.test(name)) result.push(name);
    }
  }
  return result.sort();
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prepareSubmittedContacts(site, name, source) {
  // Keep the submitted addresses intact. Labels are tied to a site's actual address,
  // so a role mentioned elsewhere in a department's article is never rewritten.
  const labels = {
    humanities: {
      'yj-xiao23@mails.tsinghua.edu.cn': '人文组副书记 肖岩钧',
    },
    software: {
      '543329382@qq.com': '软件部副主席 赵禹晋',
      'lch24@mails.tsinghua.edu.cn': '软件部部长 刘承昊',
      'zga24@mails.tsinghua.edu.cn': '软件部部长 张国安',
      'like23@mails.tsinghua.edu.cn': '软件部部长 李科',
    },
    hardware: {
      'lrt24@mails.tsinghua.edu.cn': '硬件部部长 刘若桐',
      'hu-yh24@mails.tsinghua.edu.cn': '硬件部部长 胡云淏',
      'lbh24@mails.tsinghua.edu.cn': '硬件部部长 李泊衡',
      'yk-wang24@mails.tsinghua.edu.cn': '硬件部副部长 王易科',
    },
  };
  if (/\.html?$/i.test(name)) {
    for (const [email, label] of Object.entries(labels[site] ?? {})) {
      if (site === 'software') {
        const contact = new RegExp(
          `(<a\\b[^>]*\\bhref=["']mailto:${escapeRegExp(email)}["'][^>]*>)([\\s\\S]*?)(</a\\s*>)`,
          'gi',
        );
        source = source.replace(
          contact,
          (_, before, body, after) =>
            `${before}${body.replace(/(<span\b[^>]*>)[\s\S]*?(<\/span\s*>)/i, `$1${label}$2`)}${after}`,
        );
      } else if (site === 'hardware') {
        const contact = new RegExp(
          `<button\\b(?=[^>]*\\bdata-email=["']${escapeRegExp(email)}["'])[^>]*>[\\s\\S]*?</button\\s*>`,
          'gi',
        );
        source = source.replace(contact, (card) =>
          card
            .replace(/\baria-label=["'][^"']*["']/i, `aria-label="复制${label}的邮箱：${email}"`)
            .replace(
              /(<span\b[^>]*\bclass=["']contact-name["'][^>]*>)[\s\S]*?(<\/span\s*>)/i,
              `$1${label}$2`,
            ),
        );
      } else if (site === 'humanities') {
        source = source.replace(
          /<ul\b[^>]*\bclass=["']contact-list["'][^>]*>[\s\S]*?<\/ul\s*>/gi,
          (list) =>
            list.includes(`mailto:${email}`)
              ? list.replace(
                  /(<li><span class="k">联系人<\/span><span class="v">)[\s\S]*?(<\/span><\/li>)/,
                  `$1${label}$2`,
                )
              : list,
        );
      }
    }
    if (site === 'research') {
      source = source.replace(
        /(<a\b[^>]*\bhref=["']mailto:ee_research2026@163\.com["'][^>]*>)[\s\S]*?(<\/a\s*>)/gi,
        '$1部门公共邮箱：ee_research2026@163.com ↗$2',
      );
    } else if (site === 'sail') {
      source = source.replace(/<footer\b[^>]*>[\s\S]*?<\/footer\s*>/gi, (footer) =>
        footer.includes('mailto:ee_yangfan@126.com')
          ? footer.replace(/(<span class="footer-label">)[\s\S]*?(<\/span>)/, '$1部门公共邮箱$2')
          : footer,
      );
    } else if (site === 'creative') {
      source = source.replace(
        /(<a\b[^>]*\bhref=["']mailto:thuee_media@163\.com["'][^>]*>)/gi,
        '<p class="commission-note">部门公共邮箱</p>$1',
      );
    } else if (site === 'audiovisual') {
      source = source.replace(
        /<div class="contact-fields">[\s\S]*?(?=<div class="contact-actions">)/g,
        (fields) =>
          fields.includes('mailto:THUEEMovieAndMusic@163.com')
            ? fields.replace(
                /<label\b[^>]*>\s*部门邮箱\s*<\/label\s*>/,
                '<label>部门公共邮箱</label>',
              )
            : fields,
      );
    } else if (site === 'liaison' && name === 'index.html') {
      source = source.replace(
        '<small>负责人邮箱 / EMAIL</small>',
        '<small id="lc-contact-label">负责人邮箱 / EMAIL</small>',
      );
    }
  }
  if (site === 'liaison' && name === 'content.js') {
    source = source.replace(
      /(email\s*:\s*['"]chenyu-w24@mails\.tsinghua\.edu\.cn['"]\s*,)/,
      "$1\n    label:'联络中心主任 王晨羽',",
    );
  }
  if (site === 'liaison' && name === 'page.js') {
    source = source.replace(
      'const email = data.contact?.email?.trim();',
      "const email = data.contact?.email?.trim();\n  text('lc-contact-label',data.contact?.label || '负责人邮箱 / EMAIL');",
    );
  }
  return source;
}

function prepareResearchPage(source) {
  return source.replace(
    /<details\b([^>]*)>([\s\S]*?)<\/details\s*>/gi,
    (element, attributes, body) => {
      // The submitted photo groups become part of the page; ordinary details remain interactive.
      if (
        !/\bclass\s*=\s*(["'])[^"']*\bpractice-photos\b[^"']*\1/i.test(attributes) ||
        !/<div\b[^>]*\bclass\s*=\s*(["'])[^"']*\bgallery\b[^"']*\1/i.test(body)
      )
        return element;
      const gallery = body.replace(/<summary\b[^>]*>[\s\S]*?<\/summary\s*>/i, '');
      return `<div${attributes}>${gallery}</div>`;
    },
  );
}

function prepareHumanitiesPage(source) {
  return (
    source
      .replace(
        '拼贴内容会自动存在本机浏览器里，关掉再打开还在',
        '拼贴内容在本次浏览中临时保存，离开前请导出作品',
      )
      .replace(
        '现在还没有后端，留言只能存在你自己这台设备的浏览器里，',
        '留言只在本次浏览中临时保存，',
      )
      .replace(
        '刷新还在，但我们收不到、别人也看不到。想让我们真的收到，请先发上面的邮箱。',
        '离开后清空，部门收不到、别人也看不到。想联系我们，请发上面的邮箱。',
      )
      // The submitted README contains developer instructions, without a source article URL.
      .replace('，原文链接见项目 README。', '。')
      .replace(
        /const b = e\.target\.closest\('#btnCustomAdd'\);(\r?\n[ \t]*)if \(b\) addCustomFromInput\(\);/,
        (_, newline) =>
          `const b = e.target.closest('#btnCustomAdd, #btnCustomStickAll');${newline}if (!b) return;${newline}if (b.id === 'btnCustomAdd') addCustomFromInput();${newline}else stickAllCustom();`,
      )
      .replace(
        "const dark = !!(curT && curT.dark) || board.tpl === 'carbon';",
        "const dark = !!(curT && (curT.dark || curT.tone === 'charcoal'));",
      )
      .replace(
        /(<figure class="lightbox" id="lightbox" hidden>)(\r?\n)/,
        '$1$2  <button type="button" class="lightbox__close" id="lightboxClose" aria-label="关闭大图">×</button>$2',
      )
      .replace(
        "const close = () => { box.hidden = true; img.src = ''; };",
        "const close = () => { box.hidden = true; img.src = ''; };\n    $('#lightboxClose')?.addEventListener('click', close);",
      )
      .replace(/<button\b[^>]*\brole="tab"[^>]*>/g, (tag) => {
        const clean = tag.replace(/\s+tabindex="[^"]*"/g, '');
        const index = /\baria-selected="true"/.test(tag) ? 0 : -1;
        return `${clean.slice(0, -1)} tabindex="${index}">`;
      })
      .replace(
        /  function bindTabs\(\) \{[\s\S]*?\r?\n  \}/,
        () => String.raw`  function bindTabs() {
    const tabs = $$('.tabs [role="tab"]');
    const views = $$('[data-view]');
    const activate = (tab, focus = false) => {
      tabs.forEach((item) => {
        const selected = item === tab;
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
      });
      views.forEach((view) => { view.hidden = view.dataset.view !== tab.dataset.tab; });
      if (tab.dataset.tab === 'studio') requestAnimationFrame(renderTools);
      try { history.replaceState(null, '', '#' + tab.dataset.tab); } catch (e) { /* Opaque sandbox origins cannot update history. */ }
      if (focus) tab.focus();
    };
    tabs.forEach((tab, index) => {
      const view = views.find((item) => item.dataset.view === tab.dataset.tab);
      if (view) {
        tab.id = 'humanities-tab-' + tab.dataset.tab;
        view.id = 'humanities-panel-' + tab.dataset.tab;
        tab.setAttribute('aria-controls', view.id);
        view.setAttribute('role', 'tabpanel');
        view.setAttribute('aria-labelledby', tab.id);
      }
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', (event) => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;
        event.preventDefault();
        // Navigation arrows must not also move a selected collage piece.
        event.stopPropagation();
        activate(tabs[next], true);
      });
    });
    const want = (location.hash || '').slice(1);
    const initial = tabs.find((tab) => tab.dataset.tab === want)
      || tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || tabs[0];
    if (initial) activate(initial);
  }`,
      )
  );
}

const bridge = String.raw`(() => {
  'use strict';
  const script = document.currentScript;
  const site = script?.dataset.site || '';
  document.documentElement.dataset.showcaseSite = site;
  const themeSheet = document.createElement('link');
  themeSheet.rel = 'stylesheet'; themeSheet.href = new URL('platform-theme.css', script.src).href;
  document.head.append(themeSheet);
  const home = new URL(script?.dataset.home || 'index.html', location.href).href;
  const siteRoot = new URL('./', home).href;
  let ephemeral = false;
  for (const key of ['localStorage', 'sessionStorage']) {
    try { const storage = window[key]; const probe = '__showcase_probe'; storage.setItem(probe, '1'); storage.removeItem(probe); }
    catch {
      const entries = new Map();
      const storage = { get length() { return entries.size; }, key(index) { return [...entries.keys()][index] ?? null; },
        getItem(key) { return entries.get(String(key)) ?? null; }, setItem(key, value) { entries.set(String(key), String(value)); },
        removeItem(key) { entries.delete(String(key)); }, clear() { entries.clear(); } };
      try { Object.defineProperty(window, key, { value: storage, configurable: true }); ephemeral = true; } catch { /* The submitted code also handles unavailable storage. */ }
    }
  }
  let pending = false, last = 0;
  const measure = () => {
    if (!document.body) return 0;
    // The audiovisual submission is an intentional, internally scrolling multi-screen workspace.
    if (site === 'audiovisual') return Math.round(Math.max(660, Math.min(900, innerWidth * .66)));
    const body = document.body;
    const box = body.getBoundingClientRect();
    const style = getComputedStyle(body);
    const height = box.top + scrollY + Math.max(box.height, body.scrollHeight)
      + (Number.parseFloat(style.marginBottom) || 0);
    return Math.max(320, Math.ceil(height));
  };
  const send = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; const height = measure();
      if (height && height !== last) { last = height; parent.postMessage({ type: 'showcase-size', height }, '*'); }
    });
  };
  const normalizeLinks = (root) => {
    if (!root) return;
    root.querySelectorAll?.('a[href]').forEach((link) => {
      const raw = link.getAttribute('href');
      if (!raw || /^(?:#|mailto:|tel:|data:|blob:)/i.test(raw)) return;
      let target; try { target = new URL(raw, location.href); } catch { return; }
      if (/^https?:$/.test(target.protocol) && !target.href.startsWith(siteRoot)) {
        link.target = '_blank'; link.rel = 'noopener noreferrer';
      }
    });
  };
  addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.type !== 'showcase-theme'
      || !['light', 'dark'].includes(event.data.mode)) return;
    document.documentElement.dataset.platformTheme = event.data.mode;
    dispatchEvent(new CustomEvent('showcase-theme', { detail: { mode: event.data.mode } }));
  });
  addEventListener('DOMContentLoaded', () => {
    const css = document.createElement('style');
    css.textContent = '.showcase-platform-home{position:fixed;bottom:14px;left:14px;z-index:2147483000;display:inline-flex;align-items:center;gap:6px;padding:9px 13px;border:1px solid #acd1c6;border-radius:999px;background:#f3fff9ed;color:#174a42;font:600 12px/1.4 system-ui,sans-serif;text-decoration:none;box-shadow:0 3px 14px #163a4320;backdrop-filter:blur(8px)}.showcase-platform-home:focus-visible{outline:3px solid #edb64a;outline-offset:3px}.showcase-storage-note{padding:12px 15px;border:1px solid #9dbbaa;border-radius:12px;background:#f0faf2;color:#214a3c;font:13px/1.7 system-ui,sans-serif;margin:16px 0}.showcase-platform-home:hover{background:#fff}';
    if (site === 'creative') css.textContent += 'body::after,body.page-arrival::after{animation-duration:.18s!important}.page-home .cover{min-height:min(100svh,900px)}';
    document.head.append(css);
    const link = document.createElement('a'); link.className = 'showcase-platform-home';
    link.href = home; link.textContent = '← 本展区首页'; link.setAttribute('aria-label', '返回本部门展区首页');
    const hasHomeLink = [...document.querySelectorAll('a[href]')].some((anchor) => {
      try { return new URL(anchor.href, location.href).pathname === new URL(home).pathname; }
      catch { return false; }
    });
    if (new URL(location.href).pathname !== new URL(home).pathname && !hasHomeLink) document.body.append(link);
    if (site === 'humanities' && ephemeral) {
      const note = document.createElement('p'); note.className = 'showcase-storage-note';
      note.textContent = '草稿、自定义词句与留言在本次浏览中临时保存，离开前请导出作品；留言不会发送给部门，联系请使用邮箱。';
      (document.querySelector('#intro') || document.body).append(note);
    }
    normalizeLinks(document);
    const observer = new ResizeObserver(send); observer.observe(document.documentElement); observer.observe(document.body);
    new MutationObserver((changes) => { for (const change of changes) for (const node of change.addedNodes) if (node.nodeType === 1) { normalizeLinks(node); if (node.matches?.('a[href]')) normalizeLinks(node.parentElement); } send(); })
      .observe(document.body, { subtree: true, childList: true });
    document.fonts?.ready.then(send); send();
  });
  addEventListener('load', send, true); addEventListener('resize', send); addEventListener('toggle', send, true);
})();
`;
await mkdir(destination, { recursive: true });
await writeOutput(within(destination, join(destination, 'platform-bridge.js')), bridge);
await writeOutput(
  within(destination, join(destination, 'platform-theme.css')),
  await readFile(join(repo, 'scripts/showcase/platform-theme.css')),
);

const summary = [];
for (const [slug, folder, entry] of roots.filter(
  ([slug]) => !argument('--only') || slug === argument('--only'),
)) {
  const root = join(source, folder);
  const out = within(destination, join(destination, slug));
  const files = await list(root);
  await mkdir(out, { recursive: true });
  const renamed = new Map();
  const buffers = new Map();
  let fontText;
  let openingPoster;
  if (slug === 'creative' && argument('--python')) {
    fontText = within(out, join(out, 'font-subset-input.txt'));
    const corpus = (
      await Promise.all(
        files
          .filter((file) => /\.(?:html|js|css)$/i.test(file))
          .map((file) => readFile(join(root, file), 'utf8')),
      )
    ).join('\n');
    await writeFile(fontText, [...new Set(corpus)].join(''));
  }
  let originalBytes = 0;
  for (const name of files) {
    const buffer = await readFile(join(root, name));
    originalBytes += buffer.length;
    let published = name === entry ? 'index.html' : name;
    let processed = buffer;
    if (slug === 'audiovisual' && /\.wav$/i.test(name) && argument('--ffmpeg')) {
      const target = within(out, join(out, name.replace(/\.wav$/i, '.mp3')));
      const temporary = `${target}.preparing-${process.pid}.mp3`;
      await mkdir(dirname(target), { recursive: true });
      try {
        await execute(
          argument('--ffmpeg'),
          [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-i',
            join(root, name),
            '-vn',
            '-c:a',
            'libmp3lame',
            '-b:a',
            '192k',
            temporary,
          ],
          { timeout: 180000, maxBuffer: 1048576 },
        );
        processed = await readFile(temporary);
        published = name.replace(/\.wav$/i, '.mp3');
      } catch (error) {
        console.warn(`Audio conversion unavailable; keeping original ${name}: ${error.message}`);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    if (fontText && /\.(?:otf|ttf)$/i.test(name)) {
      const target = within(out, join(out, name.replace(/\.(?:otf|ttf)$/i, '.woff2')));
      const temporary = `${target}.preparing-${process.pid}.woff2`;
      await mkdir(dirname(target), { recursive: true });
      try {
        await execute(
          argument('--python'),
          [
            '-m',
            'fontTools.subset',
            join(root, name),
            `--output-file=${temporary}`,
            '--flavor=woff2',
            `--text-file=${fontText}`,
            '--layout-features=*',
            '--notdef-glyph',
            '--notdef-outline',
            '--recommended-glyphs',
          ],
          {
            timeout: 180000,
            maxBuffer: 1048576,
            env: {
              ...process.env,
              ...(argument('--python-tools') ? { PYTHONPATH: argument('--python-tools') } : {}),
            },
          },
        );
        processed = await readFile(temporary);
        published = name.replace(/\.(?:otf|ttf)$/i, '.woff2');
      } catch (error) {
        console.warn(`Font subsetting unavailable; keeping original ${name}: ${error.message}`);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    if (sharp && /\.(?:png|jpe?g|webp)$/i.test(name)) {
      const image = sharp(buffer, { limitInputPixels: 180_000_000 });
      const info = await image.metadata();
      if (!info.pages || info.pages <= 1) {
        const resized = await image
          .rotate()
          .resize({ width: Math.min(info.width ?? 2560, 2560), withoutEnlargement: true })
          .webp({ quality: 89, effort: 5 })
          .toBuffer();
        if (resized.length < buffer.length * 0.88) {
          published = /\.webp$/i.test(name) ? name : `${name}.webp`;
          processed = resized;
        }
      }
    }
    renamed.set(name, published);
    buffers.set(name, processed);
  }
  if (fontText) await rm(fontText, { force: true });
  if (slug === 'audiovisual' && argument('--ffmpeg')) {
    const target = within(out, join(out, 'assets/video/opening-poster.webp'));
    const temporary = `${target}.preparing-${process.pid}.webp`;
    await mkdir(dirname(target), { recursive: true });
    try {
      await execute(
        argument('--ffmpeg'),
        [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-ss',
          '0.5',
          '-i',
          join(root, 'assets/video/opening_720p.mp4'),
          '-frames:v',
          '1',
          '-c:v',
          'libwebp',
          '-quality',
          '88',
          temporary,
        ],
        { timeout: 120000, maxBuffer: 1048576 },
      );
      await writeOutput(target, await readFile(temporary));
      openingPoster = 'assets/video/opening-poster.webp';
    } catch (error) {
      console.warn(
        `Opening poster extraction unavailable; using the submitted MV cover: ${error.message}`,
      );
    } finally {
      await rm(temporary, { force: true });
    }
  }
  const replacements = new Map();
  for (const [name, published] of renamed)
    if (name !== published) {
      for (const [before, after] of [
        [name, published],
        [name.split('/').at(-1), published.split('/').at(-1)],
      ]) {
        replacements.set(before, after);
        replacements.set(encodeURI(before), encodeURI(after));
        replacements.set(
          before.split('/').map(encodeURIComponent).join('/'),
          after.split('/').map(encodeURIComponent).join('/'),
        );
      }
    }
  const replacementPattern = replacements.size
    ? new RegExp(
        [...replacements.keys()]
          .sort((a, b) => b.length - a.length)
          .map(escapeRegExp)
          .join('|'),
        'g',
      )
    : null;
  let publishedBytes = 0;
  const anomalies = [];
  for (const name of files) {
    const published = renamed.get(name);
    let buffer = buffers.get(name);
    if (/\.(?:html?|css|js|svg)$/i.test(name)) {
      let text = buffer.toString('utf8');
      if (replacementPattern)
        text = text.replace(replacementPattern, (match) => replacements.get(match));
      text = prepareSubmittedContacts(slug, name, text);
      if (slug === 'liaison') {
        text = text
          .replace(/[ \t]+$/gm, '')
          .replace(/（占位，待替换）|（占位）/g, '')
          .replace(/照片占位图/g, '照片')
          .replace(/设计占位图/g, '工作示意图');
        if (name === 'index.html')
          text = text.replaceAll('assets/hero-placeholder.svg', 'assets/破冰合照1.jpg');
        text = text
          .replace(
            '四组记忆，每组都是一本可以翻阅的小相册。点击活动卡片，左右切换浏览更多瞬间。',
            '一起经历的校园时光。',
          )
          .replace(' 张照片 · 点击翻阅', ' 张照片');
        if (name === 'style.css')
          text += `\n/* Preserve complete group photos in the submitted layout. */
.lc-photo-frame { height:auto; width:min(100%,560px); }
.lc-hero-photo-inner { height:auto; aspect-ratio:auto; }
.lc-hero-photo-inner img { object-fit:cover; height:auto; aspect-ratio:auto; }
.lc-hero-photo-overlay { position:static; padding:12px 16px; color:var(--lc-ink); background:none; }
.lc-hero-art { height:480px; }
.lc-gallery-card { height:auto; }
.lc-gallery-card img { aspect-ratio:3/2; height:auto; object-fit:cover; }
.lc-work-modal-image:has(img[src$='.svg']) { min-height:0; align-self:center; }
.lc-work-modal-image img[src$='.svg'] { height:auto; min-height:0; max-height:none; aspect-ratio:1200/850; object-fit:contain; }
.lc-work-modal-image:has(img[src$='.svg']) > span { position:static; display:block; padding:14px 22px; background:none; color:var(--lc-muted); }
.lc-gallery-card-content { position:relative; padding:18px 22px; }
.lc-gallery-card::after { display:none; }
.lc-interaction-hint,.lc-gallery-note,.lc-slide-hint { display:none; }
@media(max-width:600px){.lc-hero-art{height:350px}.lc-photo-frame{width:90%}.lc-gallery .lc-heading-aside{transform:none}.lc-gallery-card{height:auto}}
`;
      }
      if (slug === 'research' && name === 'style.css')
        text +=
          '\n/* Keep complete reference URLs readable on narrow report pages. */\n.reader{overflow-wrap:anywhere}\n';
      if (/\.css$/i.test(name))
        text = text.replace(
          /(url\([^)]*\.woff2[^)]*\))\s+format\(['"](?:opentype|truetype)['"]\)/g,
          '$1 format("woff2")',
        );
      if (slug === 'audiovisual' && name === 'app.js') {
        const scopeAssets = Object.fromEntries(
          [...renamed].filter(([file]) => /^assets\/scopes\/.*\.png$/.test(file)),
        );
        text = text.replace(
          'const path = `${screen.scopeFrame}-${mode.value}.png`;',
          `const originalPath = \`\${screen.scopeFrame}-\${mode.value}.png\`;\n    const path = (${JSON.stringify(scopeAssets)})[originalPath] ?? originalPath;`,
        );
        // Motion remains independent of explicit, informed consent to background audio.
        text = text.replace(
          'let failed = false, videoFailed = false, waiting = false, destroyed = false;',
          `let failed = false, videoFailed = false, waiting = false, destroyed = false;
  let audioAuthorized = false, openingAuthorized = false;
  const musicButton = document.createElement('button');
  musicButton.type = 'button';
  musicButton.textContent = '♫ 播放音乐';
  musicButton.setAttribute('aria-pressed', 'false');
  musicButton.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:2147483000;padding:9px 13px;border:1px solid #acd1c6;border-radius:999px;background:#f3fff9ed;color:#174a42;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer';
  ctx.root.append(musicButton);
  ctx.listen(musicButton, 'click', () => {
    audioAuthorized = !audioAuthorized;
    musicButton.textContent = audioAuthorized ? '♫ 暂停音乐' : '♫ 播放音乐';
    musicButton.setAttribute('aria-pressed', String(audioAuthorized));
    if (audioAuthorized) { blocked = false; ctx.setMotion(true); }
    syncPlayback(); update();
  });
  ctx.cleanup(() => musicButton.remove());`,
        );
        text = text.replace(
          'const shouldPlay = ctx.state.screen === 0 && ctx.state.motion && !document.hidden;',
          'const shouldPlay = openingAuthorized && ctx.state.screen === 0 && ctx.state.motion && !document.hidden;',
        );
        text = text.replace(
          'ctx.cleanup(() => musicButton.remove());',
          `ctx.cleanup(() => musicButton.remove());
  const openingButton = document.createElement('button');
  openingButton.type = 'button';
  openingButton.textContent = '▶ 播放开场';
  openingButton.setAttribute('aria-pressed', 'false');
  openingButton.style.cssText = 'display:inline-flex;align-items:center;margin-top:18px;padding:10px 17px;border:1px solid #b3d5ce;border-radius:999px;background:#f3fff9ed;color:#174a42;font:600 13px/1.5 system-ui,sans-serif;cursor:pointer';
  ctx.find('.opening-copy').append(openingButton);
  ctx.listen(openingButton, 'click', () => {
    openingAuthorized = !openingAuthorized;
    openingButton.textContent = openingAuthorized ? 'Ⅱ 暂停开场' : '▶ 播放开场';
    openingButton.setAttribute('aria-pressed', String(openingAuthorized));
    if (openingAuthorized) { videoBlocked = false; ctx.setMotion(true); }
    syncVideo();
  });
  ctx.cleanup(() => openingButton.remove());`,
        );
        text = text.replace(
          'if (!configured || failed || blocked || !ctx.state.motion || document.hidden) {',
          'if (!audioAuthorized || !configured || failed || blocked || !ctx.state.motion || document.hidden) {',
        );
        text = text.replace(
          'ctx.listen(ctx.root, "click", retryAutoplay);',
          '/* Background audio authorization is controlled by the visible music button. */',
        );
        text = text.replace(
          'ctx.listen(ctx.root, "keydown", retryAutoplay);',
          '/* Background audio starts only from an explicit player button. */',
        );
        text = text.replace('player.autoplay = true;', 'player.autoplay = false;');
        text = text.replace('player.preload = "metadata";', 'player.preload = "none";');
        text = text.replace(
          'player.play().catch(() => {});',
          '/* Native playback controls wait for the visitor. */',
        );
        text = text.replace('autoplay: "1",', 'autoplay: "0",');
        text = text.replace(
          'iframe.allow = "autoplay; fullscreen; picture-in-picture";',
          'iframe.allow = "fullscreen; picture-in-picture";',
        );
        text = text.replace(
          'const text = !configured ?',
          'const text = !audioAuthorized ? "点击播放音乐开启" : !configured ?',
        );
      }
      if (slug === 'research' && /\.html?$/i.test(name)) {
        text = prepareResearchPage(text);
      }
      if (slug === 'humanities' && /\.html$/i.test(name)) {
        text = prepareHumanitiesPage(text);
      }
      if (/\.html?$/i.test(name)) {
        if (slug === 'audiovisual') {
          const poster =
            openingPoster ??
            renamed.get('assets/works/mv/xunying.jpg') ??
            'assets/works/mv/xunying.jpg';
          text = text.replace(
            /(<video\b[^>]*\bdata-opening-video\b[\s\S]*?)(?:\s+hidden)(\s*>)/i,
            (_, before, end) => `${before} poster="${poster}"${end}`,
          );
          const emptyVoices = [...text.matchAll(/<p class="voice-text">请输入文本<\/p>/g)].length;
          if (emptyVoices) anomalies.push(`${emptyVoices} unsubmitted member messages omitted`);
          text = text.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/g, (card) =>
            card.includes('<p class="voice-text">请输入文本</p>') ? '' : card,
          );
          text = text.replace(/<article\b[^>]*>[\s\S]*?<\/article>/g, (card) =>
            /data-work-id="(?:free-creation|event-record)"/.test(card) ? '' : card,
          );
          text = text.replace(
            /<button\b[^>]*\bdata-category-filter="(?:personal|daily)"[^>]*>[\s\S]*?<\/button>/g,
            '',
          );
          text = text.replace('第 28 届学生节「???」MV', '第 28 届学生节 MV');
          text = text.replace('SIZE: 334.19 GiB / 1 TiB', 'DEPARTMENT / ARCHIVE');
        }
        text = text.replace(/<(video|audio)\b([^>]*)>/gi, (_, tag, attributes) => {
          const clean = attributes
            .replace(/\s+autoplay(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '')
            .replace(/\s+preload\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
          return `<${tag}${clean} preload="none">`;
        });
        const injected = `<script src="../platform-bridge.js" data-site="${slug}" data-home="index.html"></script>`;
        if (/<head(?:\s[^>]*)?>/i.test(text)) {
          text = text.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${injected}`);
        } else {
          text = text.replace(
            /(<html\b[^>]*>)([\s\S]*?)(?=<(?:body|main|section|header)\b)/i,
            (_, root, metadata) => `${root}<head>${injected}${metadata}</head>`,
          );
        }
        if (!text.includes(injected)) throw new Error(`Missing showcase bridge in ${slug}/${name}`);
        // Remove source-only editorial notes; no unpublished operational material is shipped.
        text = text.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
        if (slug === 'liaison') text = text.replace(/[ \t]+(?=\r?$)/gm, '');
      }
      buffer = Buffer.from(text);
    }
    const target = within(out, join(out, published));
    await mkdir(dirname(target), { recursive: true });
    await writeOutput(target, buffer);
    if (published !== name) await rm(within(out, join(out, name)), { force: true });
    publishedBytes += buffer.length;
  }
  if (openingPoster) publishedBytes += (await readFile(join(out, openingPoster))).length;
  const htmlCount = files.filter((file) => /\.html?$/i.test(file)).length;
  const artworkCount =
    slug === 'creative'
      ? files.filter(
          (file) => /^assets\/collections\//.test(file) && /\.(png|jpg|jpeg|gif|webp)$/i.test(file),
        ).length
      : undefined;
  summary.push({
    slug,
    entry: `/development/organization-showcase/sites/${slug}/index.html`,
    files: files.length,
    htmlPages: htmlCount,
    artworkFiles: artworkCount,
    originalMiB: +(originalBytes / 1048576).toFixed(2),
    publishedMiB: +(publishedBytes / 1048576).toFixed(2),
    anomalies,
  });
}
console.log(JSON.stringify(summary, null, 2));
