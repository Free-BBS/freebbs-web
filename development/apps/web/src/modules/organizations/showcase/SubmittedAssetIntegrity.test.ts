import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const publicRoot = resolve(process.cwd(), 'apps/web/public');
const sitesRoot = join(publicRoot, 'organization-showcase/sites');
const slugs = [
  'research',
  'creative',
  'audiovisual',
  'sail',
  'humanities',
  'hardware',
  'software',
  'liaison',
];

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error(`Unexpected public symlink: ${entry.name}`);
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(
    new RegExp(
      `(?:^|\\s)${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+)))?(?=\\s|/?>|$)`,
      'i',
    ),
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : undefined;
}

function withoutComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, '');
}

function withoutScripts(source: string): string {
  return withoutComments(source).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
}

function decodedReference(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([\da-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number: string) => String.fromCodePoint(Number(number)));
}

function localTarget(owner: string, raw: string): string | null {
  const reference = decodedReference(raw).trim();
  if (!reference || /^(?:#|\/\/|data:|https?:|mailto:|tel:|blob:|javascript:)/i.test(reference))
    return null;
  if (/^(?:file:|[a-z]:[\\/])/i.test(reference))
    throw new Error(
      `A browser asset uses a local machine path: ${relative(publicRoot, owner)} → ${raw}`,
    );
  // Other explicit protocols are navigation targets, not local public assets.
  if (/^[a-z][a-z\d+.-]*:/i.test(reference)) return null;
  const pathname = decodeURIComponent(reference.split(/[?#]/, 1)[0]).replace(/\\/g, '/');
  if (!pathname) return null;
  if (/^[a-z]:\//i.test(pathname))
    throw new Error(`Encoded local machine path: ${relative(publicRoot, owner)} → ${raw}`);
  const target = pathname.startsWith('/development/')
    ? resolve(publicRoot, pathname.slice('/development/'.length))
    : pathname.startsWith('/')
      ? resolve(publicRoot, `.${pathname}`)
      : resolve(dirname(owner), pathname);
  const fromPublic = relative(publicRoot, target);
  if (isAbsolute(fromPublic) || fromPublic === '..' || fromPublic.startsWith(`..${sep}`))
    throw new Error(`Asset reference escapes public/: ${relative(publicRoot, owner)} → ${raw}`);
  return target;
}

function references(source: string, html: boolean): string[] {
  const values: string[] = [];
  const content = html ? withoutScripts(source) : source.replace(/\/\*[\s\S]*?\*\//g, '');
  if (html) {
    for (const tag of content.matchAll(/<[a-z][^>]*>/gi)) {
      for (const name of ['src', 'href', 'poster']) {
        const value = attribute(tag[0], name);
        if (value) values.push(value);
      }
      const srcset = attribute(tag[0], 'srcset');
      if (srcset && !srcset.trim().startsWith('data:')) {
        values.push(...srcset.split(',').map((candidate) => candidate.trim().split(/\s+/, 1)[0]));
      }
    }
  }
  for (const match of content.matchAll(/url\(\s*(?:(["'])([\s\S]*?)\1|([^)]*))\s*\)/gi)) {
    values.push((match[2] ?? match[3]).trim());
  }
  for (const match of content.matchAll(/@import\s+["']([^"']+)["']/gi)) values.push(match[1]);
  return values;
}

function html(slug: string, page = 'index.html'): string {
  return readFileSync(join(sitesRoot, slug, page), 'utf8');
}

const files = walk(sitesRoot);
const htmlFiles = files.filter((file) => /\.html?$/i.test(file));

describe('reviewed submitted-site artifacts', () => {
  it('keeps every submitted entrance and the shared sandbox bridge', () => {
    for (const slug of slugs) {
      const source = html(slug);
      expect(source, slug).toMatch(/<html\b/i);
      expect(source, slug).toContain('../platform-bridge.js');
    }
    expect(existsSync(join(sitesRoot, 'platform-bridge.js'))).toBe(true);
  });

  it('compiles classic browser scripts without executing submitted code', () => {
    const failures: string[] = [];
    const moduleFiles = new Set<string>();
    const inline: Array<{ filename: string; source: string }> = [];
    for (const file of htmlFiles) {
      let index = 0;
      for (const match of withoutComments(readFileSync(file, 'utf8')).matchAll(
        /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
      )) {
        const type = attribute(match[1], 'type')?.trim().toLowerCase().split(';', 1)[0] ?? '';
        const src = attribute(match[1], 'src');
        if (type === 'module') {
          if (src) {
            const target = localTarget(file, src);
            if (target) moduleFiles.add(target);
          }
          continue;
        }
        // JSON, import maps, templates, and other data scripts are inert HTML data.
        if (type && !/^(?:text|application)\/(?:javascript|ecmascript)$/.test(type)) continue;
        if (!src && match[2].trim())
          inline.push({ filename: `${file}#inline-${++index}`, source: match[2] });
      }
    }
    const classic = files
      .filter((file) => /\.js$/i.test(file) && !moduleFiles.has(file))
      .map((file) => ({ filename: file, source: readFileSync(file, 'utf8') }));
    for (const script of [...classic, ...inline]) {
      try {
        new Script(script.source, { filename: relative(publicRoot, script.filename) });
      } catch (error) {
        failures.push(`${relative(publicRoot, script.filename)}: ${(error as Error).message}`);
      }
    }
    expect(classic.length + inline.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it('resolves local HTML/CSS references inside public/, including cross-page bridge links', () => {
    const missing: string[] = [];
    for (const file of files.filter((file) => /\.(?:html?|css)$/i.test(file))) {
      const source = readFileSync(file, 'utf8');
      for (const reference of references(source, /\.html?$/i.test(file))) {
        const target = localTarget(file, reference);
        if (!target) continue;
        if (
          !existsSync(target) ||
          (statSync(target).isDirectory() && !existsSync(join(target, 'index.html')))
        )
          missing.push(`${relative(publicRoot, file)} → ${reference}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('rejects plain/encoded traversal and Windows drive references before reading files', () => {
    const owner = join(sitesRoot, 'research/index.html');
    expect(localTarget(owner, '../platform-bridge.js')).toBe(join(sitesRoot, 'platform-bridge.js'));
    for (const reference of [
      '../../../../outside.svg',
      '%2e%2e/%2e%2e/%2e%2e/%2e%2e/outside.svg',
      'Z%3A%2Foutside.svg',
    ])
      expect(() => localTarget(owner, reference)).toThrow();
    expect(localTarget(owner, 'data:image/svg+xml,%3Csvg%3E')).toBeNull();
    expect(localTarget(owner, 'https://example.test/report')).toBeNull();
  });

  it('preserves all 93 reviewed creative works in their four submitted collections', () => {
    // These are the reviewed 2026-10 submission counts, not a permanent department quota.
    // Update them deliberately when a later submission adds/removes actual works.
    const expected = { festival: 35, welcome: 47, practice: 5, creative: 6 };
    const counts = Object.fromEntries(
      Object.keys(expected).map((page) => [
        page,
        [...withoutScripts(html('creative', `${page}.html`)).matchAll(/<a\b[^>]*>/gi)].filter(
          (tag) => /\sdata-gallery(?=\s|=|\/?>)/i.test(tag[0]),
        ).length,
      ]),
    );
    expect(counts).toEqual(expected);
    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(93);
  });

  it('keeps the twelve reviewed research reports and their entrance/framework pages', () => {
    // Two current reports plus ten historical reports were supplied in this submission.
    const reports = [
      'industry.html',
      'report.html',
      ...Array.from({ length: 10 }, (_, i) => `archive-${String(i + 1).padStart(2, '0')}.html`),
    ];
    for (const page of [...reports, 'index.html', 'framework.html']) {
      expect(html('research', page), page).toMatch(/<(?:main|article)\b/i);
    }
    expect(reports).toHaveLength(12);
  });

  it('keeps the full submitted hardware video and requires explicit playback', () => {
    // Exact bytes identify this reviewed, unmodified 15:50 submission, not an encoding rule.
    expect(statSync(join(sitesRoot, 'hardware/assets/video/hardware-design.mp4')).size).toBe(
      75480143,
    );
    const source = html('hardware');
    const videos = [...source.matchAll(/<video\b[^>]*>/gi)].map((tag) => tag[0]);
    expect(videos).toHaveLength(1);
    expect(attribute(videos[0], 'preload')).toBe('none');
    expect(attribute(videos[0], 'autoplay')).toBeUndefined();
    expect(source).toContain('assets/video/hardware-design.mp4');
  });

  it('omits the confirmed audiovisual placeholders and fictitious capacity', () => {
    const source = withoutScripts(html('audiovisual'));
    const visibleText = source
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
      .replace(/<[^>]*>/g, ' ');
    expect(visibleText).not.toContain('请输入文本');
    expect(visibleText).not.toContain('???');
    expect(visibleText).not.toMatch(/334\.19\s*GiB|1\s*TiB/);
    for (const tag of source.matchAll(/<article\b[^>]*>/gi)) {
      if (/data-work-id=["'](?:free-creation|event-record)["']/i.test(tag[0])) {
        expect(tag[0]).not.toMatch(/\bis-placeholder\b/);
      }
    }
  });

  it('publishes browser assets and font licenses without internal submission/tool archives', () => {
    const forbidden = files
      .map((file) => relative(sitesRoot, file))
      .filter((file) => {
        const segments = file.split(/[\\/]/);
        return (
          segments.some((segment) =>
            /^(?:node_modules|\.tools|\.git|__MACOSX|internal|source|src|build|content|_原包元数据)$/i.test(
              segment,
            ),
          ) ||
          segments.some((segment) =>
            /^README(?:\.|$)|^\.DS_Store$|^FILELIST\.sha256$/i.test(segment),
          ) ||
          /\.(?:md|docx?|xlsx?|pptx?|zip|rar|7z|tar|gz|exe|dll|ps1|py|bat|cmd|sha256)$/i.test(
            file,
          ) ||
          /(?:\.preparing-\d+|font-subset-input)/.test(file)
        );
      });
    expect(forbidden).toEqual([]);
    expect(existsSync(join(sitesRoot, 'creative/assets/fonts/LICENSE-SourceHanSerif.txt'))).toBe(
      true,
    );
  });
});
